/**
 * The use cases: register, verify an email, sign in, sign out, read and edit a
 * profile.
 *
 * Written against the `AccountStore` interface and a clock, so the tests run with
 * no database and no waiting. HTTP does not appear anywhere in this file — status
 * codes are the API's job, and the `code` on each error below is what it maps.
 */

import {
  classifyIdentifier,
  normalizeEmail,
  normalizeUsername,
  isReservedUsername,
  publicProfile,
  ProfileUpdate,
  RegistrationRequest,
  type Account,
  type PublicProfile,
} from "./account.js";
import { skipAccountCheck, type AccountExistenceCheck } from "./hedera-account.js";
import {
  assertPasswordAcceptable,
  burnPasswordTime,
  hashPassword,
  verifyPassword,
  WeakPasswordError,
} from "./password.js";
import {
  emailCodeScope,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_SECONDS,
  fingerprint,
  fingerprintsEqual,
  generateEmailCode,
  generateSessionToken,
  SESSION_SCOPE,
  SESSION_TTL_SECONDS,
  type CodePepper,
} from "./secrets.js";
import { DuplicateAccountError, type AccountStore, type ProfilePatch } from "./store.js";

/**
 * Every failure a client can cause, as a closed set.
 *
 * Closed so the API's mapping to status codes can be exhaustive — a new code
 * added here without a status beside it stops the build rather than falling
 * through to a 500 in production.
 */
export type AccountErrorCode =
  | "validation_failed"
  | "weak_password"
  | "reserved_username"
  | "unknown_hedera_account"
  | "account_exists"
  | "account_not_found"
  | "invalid_credentials"
  | "email_not_verified"
  | "code_invalid"
  | "code_expired"
  | "too_many_attempts";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    /** Which field the client should fix, when exactly one is at fault. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

/**
 * Delivery is injected, and this package sends no mail itself.
 *
 * `packages/accounts` has no business holding an SMTP credential or an API key for
 * a mail vendor, and wiring one three days before freeze would be a dependency
 * bought for one demo. The flow — issue, store a fingerprint, expire, cap the
 * attempts — is real and complete; the transport is one function the composition
 * root supplies.
 */
export interface EmailCodeMessage {
  readonly to: string;
  readonly code: string;
  readonly firstName: string;
  readonly expiresAt: Date;
}

export type EmailCodeSender = (message: EmailCodeMessage) => Promise<void>;

/**
 * Prints the code instead of mailing it. **Development only.**
 *
 * Loud rather than quiet: a sender that silently succeeded without sending
 * anything is how a build reaches a demo where nobody can register, and the code
 * being on stdout is the whole reason this is usable locally.
 */
export const consoleEmailSender: EmailCodeSender = async (message) => {
  console.warn(
    `\n  DEV EMAIL — not sent anywhere.\n` +
      `  to:      ${message.to}\n` +
      `  code:    ${message.code}\n` +
      `  expires: ${message.expiresAt.toISOString()}\n`,
  );
};

export interface AccountServiceConfig {
  readonly store: AccountStore;
  /** From configuration. See `codePepper` for why a bare string is not accepted. */
  readonly pepper: CodePepper;
  readonly sendEmailCode: EmailCodeSender;
  /** Defaults to a checker that accepts anything, for tests. */
  readonly checkHederaAccount?: AccountExistenceCheck;
  /**
   * Whether an unverified email may sign in. Defaults to **false** — verification
   * that does not gate anything is theatre.
   */
  readonly allowUnverifiedSignIn?: boolean;
  readonly now?: () => Date;
}

export interface RegistrationResult {
  readonly profile: PublicProfile;
  /**
   * Whether the code actually reached the transport.
   *
   * Reported rather than thrown. The account exists either way, so failing the
   * whole registration on a mail outage would leave the caller with an account
   * they were told they do not have. `false` means "registered, ask for a new
   * code" and the client can say so.
   */
  readonly verificationSent: boolean;
  readonly verificationExpiresAt: string;
}

export interface SignInResult {
  readonly token: string;
  readonly expiresAt: string;
  readonly profile: PublicProfile;
}

export class AccountService {
  readonly #store: AccountStore;
  readonly #pepper: CodePepper;
  readonly #sendEmailCode: EmailCodeSender;
  readonly #checkHederaAccount: AccountExistenceCheck;
  readonly #allowUnverifiedSignIn: boolean;
  readonly #now: () => Date;

  constructor(config: AccountServiceConfig) {
    this.#store = config.store;
    this.#pepper = config.pepper;
    this.#sendEmailCode = config.sendEmailCode;
    this.#checkHederaAccount = config.checkHederaAccount ?? skipAccountCheck;
    this.#allowUnverifiedSignIn = config.allowUnverifiedSignIn ?? false;
    this.#now = config.now ?? (() => new Date());
  }

  async register(input: unknown): Promise<RegistrationResult> {
    const parsed = RegistrationRequest.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AccountError(
        "validation_failed",
        first === undefined ? "invalid registration" : first.message,
        first?.path.join("."),
      );
    }
    const request = parsed.data;

    if (isReservedUsername(request.username)) {
      throw new AccountError("reserved_username", "that username is reserved", "username");
    }

    try {
      assertPasswordAcceptable(request.password, {
        username: request.username,
        email: request.email,
      });
    } catch (error) {
      if (error instanceof WeakPasswordError) {
        throw new AccountError("weak_password", error.message, "password");
      }
      throw error;
    }

    // Before anything is written. An id that is not on the ledger cannot ever be
    // the identity it claims to be, and `unknown` (mirror unreachable) is allowed
    // through deliberately — see hedera-account.ts.
    if ((await this.#checkHederaAccount(request.hederaAccountId)) === "missing") {
      throw new AccountError(
        "unknown_hedera_account",
        `no account ${request.hederaAccountId} on testnet — check the id, or create one at the portal first`,
        "hederaAccountId",
      );
    }

    const emailNormalized = normalizeEmail(request.email);
    const usernameNormalized = normalizeUsername(request.username);

    // Cheap indexed reads for a good error message, before spending ~50ms and
    // 16MiB on a KDF for a registration that cannot land. The unique indexes are
    // still the guard that matters — two simultaneous registrations both pass this
    // check and one of them loses at the insert, which `createAccount` handles.
    await this.#assertAvailable(request.hederaAccountId, emailNormalized, usernameNormalized);

    const now = this.#now();
    const account: Account = {
      hederaAccountId: request.hederaAccountId,
      email: request.email.trim(),
      emailNormalized,
      username: request.username.trim(),
      usernameNormalized,
      firstName: request.firstName,
      ...(request.lastName === undefined ? {} : { lastName: request.lastName }),
      passwordHash: await hashPassword(request.password),
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.#store.createAccount(account);
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        throw new AccountError("account_exists", error.message, error.field);
      }
      throw error;
    }

    const issued = await this.#issueEmailCode(account);

    return {
      profile: publicProfile(account),
      verificationSent: issued.sent,
      verificationExpiresAt: issued.expiresAt.toISOString(),
    };
  }

  /**
   * Send a fresh code, invalidating whatever was pending.
   *
   * Rate limiting is the API's job, not this method's: it is a property of the
   * transport (per IP, per route) and belongs where the request arrives.
   */
  async requestEmailCode(hederaAccountId: string): Promise<{ sent: boolean; expiresAt: string }> {
    const account = await this.#store.findByAccountId(hederaAccountId);
    if (account === null) {
      throw new AccountError("account_not_found", "no account with that Hedera account id");
    }
    if (account.emailVerifiedAt !== null) {
      // Not an error worth a failure: the caller wanted a verified email and has
      // one. Reissuing would replace a used state with a pending one.
      return { sent: true, expiresAt: account.emailVerifiedAt.toISOString() };
    }

    const issued = await this.#issueEmailCode(account);
    return { sent: issued.sent, expiresAt: issued.expiresAt.toISOString() };
  }

  async confirmEmailCode(hederaAccountId: string, code: string): Promise<PublicProfile> {
    const account = await this.#store.findByAccountId(hederaAccountId);
    if (account === null) {
      throw new AccountError("account_not_found", "no account with that Hedera account id");
    }
    if (account.emailVerifiedAt !== null) {
      // Idempotent. A double-submitted form should not read as a failure.
      return publicProfile(account);
    }

    const record = await this.#store.findEmailCode(hederaAccountId);
    if (record === null) {
      throw new AccountError("code_expired", "that code has expired — request a new one");
    }

    // The address changed after the code was sent, so this code proves control of
    // a mailbox that is no longer the one on the account.
    if (record.emailNormalized !== account.emailNormalized) {
      await this.#store.deleteEmailCode(hederaAccountId);
      throw new AccountError("code_invalid", "that code was sent to a different address — request a new one");
    }

    // Read the cap before comparing, so a code that has already burned its
    // attempts cannot be tried once more on this request.
    if (record.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await this.#store.deleteEmailCode(hederaAccountId);
      throw new AccountError("too_many_attempts", "too many wrong codes — request a new one");
    }

    const offered = fingerprint(this.#pepper, emailCodeScope(hederaAccountId), code.trim());
    if (!fingerprintsEqual(offered, record.codeFingerprint)) {
      const attempts = await this.#store.recordEmailCodeAttempt(hederaAccountId);
      if (attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await this.#store.deleteEmailCode(hederaAccountId);
        throw new AccountError("too_many_attempts", "too many wrong codes — request a new one");
      }
      throw new AccountError("code_invalid", "that code is not right", "code");
    }

    const verifiedAt = this.#now();
    await this.#store.markEmailVerified(hederaAccountId, verifiedAt);
    // Single use. A code that still works after verifying is a code worth stealing.
    await this.#store.deleteEmailCode(hederaAccountId);

    return publicProfile({ ...account, emailVerifiedAt: verifiedAt });
  }

  /**
   * `identifier` is the Hedera account id, the email or the username.
   *
   * Every failure below is the same error with the same message and, as near as
   * matters, the same duration. A login endpoint that answers faster for an
   * unknown account is an oracle for "is this Hedera account a registered
   * expert", which is exactly what someone mapping the platform wants.
   */
  async signIn(identifier: string, password: string): Promise<SignInResult> {
    const account = await this.#findByIdentifier(identifier);

    if (account === null) {
      await burnPasswordTime(password);
      throw new AccountError("invalid_credentials", "those credentials are not right");
    }

    if (!(await verifyPassword(password, account.passwordHash))) {
      throw new AccountError("invalid_credentials", "those credentials are not right");
    }

    if (account.emailVerifiedAt === null && !this.#allowUnverifiedSignIn) {
      throw new AccountError("email_not_verified", "confirm your email address first");
    }

    const token = generateSessionToken();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    await this.#store.createSession({
      tokenFingerprint: fingerprint(this.#pepper, SESSION_SCOPE, token),
      hederaAccountId: account.hederaAccountId,
      expiresAt,
      createdAt: now,
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      profile: publicProfile(account),
    };
  }

  /** Idempotent: signing out twice, or with a token that never existed, is fine. */
  async signOut(token: string): Promise<void> {
    await this.#store.deleteSession(fingerprint(this.#pepper, SESSION_SCOPE, token));
  }

  /** The account behind a bearer token, or `null`. Never throws on a bad token. */
  async authenticate(token: string): Promise<Account | null> {
    const session = await this.#store.findSession(fingerprint(this.#pepper, SESSION_SCOPE, token));
    if (session === null) return null;

    const account = await this.#store.findByAccountId(session.hederaAccountId);
    if (account === null) {
      // The account went away while a session pointed at it. Clean up rather than
      // leaving a token that resolves to nothing.
      await this.#store.deleteSession(session.tokenFingerprint);
      return null;
    }
    return account;
  }

  async getProfile(hederaAccountId: string): Promise<PublicProfile> {
    const account = await this.#store.findByAccountId(hederaAccountId);
    if (account === null) {
      throw new AccountError("account_not_found", "no account with that Hedera account id");
    }
    return publicProfile(account);
  }

  async updateProfile(hederaAccountId: string, input: unknown): Promise<PublicProfile> {
    const parsed = ProfileUpdate.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new AccountError(
        "validation_failed",
        first === undefined ? "invalid update" : first.message,
        first?.path.join("."),
      );
    }

    const patch: ProfilePatch = {
      ...(parsed.data.firstName === undefined ? {} : { firstName: parsed.data.firstName }),
      ...(parsed.data.lastName === undefined ? {} : { lastName: parsed.data.lastName }),
    };

    const updated = await this.#store.updateProfile(hederaAccountId, patch);
    if (updated === null) {
      throw new AccountError("account_not_found", "no account with that Hedera account id");
    }
    return publicProfile(updated);
  }

  async #assertAvailable(
    hederaAccountId: string,
    emailNormalized: string,
    usernameNormalized: string,
  ): Promise<void> {
    // Same order as the unique indexes report collisions, so the pre-check and
    // the index never disagree about which field to blame.
    if ((await this.#store.findByAccountId(hederaAccountId)) !== null) {
      throw new AccountError(
        "account_exists",
        "that Hedera account is already registered — sign in instead",
        "hederaAccountId",
      );
    }
    if ((await this.#store.findByEmailNormalized(emailNormalized)) !== null) {
      throw new AccountError("account_exists", "that email is already registered", "email");
    }
    if ((await this.#store.findByUsernameNormalized(usernameNormalized)) !== null) {
      throw new AccountError("account_exists", "that username is taken", "username");
    }
  }

  async #findByIdentifier(identifier: string): Promise<Account | null> {
    const trimmed = identifier.trim();
    switch (classifyIdentifier(trimmed)) {
      case "hederaAccountId":
        return this.#store.findByAccountId(trimmed);
      case "email":
        return this.#store.findByEmailNormalized(normalizeEmail(trimmed));
      case "username":
        return this.#store.findByUsernameNormalized(normalizeUsername(trimmed));
    }
  }

  /**
   * Store the fingerprint first, then try to send.
   *
   * That order matters: if sending were first and the write failed, a real code
   * would be in someone's inbox with nothing on the server to match it.
   */
  async #issueEmailCode(account: Account): Promise<{ sent: boolean; expiresAt: Date }> {
    const code = generateEmailCode();
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_SECONDS * 1000);

    await this.#store.putEmailCode({
      hederaAccountId: account.hederaAccountId,
      emailNormalized: account.emailNormalized,
      codeFingerprint: fingerprint(this.#pepper, emailCodeScope(account.hederaAccountId), code),
      attempts: 0,
      expiresAt,
      createdAt: now,
    });

    try {
      await this.#sendEmailCode({
        to: account.email,
        code,
        firstName: account.firstName,
        expiresAt,
      });
      return { sent: true, expiresAt };
    } catch (error) {
      // Never rethrow with the code in the message: this lands in a log, and a
      // log holding live verification codes is the thing hashing them prevented.
      console.error(
        `failed to send a verification code to account ${account.hederaAccountId}: ${(error as Error).message}`,
      );
      return { sent: false, expiresAt };
    }
  }
}

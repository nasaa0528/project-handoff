/**
 * The wire contract of `apps/accounts-api`, as types a browser build can hold.
 *
 * This package exists because **`apps/web` must not import `@handoff/accounts`.**
 * That package is the server side: it imports `mongodb` and `node:crypto`, and
 * `apps/web`'s tsconfig deliberately has no Node types, so the import fails to
 * compile — and if it somehow did, Vite would bundle a MongoDB driver into the
 * expert app. These types are declared here rather than re-exported from there
 * for exactly that reason.
 *
 * Kept honest by `apps/accounts-api/src/contract.test.ts`, which asserts the
 * server's actual response shapes satisfy the types below. If a route changes and
 * this file does not, that test stops compiling.
 */

/** The profile, as any route returns it. Never carries a password hash. */
export interface AccountProfile {
  readonly hederaAccountId: string;
  readonly email: string;
  readonly username: string;
  readonly firstName: string;
  /** Absent, not null, when the person has no surname. */
  readonly lastName?: string;
  readonly emailVerified: boolean;
  /**
   * Who holds this account's Hedera signing key.
   *
   * `"self"` is an account the person brought and signs with themselves.
   * `"platform"` is one the platform created for them and whose key it stores,
   * encrypted under their password — custody, granted narrowly by
   * `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md` on the
   * condition it is said out loud. A UI showing an expert's account should say
   * which, rather than leaving the judge to ask.
   */
  readonly keyCustody: "platform" | "self";
  /** ISO 8601, UTC. */
  readonly createdAt: string;
}

export interface RegistrationInput {
  /**
   * Omit to have the platform create a testnet account and hold its key
   * encrypted under `password`. Supply one to register an account you already
   * own, in which case no key ever reaches the server.
   *
   * A server with provisioning switched off refuses the omitted form with
   * `validation_failed` on `hederaAccountId`.
   */
  readonly hederaAccountId?: string;
  readonly email: string;
  readonly username: string;
  readonly firstName: string;
  readonly lastName?: string;
  readonly password: string;
}

export interface RegistrationResponse {
  readonly account: AccountProfile;
  /**
   * Present only when the platform created the account. The transaction id is
   * the one that made it — look it up on a mirror node or Hashscan.
   *
   * The private key is deliberately not here and never will be: it is encrypted
   * under the registering password before the row is written.
   */
  readonly accountCreated?: { readonly transactionId: string };
  readonly verification: {
    /**
     * Whether the code reached the mail transport.
     *
     * `false` means the account exists but no code was delivered — show "we could
     * not send the code, try again" and call `requestVerification`, not "your
     * registration failed".
     */
    readonly sent: boolean;
    readonly expiresAt: string;
  };
}

export interface VerificationResponse {
  readonly verification: {
    readonly sent: boolean;
    readonly expiresAt: string;
  };
}

export interface ConfirmationResponse {
  readonly account: AccountProfile;
}

export interface SignInResponse {
  /**
   * The bearer token. Opaque — do not parse it, it is not a JWT.
   *
   * The server stores only a keyed HMAC of this, so it cannot be recovered from
   * the database and there is no "look up my token" route.
   */
  readonly token: string;
  readonly expiresAt: string;
  readonly account: AccountProfile;
}

export interface ProfileResponse {
  readonly account: AccountProfile;
}

/** `null` clears a surname; an absent key leaves it alone. */
export interface ProfilePatchInput {
  readonly firstName?: string;
  readonly lastName?: string | null;
}

/**
 * Every error code the API can answer with.
 *
 * **Branch on `code`, never on `message`.** The messages are written for people
 * and will be reworded; the codes are the contract.
 */
export type AccountsErrorCode =
  // 400
  | "validation_failed"
  | "weak_password"
  | "reserved_username"
  | "unknown_hedera_account"
  | "code_invalid"
  | "malformed_json"
  // 401
  | "unauthenticated"
  | "invalid_credentials"
  // 403
  | "email_not_verified"
  // 404
  | "account_not_found"
  | "not_found"
  // 405
  | "method_not_allowed"
  // 409
  | "account_exists"
  // 410
  | "code_expired"
  // 413
  | "body_too_large"
  // 429
  | "too_many_attempts"
  | "rate_limited"
  // 500, and anything this client did not recognise
  | "internal";

export interface AccountsErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    /** Which input to point the user at, when exactly one is at fault. */
    readonly field?: string;
  };
}

/**
 * Thrown for any non-2xx answer, and for a network failure.
 *
 * One error type rather than a union, because a caller almost always wants
 * "did it work" plus a code to switch on — and a `catch` that has to
 * discriminate between three error classes is a `catch` that gets one wrong.
 */
export class AccountsApiError extends Error {
  constructor(
    readonly code: AccountsErrorCode,
    message: string,
    /** 0 when the request never reached the server. */
    readonly status: number,
    readonly field?: string,
    /** Present on 429. Seconds to wait before retrying. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AccountsApiError";
  }

  /** True when trying the same request later could succeed. */
  get isRetryable(): boolean {
    return this.code === "rate_limited" || this.code === "too_many_attempts" || this.status === 0;
  }

  /**
   * True when the session is gone and the UI should return to sign-in.
   *
   * Both codes mean it: `unauthenticated` for a missing, malformed or expired
   * token, and that is the whole set — a valid token for a deleted account also
   * lands here, because the server cleans the session up.
   */
  get needsSignIn(): boolean {
    return this.code === "unauthenticated";
  }
}

import { describe, expect, it } from "vitest";
import { InMemoryAccountStore } from "./memory-store.js";
import { codePepper, EMAIL_CODE_MAX_ATTEMPTS, EMAIL_CODE_TTL_SECONDS } from "./secrets.js";
import {
  AccountError,
  AccountService,
  type AccountErrorCode,
  type EmailCodeMessage,
  type EmailCodeSender,
} from "./service.js";
import type { AccountExistenceCheck } from "./hedera-account.js";

const pepper = codePepper("deadbeef".repeat(8));

const registration = {
  hederaAccountId: "0.0.10119624",
  email: "Khishgee@Example.com",
  username: "Khishgee",
  firstName: "Batkhishig",
  lastName: "Nasantogtokh",
  password: "correct horse battery",
};

/** A clock the tests move by hand, so expiry needs no waiting. */
class TestClock {
  #now = new Date("2026-09-10T12:00:00Z");
  readonly now = (): Date => new Date(this.#now);
  advanceSeconds(seconds: number): void {
    this.#now = new Date(this.#now.getTime() + seconds * 1000);
  }
}

function setup(
  options: {
    readonly check?: AccountExistenceCheck;
    readonly allowUnverifiedSignIn?: boolean;
    readonly sender?: EmailCodeSender;
  } = {},
) {
  const clock = new TestClock();
  const store = new InMemoryAccountStore(clock.now);
  const sent: EmailCodeMessage[] = [];

  const service = new AccountService({
    store,
    pepper,
    sendEmailCode: options.sender ?? (async (message) => void sent.push(message)),
    ...(options.check === undefined ? {} : { checkHederaAccount: options.check }),
    ...(options.allowUnverifiedSignIn === undefined
      ? {}
      : { allowUnverifiedSignIn: options.allowUnverifiedSignIn }),
    now: clock.now,
  });

  /** The code the service just issued, read from the captured message. */
  const lastCode = (): string => {
    const message = sent.at(-1);
    if (message === undefined) throw new Error("no verification email was sent");
    return message.code;
  };

  return { service, store, sent, clock, lastCode };
}

async function expectCode(promise: Promise<unknown>, code: AccountErrorCode): Promise<AccountError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AccountError);
    expect((error as AccountError).code).toBe(code);
    return error as AccountError;
  }
  throw new Error(`expected the call to fail with ${code}, but it resolved`);
}

describe("register", () => {
  it("creates the account and sends a code", async () => {
    const { service, sent } = setup();
    const result = await service.register(registration);

    expect(result.profile.hederaAccountId).toBe("0.0.10119624");
    expect(result.profile.emailVerified).toBe(false);
    expect(result.verificationSent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("Khishgee@Example.com");
  });

  it("keeps the email and username as typed, and compares them normalised", async () => {
    const { service } = setup();
    const result = await service.register(registration);

    // Display form preserved for the human...
    expect(result.profile.email).toBe("Khishgee@Example.com");
    expect(result.profile.username).toBe("Khishgee");

    // ...while the same address in another case is the same account.
    await expectCode(
      service.register({ ...registration, hederaAccountId: "0.0.2", username: "someoneelse" }),
      "account_exists",
    );
  });

  it("never returns the password hash", async () => {
    const { service } = setup();
    const result = await service.register(registration);
    expect(JSON.stringify(result)).not.toContain("scrypt");
  });

  it("refuses a second registration for the same Hedera account", async () => {
    const { service } = setup();
    await service.register(registration);

    const error = await expectCode(
      service.register({ ...registration, email: "other@example.com", username: "other" }),
      "account_exists",
    );
    expect(error.field).toBe("hederaAccountId");
    expect(error.message).toMatch(/sign in instead/);
  });

  it("refuses a taken username, naming the field so the form can point at it", async () => {
    const { service } = setup();
    await service.register(registration);

    const error = await expectCode(
      service.register({
        ...registration,
        hederaAccountId: "0.0.7007",
        email: "other@example.com",
        username: "khishgee",
      }),
      "account_exists",
    );
    expect(error.field).toBe("username");
  });

  it("refuses a reserved username", async () => {
    const { service } = setup();
    const error = await expectCode(
      service.register({ ...registration, username: "admin" }),
      "reserved_username",
    );
    expect(error.field).toBe("username");
  });

  it("refuses a password containing the username", async () => {
    const { service } = setup();
    const error = await expectCode(
      service.register({ ...registration, password: "Khishgee-2026" }),
      "weak_password",
    );
    expect(error.field).toBe("password");
  });

  it("refuses an account that is not on the ledger", async () => {
    const { service, store } = setup({ check: async () => "missing" });
    const error = await expectCode(service.register(registration), "unknown_hedera_account");

    expect(error.field).toBe("hederaAccountId");
    // Nothing written: a typo must not leave an orphan row holding a username.
    expect(store.size).toBe(0);
  });

  it("registers when the mirror node cannot be reached", async () => {
    // Being unable to check is not evidence of a bad id. Failing closed here
    // would take registration down with a third party.
    const { service } = setup({ check: async () => "unknown" });
    await expect(service.register(registration)).resolves.toMatchObject({ verificationSent: true });
  });

  it("reports a mail failure without losing the account", async () => {
    const { service, store } = setup({
      sender: async () => {
        throw new Error("smtp down");
      },
    });

    const result = await service.register(registration);
    expect(result.verificationSent).toBe(false);
    // The account exists, so the client can ask for another code rather than
    // being told it does not have an account it does have.
    expect(store.size).toBe(1);
  });

  it("rejects an unknown field rather than dropping it", async () => {
    const { service } = setup();
    await expectCode(
      service.register({ ...registration, emailVerifiedAt: "2026-09-10T00:00:00Z" }),
      "validation_failed",
    );
  });

  it("rejects a non-object body", async () => {
    const { service } = setup();
    await expectCode(service.register("not a registration"), "validation_failed");
    await expectCode(service.register(null), "validation_failed");
  });
});

describe("email verification", () => {
  it("verifies with the right code, once", async () => {
    const { service, lastCode } = setup();
    await service.register(registration);

    const profile = await service.confirmEmailCode("0.0.10119624", lastCode());
    expect(profile.emailVerified).toBe(true);

    // Single use: the same code must not work twice. It returns the profile
    // (idempotent for a double-submitted form) but the code is gone.
    await expect(service.confirmEmailCode("0.0.10119624", lastCode())).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("tolerates whitespace around a pasted code", async () => {
    const { service, lastCode } = setup();
    await service.register(registration);
    await expect(service.confirmEmailCode("0.0.10119624", `  ${lastCode()} `)).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("rejects a wrong code", async () => {
    const { service, lastCode } = setup();
    await service.register(registration);

    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const error = await expectCode(service.confirmEmailCode("0.0.10119624", wrong), "code_invalid");
    expect(error.field).toBe("code");
  });

  it("stops accepting a code after the attempt cap, and the right code no longer works", async () => {
    const { service, lastCode } = setup();
    await service.register(registration);
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";

    for (let i = 0; i < EMAIL_CODE_MAX_ATTEMPTS - 1; i += 1) {
      await expectCode(service.confirmEmailCode("0.0.10119624", wrong), "code_invalid");
    }
    await expectCode(service.confirmEmailCode("0.0.10119624", wrong), "too_many_attempts");

    // The cap burns the code, not just the attempt — otherwise guessing resumes
    // as soon as someone gets lucky.
    await expectCode(service.confirmEmailCode("0.0.10119624", right), "code_expired");
  });

  it("expires a code after its TTL", async () => {
    const { service, clock, lastCode } = setup();
    await service.register(registration);

    clock.advanceSeconds(EMAIL_CODE_TTL_SECONDS + 1);
    await expectCode(service.confirmEmailCode("0.0.10119624", lastCode()), "code_expired");
  });

  it("still accepts a code one second before it expires", async () => {
    const { service, clock, lastCode } = setup();
    await service.register(registration);

    clock.advanceSeconds(EMAIL_CODE_TTL_SECONDS - 1);
    await expect(service.confirmEmailCode("0.0.10119624", lastCode())).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const { service, sent } = setup();
    await service.register(registration);
    const first = sent[0]?.code ?? "";

    await service.requestEmailCode("0.0.10119624");
    const second = sent[1]?.code ?? "";

    if (first !== second) {
      await expectCode(service.confirmEmailCode("0.0.10119624", first), "code_invalid");
    }
    await expect(service.confirmEmailCode("0.0.10119624", second)).resolves.toMatchObject({
      emailVerified: true,
    });
  });

  it("refuses a code for an account that does not exist", async () => {
    const { service } = setup();
    await expectCode(service.confirmEmailCode("0.0.999999", "123456"), "account_not_found");
  });

  it("does not accept another account's code", async () => {
    // The fingerprint is bound to the account id, so a code learned for one
    // account is not a credential for another.
    const { service, sent } = setup();
    await service.register(registration);
    await service.register({
      ...registration,
      hederaAccountId: "0.0.7007",
      email: "other@example.com",
      username: "other",
    });

    const firstCode = sent[0]?.code ?? "";
    const secondCode = sent[1]?.code ?? "";

    // Two independent draws from a million values collide about one time in a
    // million; when they do, the first code IS the second one and verifying is
    // correct. secrets.test.ts covers the binding itself deterministically.
    if (firstCode !== secondCode) {
      await expectCode(service.confirmEmailCode("0.0.7007", firstCode), "code_invalid");
    }
  });
});

describe("signIn", () => {
  async function verified() {
    const harness = setup();
    await harness.service.register(registration);
    await harness.service.confirmEmailCode("0.0.10119624", harness.lastCode());
    return harness;
  }

  it("accepts the Hedera account id, the email or the username", async () => {
    const { service } = await verified();

    for (const identifier of ["0.0.10119624", "khishgee@example.com", "khishgee"]) {
      const result = await service.signIn(identifier, registration.password);
      expect(result.profile.hederaAccountId).toBe("0.0.10119624");
      expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("accepts an identifier in any case", async () => {
    const { service } = await verified();
    await expect(service.signIn("KHISHGEE@EXAMPLE.COM", registration.password)).resolves.toBeTruthy();
    await expect(service.signIn("  Khishgee  ", registration.password)).resolves.toBeTruthy();
  });

  it("refuses the wrong password", async () => {
    const { service } = await verified();
    await expectCode(service.signIn("khishgee", "not the password"), "invalid_credentials");
  });

  it("gives an unknown account the identical error, so login is not an oracle", async () => {
    const { service } = await verified();

    const unknown = await expectCode(service.signIn("0.0.424242", "whatever"), "invalid_credentials");
    const wrongPassword = await expectCode(service.signIn("khishgee", "whatever"), "invalid_credentials");

    // Same code and the same words. Anything that differed here would tell an
    // attacker which Hedera accounts are registered experts.
    expect(unknown.message).toBe(wrongPassword.message);
  });

  it("refuses an unverified email by default", async () => {
    const { service } = setup();
    await service.register(registration);
    await expectCode(service.signIn("khishgee", registration.password), "email_not_verified");
  });

  it("allows an unverified sign-in only when explicitly configured", async () => {
    const { service } = setup({ allowUnverifiedSignIn: true });
    await service.register(registration);
    await expect(service.signIn("khishgee", registration.password)).resolves.toBeTruthy();
  });

  it("issues a different token every time", async () => {
    const { service } = await verified();
    const a = await service.signIn("khishgee", registration.password);
    const b = await service.signIn("khishgee", registration.password);
    expect(a.token).not.toBe(b.token);
  });
});

describe("sessions", () => {
  async function signedIn() {
    const harness = setup();
    await harness.service.register(registration);
    await harness.service.confirmEmailCode("0.0.10119624", harness.lastCode());
    const session = await harness.service.signIn("khishgee", registration.password);
    return { ...harness, session };
  }

  it("resolves a token to its account", async () => {
    const { service, session } = await signedIn();
    const account = await service.authenticate(session.token);
    expect(account?.hederaAccountId).toBe("0.0.10119624");
  });

  it("returns null for a bad token rather than throwing", async () => {
    const { service } = await signedIn();
    expect(await service.authenticate("not-a-token")).toBeNull();
    expect(await service.authenticate("")).toBeNull();
  });

  it("stores only a fingerprint, so a database dump holds no usable tokens", async () => {
    const { store, session } = await signedIn();
    // The raw token must not appear anywhere reachable through the store.
    expect(await store.findSession(session.token)).toBeNull();
  });

  it("stops resolving after the session expires", async () => {
    const { service, session, clock } = await signedIn();
    clock.advanceSeconds(7 * 24 * 60 * 60 + 1);
    expect(await service.authenticate(session.token)).toBeNull();
  });

  it("signs out, and signing out twice is not an error", async () => {
    const { service, session } = await signedIn();
    await service.signOut(session.token);
    expect(await service.authenticate(session.token)).toBeNull();
    await expect(service.signOut(session.token)).resolves.toBeUndefined();
  });

  it("leaves other sessions alone when one signs out", async () => {
    const { service, session } = await signedIn();
    const second = await service.signIn("khishgee", registration.password);

    await service.signOut(session.token);
    expect(await service.authenticate(second.token)).not.toBeNull();
  });
});

describe("profile", () => {
  it("reads back what was registered", async () => {
    const { service } = setup();
    await service.register(registration);

    const profile = await service.getProfile("0.0.10119624");
    expect(profile.firstName).toBe("Batkhishig");
    expect(profile.lastName).toBe("Nasantogtokh");
  });

  it("updates a first name and leaves everything else alone", async () => {
    const { service } = setup();
    await service.register(registration);

    const updated = await service.updateProfile("0.0.10119624", { firstName: "Khishgee" });
    expect(updated.firstName).toBe("Khishgee");
    expect(updated.lastName).toBe("Nasantogtokh");
    expect(updated.username).toBe("Khishgee");
  });

  it("clears a surname on an explicit null, and leaves it on an absent key", async () => {
    const { service } = setup();
    await service.register(registration);

    const cleared = await service.updateProfile("0.0.10119624", { lastName: null });
    expect("lastName" in cleared).toBe(false);

    const untouched = await service.updateProfile("0.0.10119624", { firstName: "Khishgee" });
    expect("lastName" in untouched).toBe(false);
  });

  it("refuses to change the identity", async () => {
    const { service } = setup();
    await service.register(registration);

    for (const patch of [
      { hederaAccountId: "0.0.7007" },
      { email: "new@example.com" },
      { username: "someoneelse" },
      { passwordHash: "scrypt$1$1$1$x$y" },
    ]) {
      await expectCode(service.updateProfile("0.0.10119624", patch), "validation_failed");
    }
  });

  it("refuses an empty patch", async () => {
    const { service } = setup();
    await service.register(registration);
    await expectCode(service.updateProfile("0.0.10119624", {}), "validation_failed");
  });

  it("reports a missing account", async () => {
    const { service } = setup();
    await expectCode(service.getProfile("0.0.999999"), "account_not_found");
    await expectCode(service.updateProfile("0.0.999999", { firstName: "X" }), "account_not_found");
  });
});

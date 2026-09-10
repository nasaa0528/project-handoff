import { randomBytes, scrypt, type ScryptOptions } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertPasswordAcceptable,
  burnPasswordTime,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
  WeakPasswordError,
} from "./password.js";

/**
 * scrypt at parameters of our choosing.
 *
 * The callback form directly, because `promisify` resolves to the overload
 * without an options argument and the options are the whole point here.
 */
function scryptAt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(derived);
    });
  });
}

describe("hashPassword", () => {
  it("round-trips", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stapl", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    // Both still verify — the salt is in the record, not in a global.
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("correct horse battery staple", b)).toBe(true);
  });

  it("stores the cost parameters with the hash, so they can be raised later", async () => {
    const stored = await hashPassword("correct horse battery staple");
    const [scheme, N, r, p] = stored.split("$");

    expect(scheme).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it("verifies a record written at a cost this build no longer uses", async () => {
    // The whole point of storing the parameters beside the hash: raising the cost
    // must not force a password reset for everyone already registered. Built here
    // at N=1024 — a value hashPassword will never choose — and it must still
    // verify, because verification reads N out of the record it is checking.
    const salt = randomBytes(16);
    const derived = await scryptAt("correct horse battery staple", salt, 32, { N: 1024, r: 8, p: 1 });
    const legacy = `scrypt$1024$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;

    expect(await verifyPassword("correct horse battery staple", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });

  it("fails a record whose stated parameters do not match how it was made", async () => {
    // Relabelling a record's cost cannot be used to make a hash verify: the
    // parameters are an input to the derivation, not metadata beside it.
    const parts = (await hashPassword("correct horse battery staple")).split("$");
    const relabelled = `scrypt$1024$8$1$${parts[4]}$${parts[5]}`;
    expect(await verifyPassword("correct horse battery staple", relabelled)).toBe(false);
  });

  it("does not accept a password whose length exceeds the KDF bound", async () => {
    expect(() => assertPasswordAcceptable("x".repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(WeakPasswordError);
  });
});

describe("verifyPassword on a malformed record", () => {
  it("returns false rather than throwing, so a corrupt row fails one login", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfivefields",
      "argon2$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
      "scrypt$0$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$0$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$aGFzaA==",
      "scrypt$16384$8$1$c2FsdA==$",
    ]) {
      expect(await verifyPassword("anything", bad), bad).toBe(false);
    }
  });

  it("refuses a record demanding more memory than this process will spend", async () => {
    // A stored value must not dictate the process's memory use: 128 * N * r with
    // N = 2^30 is a terabyte. It returns false instead of trying.
    const stored = `scrypt$${String(2 ** 30)}$8$1$c2FsdA==$aGFzaA==`;
    expect(await verifyPassword("anything", stored)).toBe(false);
  });
});

describe("assertPasswordAcceptable", () => {
  it("enforces a floor on length and nothing about composition", () => {
    expect(() => assertPasswordAcceptable("x".repeat(PASSWORD_MIN_LENGTH - 1))).toThrow(WeakPasswordError);
    // No capital, no digit, no symbol — and that is fine. Length is the control
    // that matters; composition rules only produce Password1!
    expect(() => assertPasswordAcceptable("correct horse battery")).not.toThrow();
  });

  it("refuses a password containing the username, case-insensitively", () => {
    expect(() => assertPasswordAcceptable("Khishgee2026!!", { username: "khishgee" })).toThrow(
      /must not contain your username/,
    );
  });

  it("refuses a password containing the email's local part", () => {
    expect(() =>
      assertPasswordAcceptable("khishgee-secret-1", { email: "khishgee@example.com" }),
    ).toThrow(/must not contain your email/);
  });

  it("ignores the email's domain, which would reject fine passphrases", () => {
    // "example.com" appearing in a passphrase says nothing about guessability,
    // and rejecting it would be a rule the user cannot see.
    expect(() =>
      assertPasswordAcceptable("my example.com passphrase", { email: "someone@example.com" }),
    ).not.toThrow();
  });

  it("does not choke on a very short email local part", () => {
    expect(() => assertPasswordAcceptable("a-long-enough-one", { email: "ab@example.com" })).not.toThrow();
  });
});

describe("burnPasswordTime", () => {
  it("resolves, so the unknown-account login path costs what a real one costs", async () => {
    await expect(burnPasswordTime("anything")).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import {
  codePepper,
  EMAIL_CODE_DIGITS,
  emailCodeScope,
  fingerprint,
  fingerprintsEqual,
  generateEmailCode,
  generateSessionToken,
  InvalidPepperError,
  PEPPER_MIN_HEX_LENGTH,
  SESSION_SCOPE,
} from "./secrets.js";

/** Obviously fake, and low-entropy so no secret scanner mistakes it for a real one. */
const pepper = codePepper("deadbeef".repeat(8));

describe("codePepper", () => {
  it("accepts 32 bytes of hex and lowercases it", () => {
    expect(codePepper("ABCDEF01".repeat(8))).toBe("abcdef01".repeat(8));
  });

  it("refuses anything shorter than the minimum", () => {
    expect(() => codePepper("deadbeef")).toThrow(InvalidPepperError);
    expect(() => codePepper("a".repeat(PEPPER_MIN_HEX_LENGTH - 1))).toThrow(InvalidPepperError);
  });

  it("refuses a non-hex value, which would silently lose entropy in Buffer.from", () => {
    // Buffer.from("zz...", "hex") does not throw — it returns empty. A pepper
    // that parses to zero bytes is no pepper at all, so it is caught here.
    expect(() => codePepper("z".repeat(64))).toThrow(InvalidPepperError);
  });

  it("names the command that generates one, because the error is the documentation", () => {
    expect(() => codePepper("short")).toThrow(/randomBytes\(32\)/);
  });
});

describe("generateEmailCode", () => {
  it("is always the full width, so a small number is not a short code", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateEmailCode();
      expect(code).toHaveLength(EMAIL_CODE_DIGITS);
      expect(code).toMatch(/^\d+$/);
    }
  });

  it("covers the range rather than clustering", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateEmailCode());
    // 500 draws from a million values should essentially never repeat.
    expect(seen.size).toBeGreaterThan(490);
  });
});

describe("generateSessionToken", () => {
  it("is url-safe base64 of 32 bytes", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(generateSessionToken());
    expect(seen.size).toBe(100);
  });
});

describe("fingerprint", () => {
  it("is stable for the same pepper, scope and secret", () => {
    expect(fingerprint(pepper, "scope", "123456")).toBe(fingerprint(pepper, "scope", "123456"));
  });

  it("is 64 hex characters and never the secret itself", () => {
    const printed = fingerprint(pepper, emailCodeScope("0.0.5005"), "123456");
    expect(printed).toMatch(/^[0-9a-f]{64}$/);
    expect(printed).not.toContain("123456");
  });

  it("changes with the pepper, which is what makes a stolen dump useless", () => {
    const other = codePepper("feedface".repeat(8));
    expect(fingerprint(pepper, "scope", "123456")).not.toBe(fingerprint(other, "scope", "123456"));
  });

  it("binds to the account, so one account's code cannot match another's record", () => {
    expect(fingerprint(pepper, emailCodeScope("0.0.5005"), "123456")).not.toBe(
      fingerprint(pepper, emailCodeScope("0.0.7007"), "123456"),
    );
  });

  it("binds to the purpose, so an email code is not a session token", () => {
    expect(fingerprint(pepper, emailCodeScope("0.0.5005"), "abc")).not.toBe(
      fingerprint(pepper, SESSION_SCOPE, "abc"),
    );
  });

  it("cannot be confused by moving the separator between scope and secret", () => {
    // Length-prefixed, so ("a:b", "c") and ("a", "b:c") are different inputs. A
    // plain join would hash them identically, and that collision is a
    // cross-purpose credential rather than a cosmetic bug.
    expect(fingerprint(pepper, "a:b", "c")).not.toBe(fingerprint(pepper, "a", "b:c"));
  });
});

describe("fingerprintsEqual", () => {
  it("matches identical values", () => {
    const a = fingerprint(pepper, "scope", "123456");
    expect(fingerprintsEqual(a, a)).toBe(true);
  });

  it("rejects a different value", () => {
    expect(fingerprintsEqual(fingerprint(pepper, "s", "1"), fingerprint(pepper, "s", "2"))).toBe(false);
  });

  it("returns false on a length mismatch instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths, which would turn a malformed
    // stored value into a 500.
    expect(fingerprintsEqual("abc", "abcd")).toBe(false);
    expect(fingerprintsEqual("", "abcd")).toBe(false);
  });
});

import { AccountsApiError } from "@handoff/accounts-client";
import { describe, expect, it } from "vitest";
import {
  assessRegistration,
  assessSignIn,
  describeAccountsError,
  EMPTY_REGISTRATION,
  isCodeShape,
  PASSWORD_MIN_LENGTH,
  splitFullName,
  usernameFrom,
} from "./accounts";

const GOOD = {
  fullName: "Dr. Sarah Chen",
  email: "sarah@example.com",
  password: "correct-horse-battery-staple",
  hederaAccountId: "0.0.12345",
};

describe("a full name, split the way the server wants it", () => {
  it("keeps everything but the last word as the first name", () => {
    expect(splitFullName("Dr. Sarah Chen")).toEqual({ firstName: "Dr. Sarah", lastName: "Chen" });
  });
  it("leaves the surname absent, never null, for one word", () => {
    expect(splitFullName("  Sarah ")).toEqual({ firstName: "Sarah" });
    expect(splitFullName("")).toEqual({ firstName: "" });
  });
});

describe("a username derived rather than asked for", () => {
  it("takes the email's local part in the server's alphabet", () => {
    expect(usernameFrom("Sarah.Chen+work@example.com", "")).toBe("sarahchenwork");
  });
  it("must start with a letter, and pads to the minimum", () => {
    expect(usernameFrom("42@example.com", "")).toBe("expert");
    expect(usernameFrom("9ab@example.com", "")).toBe("ab_");
  });
  it("falls back to the name, then to a word", () => {
    expect(usernameFrom("", "Sarah Chen")).toBe("sarahchen");
    expect(usernameFrom("", "")).toBe("expert");
  });
  it("never exceeds the server's maximum", () => {
    expect(usernameFrom(`${"a".repeat(50)}@example.com`, "").length).toBe(32);
  });
});

describe("what Create account refuses before asking the server", () => {
  it("is ready with a complete draft", () => {
    expect(assessRegistration(GOOD)).toEqual([]);
  });
  it("lists every missing thing in the order the form shows them", () => {
    const blockers = assessRegistration(EMPTY_REGISTRATION);
    expect(blockers[0]).toBe("Enter your name.");
    expect(blockers[1]).toContain("email");
    expect(blockers[2]).toContain(String(PASSWORD_MIN_LENGTH));
    expect(blockers).toHaveLength(3);
  });
  it("lets the Hedera account be blank, for the service to create, but not malformed", () => {
    expect(assessRegistration({ ...GOOD, hederaAccountId: "" })).toEqual([]);
    expect(assessRegistration({ ...GOOD, hederaAccountId: "not-an-id" })).toHaveLength(1);
  });
  it("holds the server's password floor", () => {
    expect(assessRegistration({ ...GOOD, password: "short" })).toHaveLength(1);
    expect(assessRegistration({ ...GOOD, password: "x".repeat(PASSWORD_MIN_LENGTH) })).toEqual([]);
  });
});

describe("what Sign in refuses", () => {
  it("asks for both, and nothing more", () => {
    expect(assessSignIn("", "")).toEqual(["Enter your email.", "Enter your password."]);
    expect(assessSignIn("0.0.12345", "pw")).toEqual([]);
  });
});

describe("the code's shape", () => {
  it("is six digits, whitespace forgiven", () => {
    expect(isCodeShape(" 123456 ")).toBe(true);
    expect(isCodeShape("12345")).toBe(false);
    expect(isCodeShape("12345a")).toBe(false);
  });
});

describe("what the screen says when the service refused", () => {
  const failure = (code: ConstructorParameters<typeof AccountsApiError>[0], status = 400, field?: string, retry?: number) =>
    describeAccountsError(new AccountsApiError(code, "server words", status, field, retry));

  it("does not tell a wrong password from a missing account", () => {
    expect(failure("invalid_credentials", 401).message).toBe("Those credentials are not right.");
  });
  it("routes an unconfirmed mailbox rather than calling it an error", () => {
    const f = failure("email_not_verified", 403);
    expect(f.needsVerification).toBe(true);
    expect(f.message).not.toMatch(/wrong|not right/i);
  });
  it("sends a gone session back to sign-in", () => {
    expect(failure("unauthenticated", 401).needsSignIn).toBe(true);
  });
  it("tells a retryable code from a dead one", () => {
    expect(failure("code_invalid", 400, "code").codeDead).toBe(false);
    expect(failure("code_expired", 410).codeDead).toBe(true);
    expect(failure("too_many_attempts", 429).codeDead).toBe(true);
  });
  it("says how long to wait when the server said", () => {
    expect(failure("rate_limited", 429, undefined, 42).message).toContain("42 seconds");
  });
  it("points at the field the server named", () => {
    expect(failure("account_exists", 409, "hederaAccountId").field).toBe("hederaAccountId");
  });
  it("says nothing was sent when the service never answered", () => {
    const f = describeAccountsError(new AccountsApiError("internal", "could not reach", 0));
    expect(f.message).toContain("Nothing was sent.");
  });
  it("says in plain words that the service needs the account, when it asks for one", () => {
    const f = describeAccountsError(new AccountsApiError("validation_failed", "Invalid input: expected string, received undefined", 400, "hederaAccountId"));
    expect(f.field).toBe("hederaAccountId");
    expect(f.message).toContain("Enter it below.");
    expect(f.message).not.toMatch(/undefined|string/);
  });
  it("passes the server's own words through for anything else", () => {
    expect(failure("weak_password", 400, "password")).toMatchObject({ message: "server words", field: "password" });
  });
  it("handles a plain Error without pretending it was the service", () => {
    expect(describeAccountsError(new Error("boom")).message).toBe("boom");
  });
});

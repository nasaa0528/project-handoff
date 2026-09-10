import { describe, expect, it } from "vitest";
import {
  classifyIdentifier,
  HederaAccountId,
  isReservedUsername,
  normalizeEmail,
  normalizeUsername,
  ProfileUpdate,
  publicProfile,
  RegistrationRequest,
  Username,
  type Account,
} from "./account.js";

const account: Account = {
  hederaAccountId: "0.0.10119624",
  email: "Khishgee@Example.COM",
  emailNormalized: "khishgee@example.com",
  username: "khishgee",
  usernameNormalized: "khishgee",
  firstName: "Batkhishig",
  lastName: "Nasantogtokh",
  passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
  emailVerifiedAt: null,
  createdAt: new Date("2026-09-10T00:00:00Z"),
  updatedAt: new Date("2026-09-10T00:00:00Z"),
};

describe("HederaAccountId", () => {
  it("accepts the plain shard.realm.num form", () => {
    expect(HederaAccountId.parse("0.0.10119624")).toBe("0.0.10119624");
    expect(HederaAccountId.parse("0.0.1")).toBe("0.0.1");
  });

  it("trims surrounding whitespace, because a pasted id carries it", () => {
    expect(HederaAccountId.parse("  0.0.10119624 ")).toBe("0.0.10119624");
  });

  it("rejects the checksum form rather than normalising it", () => {
    // Two spellings of one account would defeat the unique index that makes this
    // the identity.
    expect(HederaAccountId.safeParse("0.0.10119624-vfmkw").success).toBe(false);
  });

  it("rejects a leading zero, which would be a second spelling of one account", () => {
    expect(HederaAccountId.safeParse("0.0.007").success).toBe(false);
  });

  it("rejects account zero and negative numbers", () => {
    expect(HederaAccountId.safeParse("0.0.0").success).toBe(false);
    expect(HederaAccountId.safeParse("0.0.-5").success).toBe(false);
  });

  it("rejects a non-zero shard or realm", () => {
    expect(HederaAccountId.safeParse("1.0.5").success).toBe(false);
    expect(HederaAccountId.safeParse("0.1.5").success).toBe(false);
  });

  it("rejects an EVM address", () => {
    expect(HederaAccountId.safeParse("0x0000000000000000000000000000000000000001").success).toBe(false);
  });
});

describe("normalisation", () => {
  it("lowercases an email", () => {
    expect(normalizeEmail("  Khishgee@Example.COM ")).toBe("khishgee@example.com");
  });

  it("does NOT apply the gmail dot trick", () => {
    // Stripping dots is a Gmail policy, not an email one. Applying it everywhere
    // silently merges two different mailboxes into one identity.
    expect(normalizeEmail("first.last@example.com")).toBe("first.last@example.com");
    expect(normalizeEmail("user+tag@example.com")).toBe("user+tag@example.com");
  });

  it("lowercases a username, so Khishgee and khishgee are one account", () => {
    expect(normalizeUsername("Khishgee")).toBe("khishgee");
  });
});

describe("Username", () => {
  it("accepts letters, digits and underscore", () => {
    expect(Username.safeParse("khishgee_07").success).toBe(true);
  });

  it("requires a leading letter", () => {
    expect(Username.safeParse("07khishgee").success).toBe(false);
    expect(Username.safeParse("_khishgee").success).toBe(false);
  });

  it("rejects punctuation and non-Latin scripts that invite look-alikes", () => {
    expect(Username.safeParse("khish.gee").success).toBe(false);
    expect(Username.safeParse("khish-gee").success).toBe(false);
    // Cyrillic 'а' beside Latin 'a' is the impersonation this rule exists for.
    expect(Username.safeParse("khishgeе").success).toBe(false);
  });

  it("enforces the length bounds", () => {
    expect(Username.safeParse("ab").success).toBe(false);
    expect(Username.safeParse(`a${"b".repeat(32)}`).success).toBe(false);
  });

  it("reserves names a route or a support address already answers to", () => {
    expect(isReservedUsername("admin")).toBe(true);
    expect(isReservedUsername("ADMIN")).toBe(true);
    expect(isReservedUsername("handoff")).toBe(true);
    expect(isReservedUsername("verifier")).toBe(true);
    expect(isReservedUsername("khishgee")).toBe(false);
  });
});

describe("RegistrationRequest", () => {
  const valid = {
    hederaAccountId: "0.0.10119624",
    email: "khishgee@example.com",
    username: "khishgee",
    firstName: "Batkhishig",
    password: "correct horse battery",
  };

  it("accepts a registration with no surname, because mononyms are real", () => {
    expect(RegistrationRequest.safeParse(valid).success).toBe(true);
  });

  it("accepts non-Latin names", () => {
    const parsed = RegistrationRequest.safeParse({ ...valid, firstName: "Батхишиг" });
    expect(parsed.success).toBe(true);
  });

  it("refuses an unknown key instead of dropping it", () => {
    // A client posting { emailVerified: true } gets a 400, not a silent success.
    const parsed = RegistrationRequest.safeParse({ ...valid, emailVerified: true });
    expect(parsed.success).toBe(false);
  });

  it("rejects a whitespace-only first name", () => {
    expect(RegistrationRequest.safeParse({ ...valid, firstName: "   " }).success).toBe(false);
  });
});

describe("publicProfile", () => {
  it("never carries the password hash or the normalised duplicates", () => {
    const profile = publicProfile(account);
    const keys = Object.keys(profile);

    expect(keys).not.toContain("passwordHash");
    expect(keys).not.toContain("emailNormalized");
    expect(keys).not.toContain("usernameNormalized");
    expect(JSON.stringify(profile)).not.toContain("scrypt");
  });

  it("reports emailVerified as a boolean, not a timestamp", () => {
    expect(publicProfile(account).emailVerified).toBe(false);
    expect(publicProfile({ ...account, emailVerifiedAt: new Date() }).emailVerified).toBe(true);
  });

  it("omits an absent surname rather than emitting null", () => {
    const withoutLast: Account = { ...account };
    delete (withoutLast as { lastName?: string }).lastName;
    expect("lastName" in publicProfile(withoutLast)).toBe(false);
  });
});

describe("classifyIdentifier", () => {
  it("reads a Hedera account id by shape", () => {
    expect(classifyIdentifier("0.0.10119624")).toBe("hederaAccountId");
  });

  it("reads an email by the @", () => {
    expect(classifyIdentifier("khishgee@example.com")).toBe("email");
  });

  it("falls back to username", () => {
    expect(classifyIdentifier("khishgee")).toBe("username");
  });
});

describe("ProfileUpdate", () => {
  it("distinguishes clearing a surname from leaving it alone", () => {
    expect(ProfileUpdate.safeParse({ lastName: null }).success).toBe(true);
    expect(ProfileUpdate.safeParse({ firstName: "Khishgee" }).success).toBe(true);
  });

  it("refuses an empty patch, which would be a write that changes nothing", () => {
    expect(ProfileUpdate.safeParse({}).success).toBe(false);
  });

  it("refuses to let the identity be edited", () => {
    expect(ProfileUpdate.safeParse({ hederaAccountId: "0.0.999" }).success).toBe(false);
    expect(ProfileUpdate.safeParse({ email: "new@example.com" }).success).toBe(false);
    expect(ProfileUpdate.safeParse({ username: "someoneelse" }).success).toBe(false);
  });
});

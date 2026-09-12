/**
 * The behaviour every `AccountStore` must have, run against each implementation.
 *
 * Not a convenience — a correctness device. `InMemoryAccountStore` is what the
 * service tests run against, so any way it is more permissive than Mongo is a
 * suite that passes while the product is broken. Both implementations execute
 * this file, so a difference in duplicate reporting, patch semantics or expiry
 * shows up here rather than on demo day.
 *
 * Real time rather than an injected clock: `MongoAccountStore` reads the system
 * clock for expiry and cannot be handed a fake one, so expiry is exercised with
 * dates already in the past. Anything that genuinely needs a controllable clock
 * belongs in the in-memory suite, which has one.
 */

import { describe, expect, it, afterAll, beforeAll, beforeEach } from "vitest";
import type { Account } from "./account.js";
import { DuplicateAccountError, type AccountStore } from "./store.js";

export interface StoreHarness {
  readonly store: AccountStore;
  /** Empty the store between tests. */
  reset(): Promise<void>;
  teardown(): Promise<void>;
}

const base: Account = {
  hederaAccountId: "0.0.10119624",
  email: "Khishgee@Example.com",
  emailNormalized: "khishgee@example.com",
  username: "Khishgee",
  usernameNormalized: "khishgee",
  firstName: "Batkhishig",
  lastName: "Nasantogtokh",
  passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
  emailVerifiedAt: null,
  createdAt: new Date("2026-09-10T12:00:00Z"),
  updatedAt: new Date("2026-09-10T12:00:00Z"),
};

const past = (): Date => new Date(Date.now() - 60_000);
const future = (): Date => new Date(Date.now() + 600_000);

export function describeStoreContract(name: string, createHarness: () => Promise<StoreHarness>): void {
  describe(`AccountStore contract: ${name}`, () => {
    let harness: StoreHarness;

    // Built once, in beforeAll with a generous timeout: a real mongod has to
    // start, and on a cold machine the binary is downloaded first. Doing it
    // lazily in beforeEach put that on a 10-second hook budget and every test in
    // the first group failed on the clock rather than on behaviour.
    beforeAll(async () => {
      harness = await createHarness();
    }, 180_000);

    beforeEach(async () => {
      await harness.reset();
    });

    afterAll(async () => {
      await harness?.teardown();
    }, 60_000);

    const store = (): AccountStore => harness.store;

    describe("accounts", () => {
      it("reads back by all three keys, using the normalised columns", async () => {
        await store().createAccount(base);

        expect((await store().findByAccountId("0.0.10119624"))?.username).toBe("Khishgee");
        expect((await store().findByEmailNormalized("khishgee@example.com"))?.username).toBe("Khishgee");
        expect((await store().findByUsernameNormalized("khishgee"))?.username).toBe("Khishgee");
      });

      it("preserves the display form of email and username", async () => {
        await store().createAccount(base);
        const found = await store().findByAccountId("0.0.10119624");

        expect(found?.email).toBe("Khishgee@Example.com");
        expect(found?.username).toBe("Khishgee");
      });

      it("round-trips the encrypted key, and leaves it absent when there is none", async () => {
        // Both implementations must agree, or a key stored against Mongo would
        // read back as an account with no custody — an expert who cannot sign.
        const blob = "hvk1$16384$8$1$c2FsdA==$aXYxMjM0NTY3OA==$dGFn$Y2lwaGVy";
        await store().createAccount({ ...base, encryptedPrivateKey: blob });
        expect((await store().findByAccountId("0.0.10119624"))?.encryptedPrivateKey).toBe(blob);

        await store().createAccount({
          ...base,
          hederaAccountId: "0.0.10119625",
          emailNormalized: "other@example.com",
          email: "other@example.com",
          username: "Other",
          usernameNormalized: "other",
        });
        const brought = await store().findByAccountId("0.0.10119625");
        expect(brought).not.toBeNull();
        expect("encryptedPrivateKey" in (brought as object)).toBe(false);
      });

      it("returns null for a miss rather than throwing", async () => {
        expect(await store().findByAccountId("0.0.1")).toBeNull();
        expect(await store().findByEmailNormalized("nobody@example.com")).toBeNull();
        expect(await store().findByUsernameNormalized("nobody")).toBeNull();
      });

      it("round-trips an account with no surname as an absent key, never null", async () => {
        const mononym: Account = { ...base };
        delete (mononym as { lastName?: string }).lastName;
        await store().createAccount(mononym);

        const found = await store().findByAccountId("0.0.10119624");
        expect(found).not.toBeNull();
        expect(found === null ? true : "lastName" in found).toBe(false);
      });

      it("round-trips a verified timestamp", async () => {
        const verifiedAt = new Date("2026-09-10T13:00:00Z");
        await store().createAccount({ ...base, emailVerifiedAt: verifiedAt });

        expect((await store().findByAccountId("0.0.10119624"))?.emailVerifiedAt?.toISOString()).toBe(
          verifiedAt.toISOString(),
        );
      });

      it("refuses a duplicate account id", async () => {
        await store().createAccount(base);
        await expect(store().createAccount(base)).rejects.toBeInstanceOf(DuplicateAccountError);
      });

      it("refuses a duplicate email, naming that field", async () => {
        await store().createAccount(base);
        await expect(
          store().createAccount({
            ...base,
            hederaAccountId: "0.0.7007",
            username: "other",
            usernameNormalized: "other",
          }),
        ).rejects.toMatchObject({ field: "email" });
      });

      it("refuses a duplicate username, naming that field", async () => {
        await store().createAccount(base);
        await expect(
          store().createAccount({
            ...base,
            hederaAccountId: "0.0.7007",
            email: "other@example.com",
            emailNormalized: "other@example.com",
          }),
        ).rejects.toMatchObject({ field: "username" });
      });

      it("reports the account id first when a row collides on more than one field", async () => {
        // Mongo checks `_id` before the other indexes and cannot report anything
        // else first, so the in-memory store must agree.
        await store().createAccount(base);
        await expect(store().createAccount(base)).rejects.toMatchObject({ field: "hederaAccountId" });
      });

      it("is an insert, never an upsert — a duplicate must not overwrite a password", async () => {
        await store().createAccount(base);
        await expect(
          store().createAccount({ ...base, passwordHash: "scrypt$16384$8$1$b3RoZXI=$b3RoZXI=" }),
        ).rejects.toBeInstanceOf(DuplicateAccountError);

        expect((await store().findByAccountId("0.0.10119624"))?.passwordHash).toBe(base.passwordHash);
      });
    });

    describe("updateProfile", () => {
      it("returns null for an account that does not exist", async () => {
        expect(await store().updateProfile("0.0.1", { firstName: "X" })).toBeNull();
      });

      it("changes a named field and leaves the others", async () => {
        await store().createAccount(base);
        const patched = await store().updateProfile("0.0.10119624", { firstName: "Khishgee" });

        expect(patched?.firstName).toBe("Khishgee");
        expect(patched?.lastName).toBe("Nasantogtokh");
        expect(patched?.email).toBe("Khishgee@Example.com");
      });

      it("clears a surname on an explicit null", async () => {
        await store().createAccount(base);
        const cleared = await store().updateProfile("0.0.10119624", { lastName: null });

        expect(cleared === null ? true : "lastName" in cleared).toBe(false);
        // And it stays gone on the next read, rather than only in the returned copy.
        const reread = await store().findByAccountId("0.0.10119624");
        expect(reread === null ? true : "lastName" in reread).toBe(false);
      });

      it("leaves a surname alone when the key is absent", async () => {
        await store().createAccount(base);
        await store().updateProfile("0.0.10119624", { firstName: "Khishgee" });

        expect((await store().findByAccountId("0.0.10119624"))?.lastName).toBe("Nasantogtokh");
      });

      it("moves updatedAt and never createdAt", async () => {
        await store().createAccount(base);
        const patched = await store().updateProfile("0.0.10119624", { firstName: "Khishgee" });

        expect(patched?.createdAt.toISOString()).toBe(base.createdAt.toISOString());
        // The fixture's timestamps are fixed in the past, so any real clock is after.
        expect(patched?.updatedAt.getTime()).toBeGreaterThan(base.updatedAt.getTime());
      });
    });

    describe("markEmailVerified", () => {
      it("sets the timestamp", async () => {
        await store().createAccount(base);
        const verifiedAt = new Date("2026-09-10T14:00:00Z");
        await store().markEmailVerified("0.0.10119624", verifiedAt);

        expect((await store().findByAccountId("0.0.10119624"))?.emailVerifiedAt?.toISOString()).toBe(
          verifiedAt.toISOString(),
        );
      });

      it("is idempotent, and a missing account is not an error", async () => {
        await store().createAccount(base);
        await store().markEmailVerified("0.0.10119624", new Date());
        await expect(store().markEmailVerified("0.0.10119624", new Date())).resolves.toBeUndefined();
        await expect(store().markEmailVerified("0.0.999999", new Date())).resolves.toBeUndefined();
      });
    });

    describe("email codes", () => {
      const record = () => ({
        hederaAccountId: "0.0.10119624",
        emailNormalized: "khishgee@example.com",
        codeFingerprint: "a".repeat(64),
        attempts: 0,
        expiresAt: future(),
        createdAt: new Date(),
      });

      it("stores one code per account, replacing the previous", async () => {
        await store().putEmailCode(record());
        await store().putEmailCode({ ...record(), codeFingerprint: "b".repeat(64) });

        expect((await store().findEmailCode("0.0.10119624"))?.codeFingerprint).toBe("b".repeat(64));
      });

      it("round-trips every field", async () => {
        const written = record();
        await store().putEmailCode(written);
        const read = await store().findEmailCode("0.0.10119624");

        expect(read?.hederaAccountId).toBe(written.hederaAccountId);
        expect(read?.emailNormalized).toBe(written.emailNormalized);
        expect(read?.codeFingerprint).toBe(written.codeFingerprint);
        expect(read?.attempts).toBe(0);
      });

      it("reads an already-expired code as no code at all", async () => {
        // In Mongo the TTL index is only cleanup — its monitor wakes about once a
        // minute — so the read has to enforce this or a code outlives its expiry.
        await store().putEmailCode({ ...record(), expiresAt: past() });
        expect(await store().findEmailCode("0.0.10119624")).toBeNull();
      });

      it("returns null for an account with no pending code", async () => {
        expect(await store().findEmailCode("0.0.999999")).toBeNull();
      });

      it("counts attempts without losing an increment under concurrency", async () => {
        await store().putEmailCode(record());

        // A read-modify-write loses increments here, and a lost increment is a
        // lost attempt cap.
        const counts = await Promise.all(
          Array.from({ length: 5 }, () => store().recordEmailCodeAttempt("0.0.10119624")),
        );

        expect(Math.max(...counts)).toBe(5);
        expect(new Set(counts).size).toBe(5);
        expect((await store().findEmailCode("0.0.10119624"))?.attempts).toBe(5);
      });

      it("reports zero attempts when there is no code to count against", async () => {
        expect(await store().recordEmailCodeAttempt("0.0.999999")).toBe(0);
      });

      it("deletes, idempotently", async () => {
        await store().putEmailCode(record());
        await store().deleteEmailCode("0.0.10119624");
        await expect(store().deleteEmailCode("0.0.10119624")).resolves.toBeUndefined();
        expect(await store().findEmailCode("0.0.10119624")).toBeNull();
      });
    });

    describe("sessions", () => {
      const session = () => ({
        tokenFingerprint: "c".repeat(64),
        hederaAccountId: "0.0.10119624",
        expiresAt: future(),
        createdAt: new Date(),
      });

      it("finds a live session by its fingerprint", async () => {
        await store().createSession(session());
        const found = await store().findSession("c".repeat(64));

        expect(found?.hederaAccountId).toBe("0.0.10119624");
        expect(found?.tokenFingerprint).toBe("c".repeat(64));
      });

      it("reads an expired session as absent", async () => {
        await store().createSession({ ...session(), expiresAt: past() });
        expect(await store().findSession("c".repeat(64))).toBeNull();
      });

      it("returns null for an unknown fingerprint", async () => {
        expect(await store().findSession("d".repeat(64))).toBeNull();
      });

      it("holds more than one session per account, for more than one device", async () => {
        await store().createSession(session());
        await store().createSession({ ...session(), tokenFingerprint: "e".repeat(64) });

        expect(await store().findSession("c".repeat(64))).not.toBeNull();
        expect(await store().findSession("e".repeat(64))).not.toBeNull();
      });

      it("deletes one session without touching another", async () => {
        await store().createSession(session());
        await store().createSession({ ...session(), tokenFingerprint: "e".repeat(64) });

        await store().deleteSession("c".repeat(64));
        expect(await store().findSession("c".repeat(64))).toBeNull();
        expect(await store().findSession("e".repeat(64))).not.toBeNull();
      });

      it("deletes, idempotently", async () => {
        await store().createSession(session());
        await store().deleteSession("c".repeat(64));
        await expect(store().deleteSession("c".repeat(64))).resolves.toBeUndefined();
      });
    });
  });
}

import { describe, expect, it } from "vitest";
import { InMemoryAccountStore } from "./memory-store.js";
import { describeStoreContract } from "./store-contract.js";
import type { Account } from "./account.js";

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

class TestClock {
  #now = new Date("2026-09-10T12:00:00Z");
  readonly now = (): Date => new Date(this.#now);
  advanceSeconds(seconds: number): void {
    this.#now = new Date(this.#now.getTime() + seconds * 1000);
  }
}

// The same suite MongoAccountStore runs. Any way this store is more permissive
// than the database is a service-test suite that passes while the product is
// broken, so both implementations answer to one contract.
describeStoreContract("InMemoryAccountStore", async () => {
  let store = new InMemoryAccountStore();
  return {
    get store() {
      return store;
    },
    async reset() {
      store = new InMemoryAccountStore();
    },
    async teardown() {
      await store.close();
    },
  };
});

describe("expiry, on a clock the test controls", () => {
  it("stops returning a code the moment its TTL passes", async () => {
    const clock = new TestClock();
    const store = new InMemoryAccountStore(clock.now);
    const record = {
      hederaAccountId: "0.0.10119624",
      emailNormalized: "khishgee@example.com",
      codeFingerprint: "a".repeat(64),
      attempts: 0,
      expiresAt: new Date("2026-09-10T12:10:00Z"),
      createdAt: new Date("2026-09-10T12:00:00Z"),
    };
    await store.putEmailCode(record);

    clock.advanceSeconds(599);
    expect(await store.findEmailCode("0.0.10119624")).not.toBeNull();

    // Exactly at expiry, not a second later: expiresAt is the first moment the
    // code is dead, so the boundary is <= rather than <.
    clock.advanceSeconds(1);
    expect(await store.findEmailCode("0.0.10119624")).toBeNull();
  });

  it("stops returning a session the moment it expires", async () => {
    const clock = new TestClock();
    const store = new InMemoryAccountStore(clock.now);
    await store.createSession({
      tokenFingerprint: "c".repeat(64),
      hederaAccountId: "0.0.10119624",
      expiresAt: new Date("2026-09-17T12:00:00Z"),
      createdAt: new Date("2026-09-10T12:00:00Z"),
    });

    clock.advanceSeconds(7 * 24 * 60 * 60 - 1);
    expect(await store.findSession("c".repeat(64))).not.toBeNull();

    clock.advanceSeconds(1);
    expect(await store.findSession("c".repeat(64))).toBeNull();
  });

  it("takes updatedAt from the injected clock, not the wall clock", async () => {
    const clock = new TestClock();
    const store = new InMemoryAccountStore(clock.now);
    await store.createAccount(base);

    clock.advanceSeconds(60);
    const patched = await store.updateProfile("0.0.10119624", { firstName: "Khishgee" });
    expect(patched?.updatedAt.toISOString()).toBe("2026-09-10T12:01:00.000Z");
  });
});

describe("stored state is isolated from the caller", () => {
  it("does not let a caller mutate the store through a returned Date", async () => {
    // `readonly` is compile-time only and says nothing about the object a Date
    // reference points at, so the store copies on the way out. The Mongo store
    // gets this for free — its documents are decoded fresh from BSON.
    const store = new InMemoryAccountStore();
    await store.createAccount(base);

    (await store.findByAccountId("0.0.10119624"))?.createdAt.setFullYear(1999);
    expect((await store.findByAccountId("0.0.10119624"))?.createdAt.getFullYear()).toBe(2026);
  });

  it("does not let the object handed to createAccount change the stored row", async () => {
    const store = new InMemoryAccountStore();
    const mutable = { ...base, createdAt: new Date("2026-09-10T12:00:00Z") };
    await store.createAccount(mutable);

    mutable.createdAt.setFullYear(1999);
    expect((await store.findByAccountId("0.0.10119624"))?.createdAt.getFullYear()).toBe(2026);
  });

  it("reports how many accounts it holds, for the service tests", async () => {
    const store = new InMemoryAccountStore();
    expect(store.size).toBe(0);
    await store.createAccount(base);
    expect(store.size).toBe(1);
  });
});

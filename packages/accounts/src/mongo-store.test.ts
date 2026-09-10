/**
 * `MongoAccountStore` against a real mongod.
 *
 * `mongodb-memory-server` runs an actual MongoDB process, so the unique indexes,
 * the duplicate-key error shape, `$unset`, `$inc` and the TTL indexes are
 * exercised as they behave in production rather than as this code hopes they do.
 * The one thing a hand-written double cannot check is the thing most likely to be
 * wrong: `duplicateKeyField` reads `error.keyPattern` off a driver error, and
 * only a real server produces that.
 *
 * First run downloads a mongod binary and caches it under
 * `~/.cache/mongodb-binaries`. If that is not wanted on a machine or in CI, set
 * `SKIP_MONGO_TESTS=1` — the contract still runs against the in-memory store, so
 * skipping loses the database-specific checks and nothing else.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoAccountStore } from "./mongo-store.js";
import { describeStoreContract } from "./store-contract.js";
import type { Account } from "./account.js";

const skip = process.env["SKIP_MONGO_TESTS"] === "1";

/**
 * One mongod for the whole file, started lazily.
 *
 * Starting a server per test would multiply a slow thing by the number of tests;
 * `reset()` in the harness clears the collections between them instead.
 */
let server: MongoMemoryServer | undefined;

async function uri(): Promise<string> {
  server ??= await MongoMemoryServer.create();
  return server.getUri();
}

// Guarded rather than `describe.skipIf`, because the factory itself starts a
// mongod and skipping has to mean "do not start one".
if (!skip) {
  describeStoreContract("MongoAccountStore", async () => {
    const store = await MongoAccountStore.connect({
      uri: await uri(),
      databaseName: "handoff_test",
    });
    const client = new MongoClient(await uri());
    await client.connect();
    const db = client.db("handoff_test");

    return {
      store,
      async reset() {
        // Delete the documents, keep the indexes. Dropping the collections would
        // drop the unique indexes too, and then the contract's duplicate tests
        // would pass for the wrong reason.
        await Promise.all([
          db.collection("accounts").deleteMany({}),
          db.collection("emailCodes").deleteMany({}),
          db.collection("sessions").deleteMany({}),
        ]);
      },
      async teardown() {
        await store.close();
        await client.close();
        await server?.stop();
        server = undefined;
      },
    };
  });
}

describe.skipIf(skip)("MongoAccountStore specifics", () => {
  let store: MongoAccountStore;
  let client: MongoClient;

  const base: Account = {
    hederaAccountId: "0.0.10119624",
    email: "khishgee@example.com",
    emailNormalized: "khishgee@example.com",
    username: "khishgee",
    usernameNormalized: "khishgee",
    firstName: "Batkhishig",
    lastName: "Nasantogtokh",
    passwordHash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    emailVerifiedAt: null,
    createdAt: new Date("2026-09-10T12:00:00Z"),
    updatedAt: new Date("2026-09-10T12:00:00Z"),
  };

  /** Typed handle: an untyped collection defaults `_id` to ObjectId. */
  const rawAccounts = () =>
    client.db("specifics").collection<{ _id: string; lastName?: string }>("accounts");

  beforeAll(async () => {
    const connectionString = await uri();
    store = await MongoAccountStore.connect({ uri: connectionString, databaseName: "specifics" });
    client = new MongoClient(connectionString);
    await client.connect();
  }, 180_000);

  afterAll(async () => {
    await store.close();
    await client.close();
    await server?.stop();
    server = undefined;
  }, 60_000);

  it("stores the Hedera account id as _id, so the identity needs no second index", async () => {
    await rawAccounts().deleteMany({});
    await store.createAccount(base);

    const raw = await rawAccounts().findOne({});
    expect(raw?._id).toBe("0.0.10119624");
    // Not duplicated into a field of its own — one index, one source of truth.
    expect(Object.keys(raw ?? {})).not.toContain("hederaAccountId");
  });

  it("creates the unique indexes, and creating them twice is not an error", async () => {
    await store.ensureIndexes();
    const indexes = await rawAccounts().indexes();
    const byName = new Map(indexes.map((index) => [index.name, index]));

    expect(byName.get("email_unique")?.unique).toBe(true);
    expect(byName.get("username_unique")?.unique).toBe(true);
  });

  it("creates TTL indexes on both expiring collections", async () => {
    const codes = await client.db("specifics").collection("emailCodes").indexes();
    const sessions = await client.db("specifics").collection("sessions").indexes();

    expect(codes.find((index) => index.name === "code_ttl")?.expireAfterSeconds).toBe(0);
    expect(sessions.find((index) => index.name === "session_ttl")?.expireAfterSeconds).toBe(0);
  });

  it("does not make the session index unique, so one person may use two devices", async () => {
    const sessions = await client.db("specifics").collection("sessions").indexes();
    expect(sessions.find((index) => index.name === "session_by_account")?.unique).toBeUndefined();
  });

  it("reads a real duplicate-key error's keyPattern to name the field", async () => {
    // The whole reason for a real server: `duplicateKeyField` parses an error
    // shape the driver produces, and a fake cannot produce it.
    await rawAccounts().deleteMany({});
    await store.createAccount(base);

    await expect(
      store.createAccount({
        ...base,
        hederaAccountId: "0.0.7007",
        username: "other",
        usernameNormalized: "other",
      }),
    ).rejects.toMatchObject({ name: "DuplicateAccountError", field: "email" });

    await expect(
      store.createAccount({
        ...base,
        hederaAccountId: "0.0.7007",
        email: "other@example.com",
        emailNormalized: "other@example.com",
      }),
    ).rejects.toMatchObject({ name: "DuplicateAccountError", field: "username" });
  });

  it("removes the lastName key with $unset rather than storing a null", async () => {
    await rawAccounts().deleteMany({});
    await store.createAccount(base);
    await store.updateProfile("0.0.10119624", { lastName: null });

    const raw = await rawAccounts().findOne({ _id: "0.0.10119624" });
    expect(raw).not.toBeNull();
    expect("lastName" in (raw ?? {})).toBe(false);
  });

  it("sweeps an expired code on read, so the row does not linger until the TTL monitor wakes", async () => {
    await client.db("specifics").collection("emailCodes").deleteMany({});
    await store.putEmailCode({
      hederaAccountId: "0.0.10119624",
      emailNormalized: "khishgee@example.com",
      codeFingerprint: "a".repeat(64),
      attempts: 0,
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    });

    expect(await store.findEmailCode("0.0.10119624")).toBeNull();
    expect(await client.db("specifics").collection("emailCodes").countDocuments()).toBe(0);
  });

  it("refuses to hand back a store whose indexes could not be built", async () => {
    // The constructor is private, so there is no way to hold a store with no
    // unique indexes — without them, uniqueness is enforced by nothing.
    await expect(
      MongoAccountStore.connect({
        uri: "mongodb://127.0.0.1:1/handoff",
        serverSelectionTimeoutMs: 300,
      }),
    ).rejects.toThrow();
  });
});

/**
 * MongoDB `AccountStore`.
 *
 * The Hedera account id is the document `_id`. That is not a shortcut — it means
 * the identity constraint is enforced by the index Mongo always builds, so there
 * is no window in which two documents claim the same account, and no second
 * collection to keep in step.
 *
 * Three collections: `accounts`, `emailCodes`, `sessions`.
 */

import { MongoClient, type Collection, type Db, type MongoClientOptions } from "mongodb";
import type { Account } from "./account.js";
import {
  AccountStoreError,
  DuplicateAccountError,
  type AccountStore,
  type EmailCodeRecord,
  type ProfilePatch,
  type SessionRecord,
  type UniqueField,
} from "./store.js";

/**
 * The stored shapes.
 *
 * `lastName` is `?: string` rather than `string | null` — an absent surname is an
 * absent key, so no document carries a null that every reader would have to
 * special-case.
 */
interface AccountDoc {
  _id: string;
  email: string;
  emailNormalized: string;
  username: string;
  usernameNormalized: string;
  firstName: string;
  lastName?: string;
  passwordHash: string;
  /** Present only for accounts the platform created. See key-vault.ts. */
  encryptedPrivateKey?: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EmailCodeDoc {
  _id: string;
  emailNormalized: string;
  codeFingerprint: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

interface SessionDoc {
  _id: string;
  hederaAccountId: string;
  expiresAt: Date;
  createdAt: Date;
}

function toAccount(doc: AccountDoc): Account {
  return {
    hederaAccountId: doc._id,
    email: doc.email,
    emailNormalized: doc.emailNormalized,
    username: doc.username,
    usernameNormalized: doc.usernameNormalized,
    firstName: doc.firstName,
    ...(doc.lastName === undefined ? {} : { lastName: doc.lastName }),
    passwordHash: doc.passwordHash,
    ...(doc.encryptedPrivateKey === undefined ? {} : { encryptedPrivateKey: doc.encryptedPrivateKey }),
    emailVerifiedAt: doc.emailVerifiedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDoc(account: Account): AccountDoc {
  return {
    _id: account.hederaAccountId,
    email: account.email,
    emailNormalized: account.emailNormalized,
    username: account.username,
    usernameNormalized: account.usernameNormalized,
    firstName: account.firstName,
    ...(account.lastName === undefined ? {} : { lastName: account.lastName }),
    passwordHash: account.passwordHash,
    ...(account.encryptedPrivateKey === undefined
      ? {}
      : { encryptedPrivateKey: account.encryptedPrivateKey }),
    emailVerifiedAt: account.emailVerifiedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * Which unique index refused the write.
 *
 * Read structurally rather than with `instanceof MongoServerError`, because two
 * copies of the driver in one dependency tree give two different classes and the
 * `instanceof` silently stops matching. The error code and `keyPattern` are stable
 * wire-level facts.
 *
 * `"unknown"` is separate from `null` on purpose: `null` means "not a duplicate at
 * all", while `"unknown"` means a duplicate on an index nobody here declared —
 * which is a real conflict and must not be reported as one of the three fields a
 * client can act on.
 */
function duplicateKeyField(error: unknown): UniqueField | "unknown" | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as { code?: unknown; keyPattern?: unknown };
  if (candidate.code !== 11000) return null;

  const pattern = candidate.keyPattern;
  if (typeof pattern !== "object" || pattern === null) return "unknown";

  const keys = Object.keys(pattern);
  if (keys.includes("_id")) return "hederaAccountId";
  if (keys.includes("emailNormalized")) return "email";
  if (keys.includes("usernameNormalized")) return "username";
  return "unknown";
}

export interface MongoAccountStoreConfig {
  /** A standard connection string. Never committed — it carries credentials. */
  readonly uri: string;
  /** Defaults to `handoff`. */
  readonly databaseName?: string;
  /**
   * How long to wait for a reachable server.
   *
   * Well under the driver's 30-second default. A registration endpoint that hangs
   * for half a minute before failing is worse than one that says "no database" at
   * once, and during a demo the difference is between a visible error and a
   * frozen screen.
   */
  readonly serverSelectionTimeoutMs?: number;
}

export class MongoAccountStore implements AccountStore {
  readonly #client: MongoClient;
  readonly #accounts: Collection<AccountDoc>;
  readonly #emailCodes: Collection<EmailCodeDoc>;
  readonly #sessions: Collection<SessionDoc>;

  private constructor(client: MongoClient, db: Db) {
    this.#client = client;
    this.#accounts = db.collection<AccountDoc>("accounts");
    this.#emailCodes = db.collection<EmailCodeDoc>("emailCodes");
    this.#sessions = db.collection<SessionDoc>("sessions");
  }

  /**
   * Connect and make sure the indexes exist before returning.
   *
   * The constructor is private so there is no way to hold a store whose unique
   * indexes have not been created. Without them the uniqueness of email and
   * username is enforced by nothing at all — the reads in `service.ts` narrow the
   * race but cannot close it, and two simultaneous registrations for one username
   * would both succeed.
   */
  static async connect(config: MongoAccountStoreConfig): Promise<MongoAccountStore> {
    const options: MongoClientOptions = {
      serverSelectionTimeoutMS: config.serverSelectionTimeoutMs ?? 5_000,
    };

    const client = new MongoClient(config.uri, options);
    await client.connect();

    const store = new MongoAccountStore(client, client.db(config.databaseName ?? "handoff"));
    try {
      await store.ensureIndexes();
    } catch (error) {
      // A store with no indexes must not escape this function, and a client with
      // no store must not leak its sockets.
      await client.close();
      throw error;
    }
    return store;
  }

  /**
   * Idempotent, so every boot may call it.
   *
   * Index order is load-bearing. Mongo reports the first constraint a document
   * violates, checking `_id` first and then indexes in creation order, so email
   * before username here is what makes a row colliding on both report `email` —
   * matching `InMemoryAccountStore`, which the tests run against.
   *
   * The two `expiresAt` indexes are cleanup, **not** enforcement. Mongo's TTL
   * monitor wakes roughly once a minute, so a record can outlive its expiry by up
   * to that long; `findEmailCode` and `findSession` below re-check the time on
   * every read, which is what actually makes an expired code stop working.
   */
  async ensureIndexes(): Promise<void> {
    await this.#accounts.createIndexes([
      { key: { emailNormalized: 1 }, name: "email_unique", unique: true },
      { key: { usernameNormalized: 1 }, name: "username_unique", unique: true },
    ]);

    await this.#emailCodes.createIndexes([
      { key: { expiresAt: 1 }, name: "code_ttl", expireAfterSeconds: 0 },
    ]);

    await this.#sessions.createIndexes([
      { key: { expiresAt: 1 }, name: "session_ttl", expireAfterSeconds: 0 },
      // Not unique — one person may be signed in on a laptop and a phone. Present
      // so signing every device out is one indexed delete rather than a scan.
      { key: { hederaAccountId: 1 }, name: "session_by_account" },
    ]);
  }

  async createAccount(account: Account): Promise<void> {
    try {
      await this.#accounts.insertOne(toDoc(account));
    } catch (error) {
      const field = duplicateKeyField(error);
      if (field === "unknown") {
        throw new AccountStoreError(`registration conflicted with an existing record: ${String(error)}`);
      }
      if (field !== null) {
        throw new DuplicateAccountError(field);
      }
      throw error;
    }
  }

  async findByAccountId(hederaAccountId: string): Promise<Account | null> {
    const doc = await this.#accounts.findOne({ _id: hederaAccountId });
    return doc === null ? null : toAccount(doc);
  }

  async findByEmailNormalized(emailNormalized: string): Promise<Account | null> {
    const doc = await this.#accounts.findOne({ emailNormalized });
    return doc === null ? null : toAccount(doc);
  }

  async findByUsernameNormalized(usernameNormalized: string): Promise<Account | null> {
    const doc = await this.#accounts.findOne({ usernameNormalized });
    return doc === null ? null : toAccount(doc);
  }

  async updateProfile(hederaAccountId: string, patch: ProfilePatch): Promise<Account | null> {
    const set: Partial<AccountDoc> = { updatedAt: new Date() };
    if (patch.firstName !== undefined) set.firstName = patch.firstName;
    if (typeof patch.lastName === "string") set.lastName = patch.lastName;

    // `null` means remove the field. `$unset` rather than setting null, so the
    // stored shape stays "absent means no surname" and readers never branch on a
    // null they would otherwise have to expect.
    const unset = patch.lastName === null ? ({ lastName: "" } as const) : undefined;

    const doc = await this.#accounts.findOneAndUpdate(
      { _id: hederaAccountId },
      unset === undefined ? { $set: set } : { $set: set, $unset: unset },
      { returnDocument: "after" },
    );

    return doc === null ? null : toAccount(doc);
  }

  async markEmailVerified(hederaAccountId: string, verifiedAt: Date): Promise<void> {
    await this.#accounts.updateOne(
      { _id: hederaAccountId },
      { $set: { emailVerifiedAt: verifiedAt, updatedAt: new Date() } },
    );
  }

  async putEmailCode(record: EmailCodeRecord): Promise<void> {
    // One pending code per account: a replace, not an insert. Requesting a new
    // code has to invalidate the previous one, or the attempt cap can be reset by
    // asking again while the old code stays live.
    await this.#emailCodes.replaceOne(
      { _id: record.hederaAccountId },
      {
        emailNormalized: record.emailNormalized,
        codeFingerprint: record.codeFingerprint,
        attempts: record.attempts,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
      { upsert: true },
    );
  }

  async findEmailCode(hederaAccountId: string): Promise<EmailCodeRecord | null> {
    const doc = await this.#emailCodes.findOne({ _id: hederaAccountId });
    if (doc === null) return null;

    // The TTL index may not have swept it yet. See ensureIndexes.
    if (doc.expiresAt.getTime() <= Date.now()) {
      await this.#emailCodes.deleteOne({ _id: hederaAccountId });
      return null;
    }

    return {
      hederaAccountId: doc._id,
      emailNormalized: doc.emailNormalized,
      codeFingerprint: doc.codeFingerprint,
      attempts: doc.attempts,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    };
  }

  async recordEmailCodeAttempt(hederaAccountId: string): Promise<number> {
    // `$inc` server-side, and the new value read back in the same round trip.
    // Read-modify-write from two concurrent requests loses increments, and a lost
    // increment is a lost attempt cap.
    const doc = await this.#emailCodes.findOneAndUpdate(
      { _id: hederaAccountId },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );
    return doc === null ? 0 : doc.attempts;
  }

  async deleteEmailCode(hederaAccountId: string): Promise<void> {
    await this.#emailCodes.deleteOne({ _id: hederaAccountId });
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.#sessions.insertOne({
      _id: record.tokenFingerprint,
      hederaAccountId: record.hederaAccountId,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    });
  }

  async findSession(tokenFingerprint: string): Promise<SessionRecord | null> {
    const doc = await this.#sessions.findOne({ _id: tokenFingerprint });
    if (doc === null) return null;

    if (doc.expiresAt.getTime() <= Date.now()) {
      await this.#sessions.deleteOne({ _id: tokenFingerprint });
      return null;
    }

    return {
      tokenFingerprint: doc._id,
      hederaAccountId: doc.hederaAccountId,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    };
  }

  async deleteSession(tokenFingerprint: string): Promise<void> {
    await this.#sessions.deleteOne({ _id: tokenFingerprint });
  }

  async close(): Promise<void> {
    await this.#client.close();
  }
}

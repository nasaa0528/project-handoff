/**
 * In-memory `AccountStore`, for tests.
 *
 * Not a fake that agrees with the interface loosely — it enforces the same three
 * unique constraints and the same expiry rule as the Mongo implementation, because
 * a test double that is more permissive than production is a test suite that
 * passes while the product is broken.
 *
 * Never for the demo, never for a recording: this is one process's heap, so
 * everything registered vanishes on restart and a second process sees nothing.
 */

import type { Account } from "./account.js";
import {
  DuplicateAccountError,
  type AccountStore,
  type EmailCodeRecord,
  type ProfilePatch,
  type SessionRecord,
} from "./store.js";

/**
 * Copy on the way in and on the way out.
 *
 * `Account` holds `Date` objects, which are mutable: handing the caller the stored
 * object lets `account.createdAt.setFullYear(...)` rewrite the store from the
 * outside. `readonly` in the type does not stop that — it is compile-time only,
 * and it says nothing about the object a `Date` reference points at.
 */
function copyAccount(account: Account): Account {
  return {
    ...account,
    emailVerifiedAt: account.emailVerifiedAt === null ? null : new Date(account.emailVerifiedAt),
    createdAt: new Date(account.createdAt),
    updatedAt: new Date(account.updatedAt),
  };
}

export class InMemoryAccountStore implements AccountStore {
  readonly #accounts = new Map<string, Account>();
  readonly #emailCodes = new Map<string, EmailCodeRecord>();
  readonly #sessions = new Map<string, SessionRecord>();

  /** Injectable so expiry can be tested without waiting ten real minutes. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  async createAccount(account: Account): Promise<void> {
    // Checked in the same order the Mongo implementation reports collisions, so a
    // registration that violates two constraints at once gets the same message
    // from both stores. Otherwise a test asserting "username taken" passes here
    // and fails against Mongo for a row that collided on both.
    if (this.#accounts.has(account.hederaAccountId)) {
      throw new DuplicateAccountError("hederaAccountId");
    }
    for (const existing of this.#accounts.values()) {
      if (existing.emailNormalized === account.emailNormalized) {
        throw new DuplicateAccountError("email");
      }
      if (existing.usernameNormalized === account.usernameNormalized) {
        throw new DuplicateAccountError("username");
      }
    }

    this.#accounts.set(account.hederaAccountId, copyAccount(account));
  }

  async findByAccountId(hederaAccountId: string): Promise<Account | null> {
    const found = this.#accounts.get(hederaAccountId);
    return found === undefined ? null : copyAccount(found);
  }

  async findByEmailNormalized(emailNormalized: string): Promise<Account | null> {
    for (const account of this.#accounts.values()) {
      if (account.emailNormalized === emailNormalized) return copyAccount(account);
    }
    return null;
  }

  async findByUsernameNormalized(usernameNormalized: string): Promise<Account | null> {
    for (const account of this.#accounts.values()) {
      if (account.usernameNormalized === usernameNormalized) return copyAccount(account);
    }
    return null;
  }

  async updateProfile(hederaAccountId: string, patch: ProfilePatch): Promise<Account | null> {
    const existing = this.#accounts.get(hederaAccountId);
    if (existing === undefined) return null;

    // `exactOptionalPropertyTypes` is why these are conditional spreads rather
    // than `lastName: patch.lastName ?? existing.lastName`: assigning an explicit
    // `undefined` to an optional property is a different thing from omitting it,
    // and `??` cannot tell "clear this" (null) from "leave it" (absent).
    const lastName = patch.lastName === undefined ? existing.lastName : (patch.lastName ?? undefined);

    const updated: Account = {
      ...existing,
      ...(patch.firstName === undefined ? {} : { firstName: patch.firstName }),
      ...(lastName === undefined ? {} : { lastName }),
      updatedAt: this.now(),
    };

    // A cleared last name must actually leave, not linger as an inherited key.
    if (lastName === undefined) {
      delete (updated as { lastName?: string }).lastName;
    }

    this.#accounts.set(hederaAccountId, copyAccount(updated));
    return copyAccount(updated);
  }

  async markEmailVerified(hederaAccountId: string, verifiedAt: Date): Promise<void> {
    const existing = this.#accounts.get(hederaAccountId);
    if (existing === undefined) return;
    this.#accounts.set(
      hederaAccountId,
      copyAccount({ ...existing, emailVerifiedAt: verifiedAt, updatedAt: this.now() }),
    );
  }

  async putEmailCode(record: EmailCodeRecord): Promise<void> {
    this.#emailCodes.set(record.hederaAccountId, { ...record, expiresAt: new Date(record.expiresAt) });
  }

  /**
   * An expired code reads as no code at all.
   *
   * Both stores do this, and in Mongo it is the *enforcement* — the TTL index
   * there is only cleanup. Mongo's TTL monitor wakes about once a minute, so a
   * record can outlive its `expiresAt` by up to a minute; relying on the index
   * alone would leave a code accepted after it expired, on a window that depends
   * on background-thread timing.
   */
  async findEmailCode(hederaAccountId: string): Promise<EmailCodeRecord | null> {
    const found = this.#emailCodes.get(hederaAccountId);
    if (found === undefined) return null;
    if (found.expiresAt.getTime() <= this.now().getTime()) {
      this.#emailCodes.delete(hederaAccountId);
      return null;
    }
    return { ...found, expiresAt: new Date(found.expiresAt) };
  }

  async recordEmailCodeAttempt(hederaAccountId: string): Promise<number> {
    const found = this.#emailCodes.get(hederaAccountId);
    if (found === undefined) return 0;
    const attempts = found.attempts + 1;
    this.#emailCodes.set(hederaAccountId, { ...found, attempts });
    return attempts;
  }

  async deleteEmailCode(hederaAccountId: string): Promise<void> {
    this.#emailCodes.delete(hederaAccountId);
  }

  async createSession(record: SessionRecord): Promise<void> {
    this.#sessions.set(record.tokenFingerprint, { ...record, expiresAt: new Date(record.expiresAt) });
  }

  async findSession(tokenFingerprint: string): Promise<SessionRecord | null> {
    const found = this.#sessions.get(tokenFingerprint);
    if (found === undefined) return null;
    if (found.expiresAt.getTime() <= this.now().getTime()) {
      this.#sessions.delete(tokenFingerprint);
      return null;
    }
    return { ...found, expiresAt: new Date(found.expiresAt) };
  }

  async deleteSession(tokenFingerprint: string): Promise<void> {
    this.#sessions.delete(tokenFingerprint);
  }

  async close(): Promise<void> {
    // Nothing to close. Present so tests exercise the same teardown as production.
  }

  /** Test-only: how many accounts exist, without exposing the map. */
  get size(): number {
    return this.#accounts.size;
  }
}

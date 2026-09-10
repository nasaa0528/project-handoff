/**
 * The persistence seam.
 *
 * Same shape as `ContentStoreAdapter` in `@handoff/content`, and for the same
 * reason: the use cases in `service.ts` are written against this interface, so the
 * tests run on an in-memory implementation with no database, and Mongo is one
 * implementation rather than a dependency threaded through the whole package.
 *
 * Three collections' worth of operations live here, not one, because they are
 * written and read together and splitting them into three interfaces would only
 * mean three constructor arguments that are always the same object.
 */

import type { Account } from "./account.js";

/**
 * A pending email verification. One per account: requesting a new code replaces
 * the old one rather than adding to it, so "the last code I was sent" is always
 * the only code that works.
 */
export interface EmailCodeRecord {
  readonly hederaAccountId: string;
  /**
   * Which mailbox the code was sent to.
   *
   * Stored so the confirmation can check that the address has not changed since.
   * Without it, a code sent to an old address would still verify a new one, which
   * is the whole thing email verification is supposed to prevent.
   */
  readonly emailNormalized: string;
  readonly codeFingerprint: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** A live login. The token itself is never here — only its fingerprint. */
export interface SessionRecord {
  readonly tokenFingerprint: string;
  readonly hederaAccountId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * `null` clears a last name; an absent key leaves the field alone.
 *
 * The distinction is real and a plain optional cannot express it: `undefined`
 * means "not in this request" and `null` means "I have no surname, remove it".
 * Collapsing them would make a mononym unfixable once a surname had been saved.
 */
export interface ProfilePatch {
  readonly firstName?: string;
  readonly lastName?: string | null;
}

export class AccountStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountStoreError";
  }
}

/**
 * A unique index refused the write, and this says which one.
 *
 * The field matters to the caller: "that Hedera account is already registered"
 * sends someone to the login screen, while "that username is taken" sends them
 * back to the same form to pick another. A generic conflict makes the API guess,
 * and it would guess wrong half the time.
 */
export type UniqueField = "hederaAccountId" | "email" | "username";

export class DuplicateAccountError extends AccountStoreError {
  constructor(readonly field: UniqueField) {
    super(`an account with that ${field} already exists`);
    this.name = "DuplicateAccountError";
  }
}

export interface AccountStore {
  /**
   * Insert only — never an upsert.
   *
   * An upsert here would let a second registration overwrite an existing
   * account's password, which is a takeover rather than a duplicate. Throws
   * `DuplicateAccountError` naming the field that collided.
   */
  createAccount(account: Account): Promise<void>;

  findByAccountId(hederaAccountId: string): Promise<Account | null>;
  findByEmailNormalized(emailNormalized: string): Promise<Account | null>;
  findByUsernameNormalized(usernameNormalized: string): Promise<Account | null>;

  /** Returns the account as it now stands, or `null` if there is no such account. */
  updateProfile(hederaAccountId: string, patch: ProfilePatch): Promise<Account | null>;

  /** Idempotent: verifying an already-verified address is not an error. */
  markEmailVerified(hederaAccountId: string, verifiedAt: Date): Promise<void>;

  /** Replaces any pending code for that account. */
  putEmailCode(record: EmailCodeRecord): Promise<void>;
  findEmailCode(hederaAccountId: string): Promise<EmailCodeRecord | null>;
  /**
   * Atomically increments and returns the new count.
   *
   * Atomic because the attempt counter is the only thing standing between six
   * digits and a brute-force loop. A read-then-write from two concurrent requests
   * loses increments, and losing increments is losing the cap.
   */
  recordEmailCodeAttempt(hederaAccountId: string): Promise<number>;
  deleteEmailCode(hederaAccountId: string): Promise<void>;

  createSession(record: SessionRecord): Promise<void>;
  findSession(tokenFingerprint: string): Promise<SessionRecord | null>;
  deleteSession(tokenFingerprint: string): Promise<void>;

  close(): Promise<void>;
}

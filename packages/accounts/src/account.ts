/**
 * What an account is, and the normalisation that makes uniqueness mean something.
 *
 * **The Hedera account id is the identity.** Not a generated uuid, not the email.
 * That is P1's instruction and it is also what the rest of the design already
 * assumed — `docs/decisions/2026-09-08-custody-onboarding-and-wallets-stay-out.md`
 * says "identity in this design *is* the Hedera account". So the account id is the
 * primary key, and email, username and the names are profile fields hanging off it.
 *
 * Two consequences worth saying out loud, because they are the reason this package
 * is not a custody system:
 *
 * - **This package never creates a Hedera account and never holds a key.** The
 *   account arrives already existing, made by its owner at the portal or in a
 *   wallet. A platform that made accounts for people would be the "custodial web2
 *   wrap" that `CLAUDE.md` puts in Tier 3, and on the expert side it would break
 *   the product's central claim — an attestation signed by a platform-held key
 *   proves the platform pressed a button, not that a human reviewed anything.
 * - **A row here is a claim, not a proof.** Registering `0.0.5005` does not
 *   demonstrate control of `0.0.5005`; see `proof-of-control` in this package's
 *   CLAUDE.md for the seam where that belongs. Nothing that spends money may treat
 *   this collection as authority — the cert gate is the HCS registry topic
 *   (NAS-27), which is on-chain and auditable, and this is a profile store.
 */

import * as z from "zod";

/**
 * `shard.realm.num`, plain form only.
 *
 * The SDK also accepts a checksum form (`0.0.1234-vfmkw`) and an EVM-address form.
 * Both are rejected here rather than normalised, because two spellings of one
 * account would defeat the unique index that makes this the identity — the whole
 * point of the field. Callers hand us the plain form or get a clear error.
 *
 * Shard and realm are pinned to 0: every Hedera account on testnet today is
 * `0.0.n`, and a non-zero shard arriving in this build is a typo, not a frontier.
 * Account 0 is not a real account, so the number must be positive and must not
 * carry a leading zero (`0.0.007` and `0.0.7` would otherwise be two identities).
 */
export const HederaAccountId = z
  .string()
  .trim()
  .regex(
    /^0\.0\.[1-9]\d*$/,
    "expected a Hedera account id like 0.0.10119624 — shard and realm 0, positive account number, no checksum suffix",
  );

/**
 * Emails are compared lowercased, and that is the *only* thing done to them.
 *
 * Deliberately not the "gmail trick" of stripping dots and `+tags`: that is a
 * Gmail policy, not an email one, and applying it to every provider silently
 * merges two different mailboxes into one identity. Case folding is safe because
 * the domain is case-insensitive by RFC and no provider in practice treats the
 * local part as case-sensitive.
 */
export const EMAIL_MAX_LENGTH = 254;

export const Email = z
  .email("that does not look like an email address")
  .max(EMAIL_MAX_LENGTH, `email must be at most ${EMAIL_MAX_LENGTH} characters`);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Usernames: lowercase letters, digits and underscore, 3–32 characters.
 *
 * Narrow on purpose. Dots, hyphens and mixed scripts invite look-alike names
 * (`rn` for `m`, Cyrillic `а` for Latin `a`), and an impersonated expert username
 * beside a real attestation is a credibility problem, not a cosmetic one. A
 * display name that wants punctuation and Cyrillic is `firstName`/`lastName`,
 * which are never used to identify anyone.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

export const Username = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `username must be at least ${USERNAME_MIN_LENGTH} characters`)
  .max(USERNAME_MAX_LENGTH, `username must be at most ${USERNAME_MAX_LENGTH} characters`)
  .refine((value) => /^[A-Za-z0-9_]+$/.test(value), {
    message: "username may use only letters, digits and underscore",
  })
  .refine((value) => /^[A-Za-z]/.test(value), {
    message: "username must start with a letter",
  });

/**
 * Names people cannot take, because a route or a support address already answers
 * to them. `handoff` is in here so nobody can register the product's own name and
 * post attestations that read as official.
 */
const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "security",
  "api",
  "handoff",
  "verifier",
  "escrow",
  "platform",
  "moderator",
  "official",
  "me",
  "null",
  "undefined",
]);

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username));
}

/**
 * Human names, not identifiers. Any script, because our own team's names do not
 * fit ASCII. Bounded so a name cannot be a payload, and required to hold at least
 * one non-space character so `"   "` is not a first name.
 */
export const PERSON_NAME_MAX_LENGTH = 80;

const PersonName = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(PERSON_NAME_MAX_LENGTH, `must be at most ${PERSON_NAME_MAX_LENGTH} characters`);

export const FirstName = PersonName;
/** Optional because mononyms are real and a required surname excludes people. */
export const LastName = PersonName.optional();

/**
 * What a client sends to register.
 *
 * `.strict()` matters: an unknown key is refused rather than dropped. A client
 * that posts `{ emailVerified: true }` or `{ role: "admin" }` hoping it lands in
 * the document gets a 400, and the field it was reaching for is one this schema
 * does not carry at all.
 */
export const RegistrationRequest = z
  .object({
    hederaAccountId: HederaAccountId,
    email: Email,
    username: Username,
    firstName: FirstName,
    lastName: LastName,
    password: z.string(),
  })
  .strict();

export type RegistrationRequest = z.infer<typeof RegistrationRequest>;

/**
 * Everything a client may change later. The account id is not here — it is the key,
 * and an identity that can be edited is not an identity.
 *
 * Email is absent too, deliberately: changing it has to re-run verification, which
 * is a flow of its own rather than a field in a patch.
 */
export const ProfileUpdate = z
  .object({
    firstName: FirstName.optional(),
    /** `null` clears it. See `ProfilePatch` in store.ts for why null and absent differ. */
    lastName: PersonName.nullable().optional(),
  })
  .strict()
  .refine((value) => value.firstName !== undefined || value.lastName !== undefined, {
    message: "nothing to update",
  });

export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/**
 * The stored account.
 *
 * `passwordHash` is in here because the store round-trips it; it is stripped by
 * `publicProfile` before anything leaves the process. The normalised columns are
 * stored rather than computed on read, because that is what the unique indexes are
 * built on and an index cannot be built on a function.
 */
export interface Account {
  /** The Hedera account id. The primary key, stored as Mongo's `_id`. */
  readonly hederaAccountId: string;
  readonly email: string;
  readonly emailNormalized: string;
  readonly username: string;
  readonly usernameNormalized: string;
  readonly firstName: string;
  readonly lastName?: string | undefined;
  readonly passwordHash: string;
  /** Null until a one-time code from that mailbox has been confirmed. */
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The account as an API may show it: no hash, no normalised duplicates. */
export interface PublicProfile {
  readonly hederaAccountId: string;
  readonly email: string;
  readonly username: string;
  readonly firstName: string;
  readonly lastName?: string | undefined;
  readonly emailVerified: boolean;
  readonly createdAt: string;
}

/**
 * The one place an account becomes something a client may see.
 *
 * A single function rather than a spread at each call site, because "remembered to
 * delete passwordHash" is not a property four route handlers can be trusted to
 * keep. Anything added to `Account` later is invisible to the API until it is
 * named here, which is the safe direction for that mistake to fail in.
 */
export function publicProfile(account: Account): PublicProfile {
  return {
    hederaAccountId: account.hederaAccountId,
    email: account.email,
    username: account.username,
    firstName: account.firstName,
    ...(account.lastName === undefined ? {} : { lastName: account.lastName }),
    emailVerified: account.emailVerifiedAt !== null,
    createdAt: account.createdAt.toISOString(),
  };
}

/**
 * Which field a login `identifier` is, decided by shape rather than by trying all
 * three against the database. One lookup, one index, no chance of two accounts
 * matching one identifier through different columns.
 */
export type IdentifierKind = "hederaAccountId" | "email" | "username";

export function classifyIdentifier(identifier: string): IdentifierKind {
  const trimmed = identifier.trim();
  if (/^\d+\.\d+\.\d+/.test(trimmed)) return "hederaAccountId";
  if (trimmed.includes("@")) return "email";
  return "username";
}

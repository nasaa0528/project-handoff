/**
 * One-time email codes and session tokens: generate, store a fingerprint, compare
 * in constant time.
 *
 * Both are the same shape of thing — a bearer secret the client holds and the
 * server only ever recognises — so they share one implementation. **Neither is
 * ever stored in plaintext.** A database dump should not be a pile of live login
 * tokens and working email codes.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * A six-digit code, because it gets typed off a phone screen.
 *
 * `randomInt` rather than `Math.random()`: it is CSPRNG-backed and rejection-samples
 * to a uniform distribution, so there is no modulo bias favouring low codes.
 * `padStart` keeps the width honest — `000123` is a valid code and shortening it to
 * `123` would leak that the number was small.
 */
export const EMAIL_CODE_DIGITS = 6;

export function generateEmailCode(): string {
  return String(randomInt(0, 10 ** EMAIL_CODE_DIGITS)).padStart(EMAIL_CODE_DIGITS, "0");
}

/** Ten minutes: long enough for mail to land and be typed, short enough to matter. */
export const EMAIL_CODE_TTL_SECONDS = 600;

/**
 * Five tries, then the code is dead and a new one must be requested.
 *
 * Six digits is a million possibilities, which is only strong while guessing is
 * bounded. Unlimited attempts against a ten-minute window is a few thousand
 * requests, and this is the counter that closes that.
 */
export const EMAIL_CODE_MAX_ATTEMPTS = 5;

/** 256 bits from the CSPRNG. Not guessable, so nothing slows verification down. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The server-side pepper, held in configuration and never in the database.
 *
 * This is what makes a stolen dump useless. A six-digit code has only a million
 * possible values, so a plain SHA-256 of one is reversible by a laptop in about a
 * second — anyone holding the collection could read every pending code. Keyed
 * HMAC moves the secret out of the data: the fingerprints are worthless without a
 * value that lives in the environment, next to the other things that are not in
 * the repo (hard rule 2).
 *
 * Branded so a bare string cannot be passed in by accident. There is one place
 * that turns configuration into a pepper, and it validates.
 */
declare const pepperBrand: unique symbol;
export type CodePepper = string & { readonly [pepperBrand]: true };

/** 32 bytes of hex. Enough that the pepper is not the weak part. */
export const PEPPER_MIN_HEX_LENGTH = 64;

export class InvalidPepperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPepperError";
  }
}

export function codePepper(value: string): CodePepper {
  const trimmed = value.trim();

  if (trimmed.length < PEPPER_MIN_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new InvalidPepperError(
      `the code pepper must be at least ${PEPPER_MIN_HEX_LENGTH} hex characters. ` +
        `Generate one with:  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  return trimmed.toLowerCase() as CodePepper;
}

/**
 * HMAC of the secret under the pepper, bound to what it is for.
 *
 * The `scope` is not decoration. It is the account id and the purpose, so a
 * fingerprint computed for one account's email code cannot match a row belonging
 * to another account or to a session. Without it, one leaked code's fingerprint
 * would be a valid credential anywhere the same code appears.
 *
 * The scope is length-prefixed rather than merely concatenated, so no pair of
 * (scope, secret) values can produce the same input bytes as a different pair.
 * Joining them with a plain separator makes `("a:b", "c")` and `("a", "b:c")`
 * hash identically, which is the kind of collision that turns into a cross-account
 * credential rather than a bug report.
 */
export function fingerprint(pepper: CodePepper, scope: string, secret: string): string {
  return createHmac("sha256", Buffer.from(pepper, "hex"))
    .update(`${String(scope.length)}:${scope}:${secret}`)
    .digest("hex");
}

/**
 * Constant-time comparison of two fingerprints.
 *
 * A plain `===` on hex strings returns as soon as it finds a differing character,
 * which is a measurable oracle: an attacker learns the fingerprint one nibble at a
 * time. Lengths are equal for well-formed input, so the early return leaks nothing.
 */
export function fingerprintsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

export function emailCodeScope(hederaAccountId: string): string {
  return `email-verify:${hederaAccountId}`;
}

export const SESSION_SCOPE = "session";

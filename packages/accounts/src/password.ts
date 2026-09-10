/**
 * Password hashing, with `node:crypto`'s scrypt and nothing else.
 *
 * No argon2 and no bcrypt on purpose. Both are native modules, and a native build
 * that works on one of four laptops is a lost afternoon during a hackathon week;
 * scrypt is memory-hard, in the standard library, and shipped with the Node
 * version this repo already pins. If this outlives the week, argon2id is the
 * upgrade, and the stored format below is what makes it a migration rather than a
 * rewrite.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/**
 * `promisify` resolves to scrypt's *three*-argument overload, which drops the
 * options parameter — and the options are where the cost parameters live, so the
 * inferred type silently forbids the only call this module makes. Stated
 * explicitly, which also removes the `as Buffer` at each call site.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Cost parameters. Memory is `128 * N * r` bytes — 16 MiB here.
 *
 * `maxmem` is set explicitly and is not decoration: Node's default cap is exactly
 * 32 MiB, so raising N to 32768 later without touching this throws
 * `ERR_CRYPTO_INVALID_SCRYPT_PARAM` at the boundary rather than in a test. The
 * headroom means the next person to raise the cost only has to change one number.
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/**
 * NIST SP 800-63B's shape: length is the control that matters, composition rules
 * ("one capital, one symbol") are not, and long passphrases must be allowed.
 *
 * The **maximum** is the one that is about this code rather than about the user. A
 * KDF runs over whatever it is given, so an unbounded password field is a request
 * to spend 16 MiB and a CPU core on a 10 MB string, repeatedly, for free.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/**
 * Rejects the passwords that actually get used, not the ones that fail a regex.
 *
 * The `contains` checks are the useful half: "khishgee2026" for user `khishgee` is
 * long enough to pass any length rule and is the first thing anyone guesses. Both
 * sides are lowercased so the comparison is not defeated by capitalisation.
 */
export function assertPasswordAcceptable(
  password: string,
  context: { readonly username?: string; readonly email?: string } = {},
): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new WeakPasswordError(`password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }

  const lowered = password.toLowerCase();

  const username = context.username?.trim().toLowerCase();
  if (username !== undefined && username !== "" && lowered.includes(username)) {
    throw new WeakPasswordError("password must not contain your username");
  }

  // The local part only. Requiring a password not to contain "gmail.com" would
  // reject a fine passphrase for a reason the user cannot see.
  const localPart = context.email?.trim().toLowerCase().split("@")[0];
  if (localPart !== undefined && localPart.length >= 3 && lowered.includes(localPart)) {
    throw new WeakPasswordError("password must not contain your email address");
  }
}

/**
 * `scrypt$N$r$p$salt$hash`, base64 for the two binary fields.
 *
 * The parameters travel **with** the hash rather than living only in the constants
 * above, so raising the cost does not invalidate every password already stored.
 * Verification reads the parameters out of the record it is checking; new hashes
 * use today's constants. Without this, a cost increase is a forced password reset
 * for everyone.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });

  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Constant-time on the comparison, and false on anything malformed.
 *
 * A stored record that does not parse returns `false` rather than throwing. The
 * caller is a login handler: a corrupt row should fail that one login, not return
 * a 500 that tells an attacker they found something interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltB64 = parts[4];
  const hashB64 = parts[5];

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N <= 1 || r <= 0 || p <= 0) return false;
  if (saltB64 === undefined || hashB64 === undefined) return false;

  // A record could name parameters larger than this process will spend. Refusing
  // beats letting a stored value dictate this process's memory use.
  if (128 * N * r > SCRYPT_MAXMEM) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (salt.byteLength === 0 || expected.byteLength === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.byteLength, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }

  // timingSafeEqual throws on a length mismatch, so the lengths are compared
  // first. That leaks only the length of a hash, which is a constant here.
  if (derived.byteLength !== expected.byteLength) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Burn the same work as a real verification, for a login whose account does not
 * exist.
 *
 * Without this, "no such user" returns in microseconds and "wrong password" takes
 * ~50ms, which turns the login endpoint into an account-existence oracle — and
 * account existence here means "does this Hedera account belong to a registered
 * expert", which is exactly what someone probing the platform wants to know.
 */
export async function burnPasswordTime(password: string): Promise<void> {
  await scrypt(password, randomBytes(SCRYPT_SALT_BYTES), SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

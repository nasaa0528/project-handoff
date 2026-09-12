/**
 * The expert's Hedera private key, encrypted with the expert's password.
 *
 * This package's CLAUDE.md says "never hold a private key" and that rule was right
 * when it was written. It is overridden, narrowly and deliberately, by
 * `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md` — P4's
 * scope exception, granted so a judge can register and sign without creating,
 * funding and exporting a Hedera account first. **Read that decision before
 * changing anything here**, including its Consequences section, which owes one
 * sentence on camera: this is custody, and production is client-side signing.
 *
 * What this module is responsible for is making the custody as narrow as it can
 * be. The platform stores a blob it cannot read on its own: decrypting needs the
 * user's password, which is never stored, only scrypt-hashed. A database dump is
 * therefore not a pile of signing keys — it is a pile of scrypt work, per account,
 * and it is worthless without the server-side pepper as well.
 *
 * No Hedera SDK here, which keeps the layout rule intact: the key arrives as the
 * DER string `packages/chain` produced and leaves as the same string.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";
import type { CodePepper } from "./secrets.js";

/** Same reason as password.ts: promisify picks the overload without options. */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * The same cost as a password hash, and deliberately its own constants.
 *
 * Tying these to password.ts's would mean that raising the login cost silently
 * re-keys every stored blob — which, because the parameters travel with the
 * ciphertext, would not break decryption but would make the relationship between
 * two independent decisions invisible. They are separate knobs that happen to
 * start at the same setting.
 */
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** AES-256-GCM: 32-byte key, 12-byte nonce, 16-byte tag. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const FORMAT = "hvk1";

export class KeyVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyVaultError";
  }
}

async function deriveKey(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return scrypt(password, salt, KEY_BYTES, { ...params, maxmem: SCRYPT_MAXMEM });
}

/**
 * The pepper and the account id are additional authenticated data, not key
 * material, which is what lets both be checked without being stored.
 *
 * The account id binds a ciphertext to the row it belongs to: a blob moved from
 * one account's document to another's fails its tag rather than decrypting into
 * the wrong person's key. The pepper means a stolen database alone cannot be
 * attacked offline at all — the attacker also needs a value that only ever lives
 * in the environment (hard rule 2), the same argument secrets.ts already makes for
 * codes and session tokens.
 *
 * Each field is length-prefixed rather than merely joined, so no pair of values
 * can produce the same bytes as a different pair — secrets.ts's `scope` reasoning,
 * applied to the same problem.
 *
 * **Rotating the pepper makes every stored key undecryptable.** That is a worse
 * failure than it is for codes and sessions, which merely expire — say so before
 * anyone rotates it, and re-encrypt every blob in the same operation if it must
 * happen.
 */
function associatedData(hederaAccountId: string, pepper: CodePepper): Buffer {
  const parts = [FORMAT, hederaAccountId, pepper];
  return Buffer.from(parts.map((part) => `${part.length}:${part}`).join(""), "utf8");
}

/**
 * GCM, never CBC.
 *
 * CBC is unauthenticated: a blob an attacker has flipped bits in decrypts to
 * garbage rather than to an error, and garbage here is a key that signs nothing
 * while looking like it should. GCM's tag turns that into a thrown error. The
 * reference implementation this was modelled on used `aes-256-cbc` with a
 * caller-supplied IV; both halves of that are the thing to avoid.
 *
 * Stored as `hvk1$N$r$p$salt$iv$tag$ciphertext`, base64 for the binary fields.
 * The cost parameters travel with the ciphertext for the same reason they travel
 * with a password hash: raising the cost later must not orphan what is already
 * stored.
 */
export async function encryptPrivateKey(
  privateKey: string,
  password: string,
  hederaAccountId: string,
  pepper: CodePepper,
): Promise<string> {
  if (privateKey === "") throw new KeyVaultError("refusing to encrypt an empty private key");

  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });

  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(hederaAccountId, pepper));
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);

  return [
    FORMAT,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

/**
 * Throws on a wrong password, a tampered blob, or a blob belonging to another
 * account. All three are one exception on purpose — the caller is answering a
 * client, and distinguishing "wrong password" from "that is not your key" tells
 * an attacker which half they got right.
 */
export async function decryptPrivateKey(
  stored: string,
  password: string,
  hederaAccountId: string,
  pepper: CodePepper,
): Promise<string> {
  const parts = stored.split("$");
  if (parts.length !== 8 || parts[0] !== FORMAT) {
    throw new KeyVaultError("stored key is not in a format this version understands");
  }

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    throw new KeyVaultError("stored key has unreadable cost parameters");
  }
  if (N <= 1 || r <= 0 || p <= 0) throw new KeyVaultError("stored key has invalid cost parameters");
  // A stored record must not dictate this process's memory use. Same guard as
  // verifyPassword, and the same reason.
  if (128 * N * r > SCRYPT_MAXMEM) {
    throw new KeyVaultError("stored key names a cost this process will not spend");
  }

  const [saltB64, ivB64, tagB64, ciphertextB64] = parts.slice(4);
  if (
    saltB64 === undefined ||
    ivB64 === undefined ||
    tagB64 === undefined ||
    ciphertextB64 === undefined
  ) {
    throw new KeyVaultError("stored key is missing a field");
  }

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.byteLength !== IV_BYTES) throw new KeyVaultError("stored key has a nonce of the wrong length");
  if (tag.byteLength !== TAG_BYTES) throw new KeyVaultError("stored key has a tag of the wrong length");

  const key = await deriveKey(password, Buffer.from(saltB64, "base64"), { N, r, p });

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(associatedData(hederaAccountId, pepper));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new KeyVaultError("could not decrypt that key with that password");
  }
}

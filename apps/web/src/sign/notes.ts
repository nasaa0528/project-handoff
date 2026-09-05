/**
 * The expert's written notes: hashed here, stored off-chain, never published.
 *
 * `@handoff/schema` hashes with `node:crypto`, which a browser does not have.
 * This is the same digest over Web Crypto, and `notes.test.ts` proves the two
 * agree byte for byte on the same input. Nothing else is reimplemented: notes
 * are raw bytes, so there is nothing to canonicalize, and the attestation body
 * itself is canonicalized and bounded by the schema package before it is sent.
 */

const encoder = new TextEncoder();

export function notesToBytes(notes: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(notes);
}

/** Lowercase hex, matching `Sha256Hex` in the schema package. */
export async function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface HashedNotes {
  /** What goes to the content store. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** What goes on-chain, as `notes_hash`. */
  readonly hash: string;
}

export async function hashNotes(notes: string): Promise<HashedNotes> {
  const bytes = notesToBytes(notes);
  return { bytes, hash: await sha256HexOfBytes(bytes) };
}

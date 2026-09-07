/**
 * The expert's written notes: hashed here, stored off-chain, never published.
 *
 * `@handoff/schema` hashes with `node:crypto`, which a browser does not have.
 * This is the same digest over Web Crypto, and `notes.test.ts` proves the two
 * agree byte for byte on the same input. Nothing else is reimplemented: notes
 * are raw bytes, so there is nothing to canonicalize, and the attestation body
 * itself is canonicalized and bounded by the schema package before it is sent.
 *
 * Web Crypto exists only in a secure context: localhost, or https. Served any
 * other way the browser simply has no `crypto.subtle`, and the failure has to
 * say so rather than surface as a property read on undefined.
 */

const encoder = new TextEncoder();

export function notesToBytes(notes: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(notes);
}

function subtleCrypto(): SubtleCrypto {
  const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      "Web Crypto is not available, so nothing can be hashed. The app must be served from " +
        "localhost or over https; a plain http address on the network is not a secure context.",
    );
  }
  return subtle;
}

/** Lowercase hex, matching `Sha256Hex` in the schema package. */
export async function sha256HexOfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await subtleCrypto().digest("SHA-256", bytes);
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

/**
 * Browser stand-in for `node:crypto`, wired in `vite.config.ts`.
 *
 * `@handoff/schema` imports `createHash` for `sha256Hex` and `hashCanonical`.
 * Neither is called on the sign path: the attestation body is canonicalized
 * and bounded by the schema package without hashing, and the notes are hashed
 * over Web Crypto in `src/sign/notes.ts`. If something does reach this, it is
 * a bug, and it fails here with a message rather than silently in a bundle.
 */

export function createHash(): never {
  throw new Error(
    "node:crypto is not available in the browser. Hash bytes through src/sign/notes.ts, " +
      "which uses Web Crypto and is tested to agree with @handoff/schema.",
  );
}

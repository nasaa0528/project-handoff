/**
 * Just enough of `node:crypto` for `@handoff/schema` to typecheck from a
 * browser build that has no Node types on purpose.
 *
 * The schema package hashes with `createHash("sha256").update(bytes).digest("hex")`
 * and nothing else. This declares exactly that surface, so the source compiles
 * here without `@types/node` and without letting any other Node API in. At run
 * time in the browser the import resolves to `../shims/node-crypto.ts`, which
 * throws. This file lives apart from that one because TypeScript drops a
 * `.d.ts` that shares a basename with a `.ts` beside it.
 */

declare module "node:crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}

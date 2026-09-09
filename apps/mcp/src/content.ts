/**
 * The content-store port this app needs, and a memory-backed stand-in.
 *
 * `packages/content` owns the real store and its Supabase implementation. That
 * package is P1's and does not exist yet, so this file states the shape we
 * consume rather than blocking on it: a store takes bytes we have already
 * hashed and hands back an opaque reference.
 *
 * One rule from `packages/content/CLAUDE.md` is visible in the signature: the
 * store holds the bytes while only the hash goes on-chain, so nothing here is
 * ever put in an envelope.
 *
 * The hash is an argument rather than a return value because this app hashes
 * first — the envelope is built from the hash and the store is told what to
 * file the bytes under. `@handoff/content` hashes too, with the same
 * `sha256Hex` from `@handoff/schema`, so `contentStore` below asserts the two
 * agree rather than trusting that they do. `InMemoryContentStore` is now a
 * test fixture, per the cutover rule.
 */

import { ContentStoreError, readVerifiedByHash, type ContentStoreAdapter } from "@handoff/content";

export interface ContentStore {
  /**
   * Store bytes under a hash the caller computed.
   *
   * @param hash - lowercase sha-256 hex of `bytes`, from `@handoff/schema`
   * @param bytes - the content itself, which never reaches a topic
   * @returns an opaque reference for fetching it back
   */
  put(hash: string, bytes: Uint8Array): Promise<string>;

  /**
   * The bytes behind a hash, or null when the store has nothing for it.
   *
   * Read back rather than written: the expert app is a browser build and
   * cannot hold the store's credentials, so this process answers for it. Same
   * signature as the port in `apps/web/src/content.ts`, so the two agree about
   * what "missing" means — null, never an empty buffer, never a throw.
   */
  get(hash: string): Promise<Uint8Array | null>;
}

export class InMemoryContentStore implements ContentStore {
  readonly #objects = new Map<string, Uint8Array>();

  async put(hash: string, bytes: Uint8Array): Promise<string> {
    // Content-addressed, so storing the same bytes twice is not an error and
    // not a second object. The real store gets the same property for free.
    this.#objects.set(hash, bytes);
    return `memory://${hash}`;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    return this.#objects.get(hash) ?? null;
  }

  /** Test-only. */
  get size(): number {
    return this.#objects.size;
  }
}

/**
 * The real store, as this app's port.
 *
 * `@handoff/content` owns the bytes and hashes them itself, returning the hash
 * it computed. This app hashed first, because the envelope needs the hash
 * before anything is stored. Both go through `sha256Hex` in `@handoff/schema`,
 * which is the whole reason hashing lives there — so the two must agree.
 *
 * They are checked anyway. Hard rule 1 is that the on-chain hash is the
 * commitment to the stored bytes; if the store filed them under a different
 * hash, the envelope points at nothing and the mismatch has to surface here,
 * before the order posts, rather than as an unfetchable artifact later.
 */
export function contentStore(adapter: ContentStoreAdapter): ContentStore {
  return {
    async put(hash: string, bytes: Uint8Array): Promise<string> {
      const stored = await adapter.put(Buffer.from(bytes));
      if (stored.contentHash !== hash) {
        throw new Error(
          `content store filed bytes under ${stored.contentHash}, but the envelope ` +
            `commits to ${hash}. Refusing to post an order whose hash points at ` +
            `nothing. Both sides must hash through sha256Hex in @handoff/schema.`,
        );
      }
      return stored.storageKey;
    },

    async get(hash: string): Promise<Uint8Array | null> {
      try {
        // Verified, not fetched. `readVerifiedByHash` recomputes the hash with
        // the same hasher the envelope used and refuses bytes that do not
        // match, which is hard rule 1 read from the other end: the on-chain
        // hash is the commitment, so content that fails it is not this
        // order's content and must not reach a screen.
        return await readVerifiedByHash(adapter, hash);
      } catch (error) {
        // A missing object and corrupted bytes are different answers. Only the
        // first is null; a mismatch carries its own error type and is left to
        // the caller, which reports it rather than pretending the object was
        // never stored.
        if (error instanceof ContentStoreError && error.name === "ContentStoreError") {
          return null;
        }
        throw error;
      }
    },
  };
}

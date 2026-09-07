/**
 * The content-store port the expert app consumes.
 *
 * Same shape as the one `apps/mcp` states, on purpose: `@handoff/content`
 * satisfies both at the cutover, and until then a memory-backed stand-in does.
 * The store never hashes; the caller hashes through the schema package and
 * hands the hash in, so that what is stored is exactly what was committed to.
 *
 * The expert's written notes go through here. Only their hash goes to a topic.
 */

export interface ContentStore {
  /**
   * Store bytes under a hash the caller computed.
   *
   * @param hash - lowercase sha-256 hex of `bytes`
   * @param bytes - the content itself, which never reaches a topic
   * @returns an opaque reference for fetching it back
   */
  put(hash: string, bytes: Uint8Array): Promise<string>;
}

export class InMemoryContentStore implements ContentStore {
  readonly #objects = new Map<string, Uint8Array>();

  async put(hash: string, bytes: Uint8Array): Promise<string> {
    this.#objects.set(hash, bytes);
    return `memory://${hash}`;
  }

  /** Test-only. */
  get(hash: string): Uint8Array | undefined {
    return this.#objects.get(hash);
  }

  /** Test-only. */
  get size(): number {
    return this.#objects.size;
  }
}

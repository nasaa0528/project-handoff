import { describe, expect, it } from "vitest";
import type { ContentStoreAdapter } from "@handoff/content";
import { contentStore, InMemoryContentStore } from "./content.js";

/** A store that files bytes under whatever hash it is told to claim. */
function fakeAdapter(claimedHash: string, storageKey = "bucket/key"): ContentStoreAdapter {
  return {
    async put() {
      return { contentHash: claimedHash, storageKey };
    },
    async get() {
      throw new Error("not used here");
    },
    async getSignedUrl() {
      throw new Error("not used here");
    },
  };
}

const HASH = "a".repeat(64);
const BYTES = new TextEncoder().encode("FAKE artifact");

describe("contentStore", () => {
  it("hands back the storage key when the two hashes agree", async () => {
    const store = contentStore(fakeAdapter(HASH, "handoff-content/aaa"));

    await expect(store.put(HASH, BYTES)).resolves.toBe("handoff-content/aaa");
  });

  it("refuses when the store filed the bytes under a different hash", async () => {
    // Hard rule 1: the on-chain hash is the commitment to these bytes. If the
    // store disagrees, the envelope would point at nothing, and that has to
    // surface before the order posts rather than as an unfetchable artifact a
    // day later.
    const store = contentStore(fakeAdapter("b".repeat(64)));

    await expect(store.put(HASH, BYTES)).rejects.toThrow(/commits to a{64}/);
  });

  it("names both hashes, so the mismatch is debuggable", async () => {
    const store = contentStore(fakeAdapter("b".repeat(64)));

    await expect(store.put(HASH, BYTES)).rejects.toThrow(/b{64}/);
  });
});

describe("InMemoryContentStore", () => {
  it("is content-addressed, so storing the same bytes twice is one object", async () => {
    const store = new InMemoryContentStore();

    await store.put(HASH, BYTES);
    await store.put(HASH, BYTES);

    expect(store.size).toBe(1);
    expect(await store.get(HASH)).toEqual(BYTES);
  });
});

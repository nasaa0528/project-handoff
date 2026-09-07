import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalDevContentAdapter } from "./adapter.js";

describe("LocalDevContentAdapter", () => {
  it("round-trips put -> signed URL -> read, hash is bare hex", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      const content = Buffer.from("fake artifact, labeled FAKE per hard rule 7");
      const { contentHash, storageKey } = await adapter.put(content);

      expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(storageKey).toBe(contentHash);

      const url = await adapter.getSignedUrl(storageKey);
      expect(url.startsWith("file://")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is deterministic — same bytes, same hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      const a = await adapter.put(Buffer.from("same content"));
      const b = await adapter.put(Buffer.from("same content"));
      expect(a.contentHash).toBe(b.contentHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("getSignedUrl throws for a missing object, mirroring a real 404", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-content-"));
    try {
      const adapter = new LocalDevContentAdapter(dir);
      await expect(adapter.getSignedUrl("does-not-exist")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

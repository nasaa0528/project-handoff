import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Hex } from "@handoff/schema";

/**
 * Content-store adapter interface (hard rule 1: content never goes on-chain, only
 * its hash). Only the local filesystem implementation lives here — the real
 * Supabase-backed adapter needs an actual project + vault-only service key first.
 */
export interface ContentStoreAdapter {
  /** Stores content, returns its hash (the value that goes on-chain) and a storage key. */
  put(content: Buffer): Promise<{ contentHash: string; storageKey: string }>;
  /**
   * A signed, time-limited URL for reading the content back. TTL must exceed
   * claim-timeout + review time — enforce that at the call site, not here, since
   * this interface doesn't know the order's claim-timeout.
   */
  getSignedUrl(storageKey: string, ttlSeconds: number): Promise<string>;
}

/** Local filesystem adapter — dev + the deterministic demo fallback, never the recorded run. */
export class LocalDevContentAdapter implements ContentStoreAdapter {
  constructor(private readonly rootDir: string) {}

  async put(content: Buffer): Promise<{ contentHash: string; storageKey: string }> {
    // Bare hex, matching @handoff/schema's sha256Hex exactly — no "sha256:" prefix
    // invented here. The attestation/envelope schema (not yet built) is what decides
    // any on-chain hash-field prefix convention; this adapter doesn't get ahead of it.
    const hash = sha256Hex(content);
    const filePath = join(this.rootDir, hash);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return { contentHash: hash, storageKey: hash };
  }

  async getSignedUrl(storageKey: string): Promise<string> {
    const filePath = join(this.rootDir, storageKey);
    await readFile(filePath); // throws if missing, mirroring a real adapter's 404
    return `file://${filePath}`;
  }
}

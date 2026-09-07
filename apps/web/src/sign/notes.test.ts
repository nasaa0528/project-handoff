import { afterEach, describe, expect, it, vi } from "vitest";
import { byteLength, sha256Hex } from "@handoff/schema";
import { hashNotes, notesToBytes, sha256HexOfBytes } from "./notes";

/**
 * Known-answer vectors from FIPS 180-2. The schema package hashes with
 * `node:crypto`, and under this app's build config that resolves to the
 * browser shim on purpose, so the two implementations are proven equal by
 * each matching the standard rather than by calling one from the other.
 */
const VECTORS = [
  { label: "nothing", input: "", digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { label: "abc", input: "abc", digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
  {
    label: "a two-block message",
    input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    digest: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  },
];

describe("notes hashing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(VECTORS)("matches the standard on $label", async ({ input, digest }) => {
    expect(await sha256HexOfBytes(notesToBytes(input))).toBe(digest);
  });

  it("hashes the UTF-8 bytes, so multibyte text counts as bytes and never collides with its ASCII neighbour", async () => {
    const mongolian = "Монгол ✓ 😀";
    const bytes = notesToBytes(mongolian);
    expect(bytes.byteLength).toBe(byteLength(mongolian));
    expect(bytes.byteLength).toBeGreaterThan(mongolian.length);
    const digest = await sha256HexOfBytes(bytes);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(await sha256HexOfBytes(notesToBytes(mongolian)));
    expect(digest).not.toBe(await sha256HexOfBytes(notesToBytes("Монгол ✓ 😁")));
  });

  it("returns the bytes it hashed, so what is stored is what was committed to", async () => {
    const notes = "Footnote 2 dates the filing before the period ends.";
    const { bytes, hash } = await hashNotes(notes);
    expect(new TextDecoder().decode(bytes)).toBe(notes);
    expect(bytes.byteLength).toBe(byteLength(notes));
    expect(hash).toBe(await sha256HexOfBytes(notesToBytes(notes)));
  });

  it("handles a hundred kilobytes without complaint", async () => {
    const hash = await sha256HexOfBytes(notesToBytes("x".repeat(100_000)));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says why when Web Crypto is missing, instead of failing on a property read", async () => {
    vi.stubGlobal("crypto", {});
    await expect(hashNotes("anything")).rejects.toThrow(/secure context/);
  });

  it("keeps the schema package's node:crypto hashing unreachable from this app", () => {
    // The shim wired in vite.config.ts is live under test as well as in the
    // browser. If this ever passes silently, app code could hash through
    // node:crypto in CI and break the moment it runs in a browser.
    expect(() => sha256Hex("anything")).toThrow(/node:crypto is not available/);
  });
});

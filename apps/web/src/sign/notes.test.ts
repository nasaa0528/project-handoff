import { describe, expect, it } from "vitest";
import { byteLength, sha256Hex } from "@handoff/schema";
import { hashNotes, notesToBytes, sha256HexOfBytes } from "./notes";

/** sha-256 of the empty string, from the standard. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const cases = [
  { label: "nothing", notes: "" },
  { label: "a word", notes: "approve" },
  { label: "a sentence with a newline", notes: "The Q2 total does not foot.\n" },
  { label: "multibyte text", notes: "Монгол ✓ 😀" },
  { label: "a hundred kilobytes", notes: "x".repeat(100_000) },
];

describe("notes hashing", () => {
  it("matches the known digest of nothing", async () => {
    expect(await sha256HexOfBytes(notesToBytes(""))).toBe(EMPTY_SHA256);
  });

  it.each(cases)("agrees with the schema package on $label", async ({ notes }) => {
    const bytes = notesToBytes(notes);
    expect(await sha256HexOfBytes(bytes)).toBe(sha256Hex(bytes));
  });

  it("returns the bytes it hashed, so what is stored is what was committed to", async () => {
    const notes = "Footnote 2 dates the filing before the period ends.";
    const { bytes, hash } = await hashNotes(notes);
    expect(new TextDecoder().decode(bytes)).toBe(notes);
    expect(bytes.byteLength).toBe(byteLength(notes));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(sha256Hex(bytes));
  });
});

import { describe, expect, it } from "vitest";
import { DEFECTS_MAX_ITEMS, HCS_MESSAGE_MAX_BYTES, ReviewOrder, SCHEMA_VERSION } from "@handoff/schema";
import { previewAttestation } from "./preview";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);

const order = ReviewOrder.parse({
  order_id: "ord_demo",
  class: "review",
  spec_hash: hashA,
  artifact_hash_in: hashB,
  cert_tag: "demo-reviewer",
  price_tinybars: "20000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 3600,
  schema_version: SCHEMA_VERSION,
});

describe("previewAttestation", () => {
  it("shows the exact canonical bytes and their size for a valid draft", () => {
    const preview = previewAttestation(order, { verdict: "approve", defects: [], notesHash: hashC });
    expect(preview.problems).toEqual([]);
    expect(preview.body).toContain('"class":"review"');
    expect(preview.body).toContain(`"notes_hash":"${hashC}"`);
    expect(preview.bytes).toBeGreaterThan(0);
    expect(preview.bytes).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
    expect(preview.maxBytes).toBe(HCS_MESSAGE_MAX_BYTES);
  });

  it("has no body and names the problem when the draft would be refused", () => {
    const preview = previewAttestation(order, {
      verdict: "approve",
      defects: Array.from({ length: DEFECTS_MAX_ITEMS + 1 }, () => "x"),
      notesHash: hashC,
    });
    expect(preview.body).toBeNull();
    expect(preview.problems).toHaveLength(1);
    expect(preview.problems[0]).toContain(String(DEFECTS_MAX_ITEMS));
  });

  it("reports a bad notes hash instead of throwing", () => {
    const preview = previewAttestation(order, { verdict: "approve", defects: [], notesHash: "nope" });
    expect(preview.body).toBeNull();
    expect(preview.problems.length).toBeGreaterThan(0);
  });
});

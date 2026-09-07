import { describe, expect, it } from "vitest";
import {
  byteLength,
  CERT_TAG_MAX_BYTES,
  decodeAttestation,
  DEFECT_CODE_MAX_BYTES,
  DEFECTS_MAX_ITEMS,
  encodeAttestation,
  ExecutionOrder,
  HCS_MESSAGE_MAX_BYTES,
  ORDER_ID_MAX_BYTES,
  ReviewOrder,
  SCHEMA_VERSION,
} from "@handoff/schema";
import { buildReviewAttestation, defectProblems, type ReviewDraft } from "./attestation";

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

const draft: ReviewDraft = {
  verdict: "approve_with_changes",
  defects: ["FN-2-DATE"],
  notesHash: hashC,
};

describe("buildReviewAttestation", () => {
  it("pins the order id, the artifact hash and the cert tag from the envelope", () => {
    expect(buildReviewAttestation(order, draft)).toEqual({
      order_id: "ord_demo",
      class: "review",
      verdict: "approve_with_changes",
      defects: ["FN-2-DATE"],
      notes_hash: hashC,
      artifact_hash_in: hashB,
      cert_tag: "demo-reviewer",
      schema_version: SCHEMA_VERSION,
    });
  });

  it("never carries an output hash, because a review produces nothing", () => {
    expect("artifact_hash_out" in buildReviewAttestation(order, draft)).toBe(false);
  });

  it("refuses an execution order at the type level and at runtime", () => {
    const execution = ExecutionOrder.parse({
      order_id: "ord_exec",
      class: "execution",
      spec_hash: hashA,
      acceptance_hash: hashB,
      cert_tag: "devops",
      price_tinybars: "1",
      deadline: "2026-09-14T00:00:00Z",
      claim_timeout_seconds: 3600,
      schema_version: SCHEMA_VERSION,
    });
    // @ts-expect-error the class is declared at order time and never switched
    expect(() => buildReviewAttestation(execution, draft)).toThrow();
  });

  it("refuses one defect more than the bound, and accepts the bound", () => {
    const codes = (n: number) => Array.from({ length: n }, (_, i) => `D-${i}`);
    expect(buildReviewAttestation(order, { ...draft, defects: codes(DEFECTS_MAX_ITEMS) }).defects).toHaveLength(
      DEFECTS_MAX_ITEMS,
    );
    expect(() => buildReviewAttestation(order, { ...draft, defects: codes(DEFECTS_MAX_ITEMS + 1) })).toThrow();
  });

  it("accepts a defect code at the byte bound and refuses one byte over", () => {
    const atBound = "x".repeat(DEFECT_CODE_MAX_BYTES);
    expect(buildReviewAttestation(order, { ...draft, defects: [atBound] }).defects).toEqual([atBound]);
    expect(() => buildReviewAttestation(order, { ...draft, defects: [`${atBound}x`] })).toThrow();
  });

  it("counts bytes, not characters", () => {
    const twoBytesEach = "ж".repeat(DEFECT_CODE_MAX_BYTES / 2);
    expect(byteLength(twoBytesEach)).toBe(DEFECT_CODE_MAX_BYTES);
    expect(buildReviewAttestation(order, { ...draft, defects: [twoBytesEach] }).defects).toEqual([twoBytesEach]);
    expect(() => buildReviewAttestation(order, { ...draft, defects: [`${twoBytesEach}ж`] })).toThrow();
  });

  it("refuses a badly formed notes hash", () => {
    expect(() => buildReviewAttestation(order, { ...draft, notesHash: hashC.toUpperCase() })).toThrow();
    expect(() => buildReviewAttestation(order, { ...draft, notesHash: hashC.slice(1) })).toThrow();
  });

  it("omits prior_attestation_ref when there is none, and carries it when there is", () => {
    expect("prior_attestation_ref" in buildReviewAttestation(order, draft)).toBe(false);
    expect(
      buildReviewAttestation(order, { ...draft, priorAttestationRef: hashA }).prior_attestation_ref,
    ).toBe(hashA);
  });

  it("at every bound at once still fits one HCS message", () => {
    const widest = ReviewOrder.parse({
      ...order,
      order_id: "o".repeat(ORDER_ID_MAX_BYTES),
      cert_tag: "c".repeat(CERT_TAG_MAX_BYTES),
    });
    const built = buildReviewAttestation(widest, {
      verdict: "approve_with_changes",
      defects: Array.from({ length: DEFECTS_MAX_ITEMS }, () => "d".repeat(DEFECT_CODE_MAX_BYTES)),
      notesHash: hashC,
      priorAttestationRef: hashA,
    });
    const body = encodeAttestation(built);
    expect(byteLength(body)).toBeLessThanOrEqual(HCS_MESSAGE_MAX_BYTES);
    expect(decodeAttestation(body)).toEqual(built);
  });
});

describe("defectProblems", () => {
  it("is empty for an acceptable list", () => {
    expect(defectProblems([])).toEqual([]);
    expect(defectProblems(["TOTAL-MISMATCH", "FN-2-DATE"])).toEqual([]);
  });

  it("names the count bound from the schema package", () => {
    const problems = defectProblems(Array.from({ length: DEFECTS_MAX_ITEMS + 1 }, () => "ok"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(String(DEFECTS_MAX_ITEMS));
  });

  it("names the offending code by position, in the verifier's words", () => {
    const problems = defectProblems(["ok", "", "x".repeat(DEFECT_CODE_MAX_BYTES + 1)]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^defect 2: /);
    expect(problems[1]).toMatch(/^defect 3: /);
    expect(problems[1]).toContain(String(DEFECT_CODE_MAX_BYTES));
  });
});

/**
 * Building the attestation the expert signs.
 *
 * Everything the attestation pins comes from two places and nowhere else: the
 * order envelope (order id, the artifact hash, the cert tag) and the expert's
 * draft (verdict, defect codes, the hash of their notes). The class is
 * `review` because that is the class the order declared, and a review pins
 * `artifact_hash_in` only. The `ReviewAttestation` type from `@handoff/schema`
 * has no `artifact_hash_out` slot, so this file cannot produce the wrong
 * shape, and `buildReviewAttestation` only accepts a `ReviewOrder`, so an
 * execution order cannot be signed off as a review by mistake.
 *
 * The bounds on `defects[]` are imported, never restated. A value this file
 * accepts is a value the verifier accepts, by construction.
 */

import {
  DEFECTS_MAX_ITEMS,
  DefectCode,
  ReviewAttestation,
  SCHEMA_VERSION,
  type ReviewOrder,
  type Verdict,
} from "@handoff/schema";

export interface ReviewDraft {
  readonly verdict: Verdict;
  /** Short structured codes, bounded by the schema package. Never prose. */
  readonly defects: readonly string[];
  /** sha-256 of the written notes. The notes themselves never come near this. */
  readonly notesHash: string;
  readonly priorAttestationRef?: string;
}

/**
 * Validate and assemble. Parsing rather than asserting: the bounds on
 * `defects[]` and the hash format are the verifier's bounds, and a draft that
 * fails them fails here, before anything is stored or published.
 */
export function buildReviewAttestation(order: ReviewOrder, draft: ReviewDraft): ReviewAttestation {
  return ReviewAttestation.parse({
    order_id: order.order_id,
    class: "review",
    verdict: draft.verdict,
    defects: [...draft.defects],
    notes_hash: draft.notesHash,
    artifact_hash_in: order.artifact_hash_in,
    cert_tag: order.cert_tag,
    schema_version: SCHEMA_VERSION,
    ...(draft.priorAttestationRef === undefined
      ? {}
      : { prior_attestation_ref: draft.priorAttestationRef }),
  });
}

/**
 * What is wrong with a defect list, in the verifier's own words, for live
 * feedback in the editor. Empty when the list is acceptable.
 */
export function defectProblems(defects: readonly string[]): readonly string[] {
  const problems: string[] = [];

  if (defects.length > DEFECTS_MAX_ITEMS) {
    problems.push(`at most ${DEFECTS_MAX_ITEMS} defect codes fit in one attestation`);
  }

  defects.forEach((code, index) => {
    const result = DefectCode.safeParse(code);
    if (!result.success) {
      problems.push(`defect ${index + 1}: ${result.error.issues[0]?.message ?? "not a defect code"}`);
    }
  });

  return problems;
}

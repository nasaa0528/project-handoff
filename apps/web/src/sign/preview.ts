/**
 * What the screen shows before the expert signs: the exact bytes that would
 * go on the topic, how big they are, and anything the verifier would refuse.
 *
 * Built through the same two functions the sign action uses, so the preview
 * cannot disagree with what is published. No second encoder here.
 */

import { byteLength, encodeAttestation, HCS_MESSAGE_MAX_BYTES, type ReviewOrder } from "@handoff/schema";
import { buildReviewAttestation, defectProblems, type ReviewDraft } from "./attestation";

export interface AttestationPreview {
  /** The canonical body, or null when the draft does not validate. */
  readonly body: string | null;
  readonly bytes: number;
  readonly maxBytes: number;
  /** Empty when the draft is ready to sign. */
  readonly problems: readonly string[];
}

export function previewAttestation(order: ReviewOrder, draft: ReviewDraft): AttestationPreview {
  const problems = [...defectProblems(draft.defects)];

  if (problems.length === 0) {
    try {
      const body = encodeAttestation(buildReviewAttestation(order, draft));
      return { body, bytes: byteLength(body), maxBytes: HCS_MESSAGE_MAX_BYTES, problems: [] };
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { body: null, bytes: 0, maxBytes: HCS_MESSAGE_MAX_BYTES, problems };
}

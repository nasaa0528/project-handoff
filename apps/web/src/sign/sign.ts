/**
 * The sign action: publish the attestation from the expert's own account.
 *
 * This is the moment the demo is built around. The expert's key signs the HCS
 * message and nothing else. It is never a schedule key, and nothing in this
 * app can make it one: the `ChainAdapter` handed in here is constructed with
 * the expert's own account and has no platform key to reach for. Payout is a
 * separate step, the platform verifier plus the schedule admin co-signing
 * after they validate what was published, and the expert does not perform it.
 *
 * The order of operations is the design:
 *
 * 1. Hash the notes and build the attestation. Validation happens here, so a
 *    draft the verifier would reject costs nothing.
 * 2. Encode it: canonical bytes, proven to fit one HCS message.
 * 3. Store the notes under their hash. The commitment must have content
 *    behind it before the commitment exists.
 * 4. Publish. The transaction id and consensus timestamp come back and are
 *    threaded to the screen, never swallowed. Settlement is then read from a
 *    mirror node, never inferred from having sent this.
 *
 * A failure at any step leaves nothing published.
 */

import {
  encodeAttestation,
  type ChainAdapter,
  type ReviewAttestation,
  type ReviewOrder,
  type Verdict,
} from "@handoff/schema";
import type { ContentStore } from "../content";
import { buildReviewAttestation } from "./attestation";
import { hashNotes } from "./notes";

/** What the sign screen knows about the order it is signing for. */
export interface OrderForSigning {
  readonly envelope: ReviewOrder;
  /** Where the order value is locked. Shown, never touched by this app. */
  readonly escrowAccountId: string;
  /** The topic the attestation is published to. */
  readonly topicId: string;
}

export interface SignInput {
  readonly order: OrderForSigning;
  readonly verdict: Verdict;
  readonly defects: readonly string[];
  /** The written review. Stored, hashed, never published. */
  readonly notes: string;
  readonly priorAttestationRef?: string;
}

export interface SignDeps {
  /** Constructed with the expert's own account. Never a platform key. */
  readonly chain: ChainAdapter;
  readonly content: ContentStore;
}

export interface SignedAttestation {
  readonly attestation: ReviewAttestation;
  /** The exact bytes on the topic. */
  readonly body: string;
  readonly notesRef: string;
  readonly topicId: string;
  /** Surfaced, never swallowed. This is what the screen and the Hashscan link show. */
  readonly transactionId: string;
  /** The network's word on when this was signed. */
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
}

export async function signAndPublish(input: SignInput, deps: SignDeps): Promise<SignedAttestation> {
  const notes = await hashNotes(input.notes);

  const attestation = buildReviewAttestation(input.order.envelope, {
    verdict: input.verdict,
    defects: input.defects,
    notesHash: notes.hash,
    ...(input.priorAttestationRef === undefined
      ? {}
      : { priorAttestationRef: input.priorAttestationRef }),
  });

  const body = encodeAttestation(attestation);

  const notesRef = await deps.content.put(notes.hash, notes.bytes);

  const consensus = await deps.chain.submitMessage(input.order.topicId, body);

  return {
    attestation,
    body,
    notesRef,
    topicId: input.order.topicId,
    transactionId: consensus.transactionId,
    consensusTimestamp: consensus.consensusTimestamp,
    sequenceNumber: consensus.sequenceNumber,
  };
}

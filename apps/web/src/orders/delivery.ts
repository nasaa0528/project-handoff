/**
 * Has the verdict already been published?
 *
 * The app could not answer that. `TestnetOrderSource` read the orders topic and
 * nothing else, so an order the expert had already signed looked exactly like
 * one they had not: the workspace opened in `idle` and offered the sign form
 * again. It was taken up. On testnet, 2026-09-12, account `0.0.10376659`
 * published two attestations for `ord_aa28a54a05804d3e8b1d2f903cb6fb09` — seq 7
 * at `1789212074.919751414` and seq 8 at `1789212182.262974104`, 107 seconds
 * apart. The money was safe, because the verifier pays the earliest matching
 * attestation and the payout memo makes a second payment impossible, but the
 * second message is on a public topic forever and the UI invited it.
 *
 * **Delivery is a separate fact from the claim, not a claim state.** The treaty
 * models it that way — `resolveClaims` takes `deliveredAt` as an *input* beside
 * the claims — so this app does too. `ClaimState` still answers "who holds it";
 * this answers "has it been signed", and the two are read together.
 *
 * **Which attestation counts is the same rule the verifier pays on.** The
 * attestations topic carries no submit key, so anybody can publish anything
 * about any order. A stray message must not hide the sign form from the expert
 * who actually holds the claim, so only the holder's own counts, and only when
 * its class, artifact hash and cert tag are the order's. The earliest match
 * wins, not the last, for the same reason `settleOrder` takes the earliest: a
 * later divergent message must not change what the first one settled.
 */

import { compareConsensusTimestamps, decodeAttestation, type Attestation, type OrderEnvelope, type TopicMessage, type Verdict } from "@handoff/schema";

/** The verdict on the topic, as the screens need it. Null everywhere until one exists. */
export interface DeliveredState {
  /** The account that published it. The payer of the topic message, never a body field. */
  readonly signedBy: string;
  /** True when this expert is the one who signed. The sign form hides on this. */
  readonly yours: boolean;
  readonly verdict: Verdict;
  readonly consensusTimestamp: string;
  /**
   * Its place on the attestations topic. A mirror read carries no transaction
   * id, so this and the consensus timestamp are what a reopened order has to
   * identify the message with — the topic link, not a transaction link.
   */
  readonly sequenceNumber: number;
}

/** An attestation for the order, or nothing. Anything unparsable is not one. */
function tryDecode(body: string): Attestation | null {
  try {
    return decodeAttestation(body);
  } catch {
    return null;
  }
}

/**
 * The mechanical half of the verifier's rule, repeated here so the UI agrees
 * with what will actually be paid.
 *
 * TODO(NAS): this cross-check exists twice — here and in `apps/mcp`'s
 * `assertAttestationMatchesOrder` — and belongs beside the schemas it compares,
 * in `@handoff/schema` next to `Attestation` and `OrderEnvelope`. Importing the
 * verifier's copy is not an option: it is a server module. Duplicated
 * deliberately and narrowly, rather than left out, because an attestation the
 * verifier will refuse must not read to the expert as delivered.
 */
function matchesOrder(attestation: Attestation, envelope: OrderEnvelope): boolean {
  if (attestation.order_id !== envelope.order_id) return false;
  if (attestation.class !== envelope.class) return false;
  if (attestation.cert_tag !== envelope.cert_tag) return false;
  // `review` pins the input hash and nothing else. A missing or extra hash for
  // the class is a schema violation, which the discriminated union already
  // makes unconstructable, so only the value is compared here.
  return attestation.artifact_hash_in === envelope.artifact_hash_in;
}

/**
 * That account's own earliest matching verdict for this order, if it is
 * published.
 *
 * `candidateAccountId` comes from `claimCandidateAccountIdFor` — whoever the
 * claim rule last had standing on the order, live or lapsed — and is null on an
 * order nobody has claimed, which nobody can have delivered.
 */
export function deliveredStateFor(
  envelope: OrderEnvelope,
  messages: readonly TopicMessage[],
  candidateAccountId: string | null,
  expertAccountId: string,
): DeliveredState | null {
  if (candidateAccountId === null) return null;

  const matches = messages
    .filter((message) => message.payerAccountId === candidateAccountId)
    .map((message) => ({ message, attestation: tryDecode(message.contents) }))
    .filter(
      (found): found is { message: TopicMessage; attestation: Attestation } =>
        found.attestation !== null && matchesOrder(found.attestation, envelope),
    )
    .sort((a, b) => compareConsensusTimestamps(a.message.consensusTimestamp, b.message.consensusTimestamp));

  const earliest = matches[0];
  if (earliest === undefined) return null;

  return {
    signedBy: earliest.message.payerAccountId,
    yours: earliest.message.payerAccountId === expertAccountId,
    verdict: earliest.attestation.verdict,
    consensusTimestamp: earliest.message.consensusTimestamp,
    sequenceNumber: earliest.message.sequenceNumber,
  };
}

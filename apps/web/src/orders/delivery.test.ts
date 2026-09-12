import { describe, expect, it } from "vitest";
import { encodeAttestation, ReviewOrder, SCHEMA_VERSION, type TopicMessage } from "@handoff/schema";
import { deliveredStateFor } from "./delivery";

const ATTESTATIONS = "0.0.4243";
const EXPERT = "0.0.12345";
const STRANGER = "0.0.99999";

// Fabricated, not computed: `sha256Hex` is the Node path and this suite runs in
// the browser environment, where the schema package refuses it on purpose. What
// these tests compare is whether two hex strings are equal, never what they hash.
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const ORDER = ReviewOrder.parse({
  order_id: "ord_1",
  class: "review",
  spec_hash: HASH,
  artifact_hash_in: HASH,
  cert_tag: "cpa-us",
  price_tinybars: "10000000000",
  deadline: "2099-01-01T00:00:00Z",
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
});

function attestation(overrides: Record<string, unknown> = {}): string {
  return encodeAttestation({
    order_id: "ord_1",
    class: "review",
    verdict: "approve",
    defects: [],
    notes_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    schema_version: SCHEMA_VERSION,
    ...overrides,
  });
}

function message(payerAccountId: string, contents: string, sequenceNumber: number, seconds: number): TopicMessage {
  return {
    topicId: ATTESTATIONS,
    sequenceNumber,
    consensusTimestamp: `${1789212000 + seconds}.000000000`,
    payerAccountId,
    contents,
  };
}

describe("deliveredStateFor", () => {
  it("reports the holder's own verdict, and says it is theirs", () => {
    const delivered = deliveredStateFor(ORDER, [message(EXPERT, attestation(), 7, 74)], EXPERT, EXPERT);

    expect(delivered).not.toBeNull();
    expect(delivered?.yours).toBe(true);
    expect(delivered?.verdict).toBe("approve");
    expect(delivered?.signedBy).toBe(EXPERT);
    expect(delivered?.sequenceNumber).toBe(7);
  });

  it("reports another expert's verdict as not yours, so the form stays shut for them too", () => {
    const delivered = deliveredStateFor(ORDER, [message(STRANGER, attestation(), 7, 74)], STRANGER, EXPERT);

    expect(delivered?.yours).toBe(false);
    expect(delivered?.signedBy).toBe(STRANGER);
  });

  it("ignores a message from an account that does not hold the claim", () => {
    // The attestations topic has no submit key. If a stranger's message counted,
    // anyone could hide the sign form from the expert who actually holds the
    // order — or pin their claim open — for the price of one HCS message.
    const delivered = deliveredStateFor(ORDER, [message(STRANGER, attestation(), 7, 74)], EXPERT, EXPERT);

    expect(delivered).toBeNull();
  });

  it("ignores the holder's own message when it is not a verdict on this order", () => {
    // Same rule the verifier pays on: an attestation pinning a different
    // artifact is a schema violation, and one it will refuse must not read to
    // the expert as delivered.
    const wrongArtifact = message(EXPERT, attestation({ artifact_hash_in: OTHER_HASH }), 7, 74);
    const wrongOrder = message(EXPERT, attestation({ order_id: "ord_2" }), 8, 75);
    const wrongTag = message(EXPERT, attestation({ cert_tag: "other-tag" }), 9, 76);

    expect(deliveredStateFor(ORDER, [wrongArtifact], EXPERT, EXPERT)).toBeNull();
    expect(deliveredStateFor(ORDER, [wrongOrder], EXPERT, EXPERT)).toBeNull();
    expect(deliveredStateFor(ORDER, [wrongTag], EXPERT, EXPERT)).toBeNull();
  });

  it("ignores anything on the topic that is not an attestation at all", () => {
    const noise = message(EXPERT, "not json", 7, 74);

    expect(deliveredStateFor(ORDER, [noise], EXPERT, EXPERT)).toBeNull();
  });

  it("takes the earliest match, not the last, the same as the verifier", () => {
    // This is the shape the incident left on the topic: two attestations from
    // one account for one order, 107 seconds apart. The payout went to the
    // first, so the screen has to name the first.
    const first = message(EXPERT, attestation(), 7, 74);
    const second = message(EXPERT, attestation({ verdict: "reject", defects: ["LATE"] }), 8, 182);

    const delivered = deliveredStateFor(ORDER, [second, first], EXPERT, EXPERT);

    expect(delivered?.sequenceNumber).toBe(7);
    expect(delivered?.verdict).toBe("approve");
  });

  it("is null when nobody holds the claim, whatever is on the topic", () => {
    const delivered = deliveredStateFor(ORDER, [message(EXPERT, attestation(), 7, 74)], null, EXPERT);

    expect(delivered).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  decodeAttestation,
  MockChainAdapter,
  ReviewOrder,
  SCHEMA_VERSION,
  type ConsensusRef,
} from "@handoff/schema";
import { InMemoryContentStore, type ContentStore } from "../content";
import { signAndPublish, type OrderForSigning } from "./sign";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

const envelope = ReviewOrder.parse({
  order_id: "ord_demo",
  class: "review",
  spec_hash: hashA,
  artifact_hash_in: hashB,
  cert_tag: "demo-reviewer",
  price_tinybars: "10000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 3600,
  schema_version: SCHEMA_VERSION,
});

const order: OrderForSigning = {
  envelope,
  escrowAccountId: "MOCK-escrow-ord_demo",
  attestationsTopicId: "MOCK-topic-attestations",
};

const ORDERS_TOPIC = "MOCK-topic-orders";

const NOTES =
  "The Q2 total does not foot: 1,240 minus 980 is 260, and footnote 2 dates the filing " +
  "before the period ends.";

/** A mock chain and store that record the order in which they are touched. */
function harness() {
  const log: string[] = [];

  class RecordingChain extends MockChainAdapter {
    override async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
      log.push("publish");
      return super.submitMessage(topicId, contents);
    }
  }

  const chain = new RecordingChain();
  const store = new InMemoryContentStore();
  const content: ContentStore = {
    async put(hash, bytes) {
      log.push("store");
      return store.put(hash, bytes);
    },
    get: (hash) => store.get(hash),
  };

  return { chain, store, content, log };
}

describe("signAndPublish", () => {
  it("publishes exactly the canonical attestation, with the transaction id threaded through", async () => {
    const h = harness();
    const signed = await signAndPublish(
      { order, verdict: "reject", defects: ["TOTAL-MISMATCH", "FN-2-DATE"], notes: NOTES },
      h,
    );

    expect(signed.transactionId).toMatch(/^MOCK-tx-/);
    expect(signed.consensusTimestamp).toMatch(/^\d+\.\d{9}$/);
    expect(signed.sequenceNumber).toBe(1);
    expect(signed.topicId).toBe(order.attestationsTopicId);

    const [message] = await h.chain.readMessages(order.attestationsTopicId);
    expect(message?.contents).toBe(signed.body);
    expect(decodeAttestation(signed.body)).toEqual(signed.attestation);
    expect(signed.attestation.class).toBe("review");
    expect(signed.attestation.artifact_hash_in).toBe(envelope.artifact_hash_in);
    expect(signed.attestation.cert_tag).toBe(envelope.cert_tag);
  });

  it("puts the notes in the store under their hash, and only the hash on the topic", async () => {
    const h = harness();
    const signed = await signAndPublish({ order, verdict: "approve", defects: [], notes: NOTES }, h);

    expect(signed.body).not.toContain("does not foot");
    expect(signed.body).toContain(signed.attestation.notes_hash);
    expect(new TextDecoder().decode((await h.store.get(signed.attestation.notes_hash)) ?? undefined)).toBe(NOTES);
    expect(signed.notesRef).toBe(`memory://${signed.attestation.notes_hash}`);
  });

  it("stores before it publishes, so the commitment always has content behind it", async () => {
    const h = harness();
    await signAndPublish({ order, verdict: "approve", defects: [], notes: NOTES }, h);
    expect(h.log).toEqual(["store", "publish"]);
  });

  it("refuses a draft the verifier would refuse, before storing or publishing anything", async () => {
    const h = harness();
    const tooMany = Array.from({ length: 9 }, (_, i) => `D-${i}`);
    await expect(
      signAndPublish({ order, verdict: "approve", defects: tooMany, notes: NOTES }, h),
    ).rejects.toThrow();
    expect(h.log).toEqual([]);
    expect(await h.chain.readMessages(order.attestationsTopicId)).toEqual([]);
  });

  it("publishes nothing when the content store fails", async () => {
    const h = harness();
    const failing: ContentStore = {
      async put() {
        throw new Error("store down");
      },
      async get() {
        return null;
      },
    };
    await expect(
      signAndPublish({ order, verdict: "approve", defects: [], notes: NOTES }, { chain: h.chain, content: failing }),
    ).rejects.toThrow("store down");
    expect(await h.chain.readMessages(order.attestationsTopicId)).toEqual([]);
  });

  it("signs a reject exactly like an approve, because a reject is a delivered product", async () => {
    for (const verdict of ["approve", "approve_with_changes", "reject"] as const) {
      const h = harness();
      const signed = await signAndPublish({ order, verdict, defects: [], notes: NOTES }, h);
      expect(signed.attestation.verdict).toBe(verdict);
      expect(await h.chain.readMessages(order.attestationsTopicId)).toHaveLength(1);
      expect(h.log).toEqual(["store", "publish"]);
    }
  });
});

describe("which topic the attestation lands on", () => {
  /**
   * The bug this replaces: the app carried one topic id, the sign path used it,
   * and the verdict went to the orders topic while apps/mcp read the
   * attestations topic. Both calls succeed, nothing throws, and the payout
   * never fires. So assert the destination, not just that something published.
   */
  it("publishes to the attestations topic and never to the orders topic", async () => {
    const h = harness();
    const signed = await signAndPublish(
      { order, verdict: "approve", defects: [], notes: NOTES },
      h,
    );

    expect(signed.topicId).toBe("MOCK-topic-attestations");
    expect(await h.chain.readMessages("MOCK-topic-attestations")).toHaveLength(1);
    expect(await h.chain.readMessages(ORDERS_TOPIC)).toEqual([]);
  });
});

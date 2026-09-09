import { describe, expect, it } from "vitest";
import { encodeEnvelope, ReviewOrder, SCHEMA_VERSION, type ConsensusRef, type TopicMessage } from "@handoff/schema";
import { InMemoryContentStore } from "../content";
import { claimBody } from "../orders/claim";
import { notesToBytes, sha256HexOfBytes } from "../sign/notes";
import { TestnetOrderSource, tryDecodeReviewOrder } from "./testnetOrders";

const TOPIC = "0.0.4242";
const ATT_TOPIC = "0.0.4243";
const EXPERT = "0.0.12345";
const RIVAL = "0.0.99999";
const ESCROW = "0.0.999";
const SPEC = "FAKE — demo fixture.\n\nTask (FAKE): review the attached FAKE summary for consistency. Return a verdict.";
const DOCUMENT = "FAKE DOCUMENT — fabricated for the demo.";

/** 2026-09-08T12:00:00Z, as seconds. The orders close on 2026-09-14. */
const T0 = Date.UTC(2026, 8, 8, 12, 0, 0) / 1000;
const at = (seconds: number, nanos = 0): string => `${T0 + seconds}.${String(nanos).padStart(9, "0")}`;

async function fixtures() {
  const content = new InMemoryContentStore();
  const specHash = await sha256HexOfBytes(notesToBytes(SPEC));
  const artifactHash = await sha256HexOfBytes(notesToBytes(DOCUMENT));
  await content.put(specHash, notesToBytes(SPEC));
  await content.put(artifactHash, notesToBytes(DOCUMENT));
  const envelope = (orderId: string) =>
    ReviewOrder.parse({
      order_id: orderId,
      class: "review",
      spec_hash: specHash,
      artifact_hash_in: artifactHash,
      cert_tag: "demo-reviewer",
      price_tinybars: "10000000000",
      deadline: "2026-09-14T00:00:00Z",
      claim_timeout_seconds: 1800,
      schema_version: SCHEMA_VERSION,
    });
  return { content, envelope, specHash };
}

function fakeChain(initial: readonly TopicMessage[]) {
  const messages = [...initial];
  const submitted: string[] = [];
  const chain = {
    async readMessages() {
      return messages;
    },
    async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
      submitted.push(contents);
      const sequenceNumber = messages.length + 1;
      const consensusTimestamp = at(100 + sequenceNumber);
      messages.push({ topicId, sequenceNumber, consensusTimestamp, payerAccountId: EXPERT, contents });
      return { transactionId: `0.0.12345@${consensusTimestamp}`, consensusTimestamp, sequenceNumber };
    },
  };
  return { chain, messages, submitted };
}

const message = (sequenceNumber: number, consensusTimestamp: string, payerAccountId: string, contents: string): TopicMessage => ({
  topicId: TOPIC,
  sequenceNumber,
  consensusTimestamp,
  payerAccountId,
  contents,
});

describe("TestnetOrderSource", () => {
  it("lists review orders off the topic with the ask from the content store and the claim from the treaty's rule", async () => {
    const { content, envelope } = await fixtures();
    const open = envelope("ord_open");
    const taken = envelope("ord_taken");
    const { chain } = fakeChain([
      message(1, at(0), "0.0.5", encodeEnvelope(open)),
      message(2, at(1), "0.0.5", encodeEnvelope(taken)),
      message(3, at(2), RIVAL, claimBody(taken)),
      message(4, at(3), "0.0.5", "{\"not\":\"an order\"}"),
      message(5, at(4), "0.0.5", encodeEnvelope(open)),
    ]);
    const source = new TestnetOrderSource({ chain, content, ordersTopicId: TOPIC,
    attestationsTopicId: ATT_TOPIC, escrowAccountId: ESCROW, expertAccountId: EXPERT, now: () => (T0 + 10) * 1000 });
    const entries = await source.list();
    expect(entries.map((e) => [e.order.envelope.order_id, e.claim.kind])).toEqual([
      ["ord_open", "open"],
      ["ord_taken", "someone-else"],
    ]);
    expect(entries[0]?.order.ask).toBe(SPEC);
    expect(entries[0]?.order.title).toBe("review the attached FAKE summary for consistency");
    expect(entries[0]?.order.escrowAccountId).toBe(ESCROW);
    expect(entries[0]?.order.documentWords).toBeNull();
  });

  it("says so when the ask is not in the store, rather than hiding the order", async () => {
    const { content, envelope } = await fixtures();
    const order = envelope("ord_x");
    const { chain } = fakeChain([message(1, at(0), "0.0.5", encodeEnvelope({ ...order, spec_hash: "f".repeat(64) }))]);
    const source = new TestnetOrderSource({ chain, content, ordersTopicId: TOPIC,
    attestationsTopicId: ATT_TOPIC, escrowAccountId: ESCROW, expertAccountId: EXPERT });
    const [entry] = await source.list();
    expect(entry?.order.ask).toContain("not in the content store yet");
    expect(entry?.order.title).toBe("Order ord_x");
  });

  it("claims from the expert's own chain with the treaty's body, and opens the document only once the topic says it is theirs", async () => {
    const { content, envelope } = await fixtures();
    const order = envelope("ord_open");
    const { chain, submitted } = fakeChain([message(1, at(0), "0.0.5", encodeEnvelope(order))]);
    const source = new TestnetOrderSource({ chain, content, ordersTopicId: TOPIC,
    attestationsTopicId: ATT_TOPIC, escrowAccountId: ESCROW, expertAccountId: EXPERT, now: () => (T0 + 200) * 1000 });
    const [entry] = await source.list();
    if (entry === undefined) throw new Error("no order");

    await expect(source.document(entry.order)).rejects.toThrow("after a confirmed claim");

    const receipt = await source.claim(entry.order);
    expect(JSON.parse(submitted[0] ?? "")).toEqual({ kind: "claim", order_id: "ord_open", cert_tag: "demo-reviewer", schema_version: 1 });
    expect(receipt.sequenceNumber).toBe(2);

    expect((await source.list())[0]?.claim.kind).toBe("yours");
    expect(await source.document(entry.order)).toBe(DOCUMENT);
  });

  it("decodes a review order and nothing else", async () => {
    const { envelope } = await fixtures();
    expect(tryDecodeReviewOrder(encodeEnvelope(envelope("ord")))?.order_id).toBe("ord");
    expect(tryDecodeReviewOrder(claimBody(envelope("ord")))).toBeNull();
    expect(tryDecodeReviewOrder("nope")).toBeNull();
  });
});

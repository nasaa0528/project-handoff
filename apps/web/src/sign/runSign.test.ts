import { describe, expect, it } from "vitest";
import { MockChainAdapter, ReviewOrder, SCHEMA_VERSION } from "@handoff/schema";
import type { WebChain } from "../chain/adapter";
import { InMemoryContentStore, type ContentStore } from "../content";
import { runSign, type SignRequest, type SignRunOutcomes } from "./runSign";
import type { OrderForSigning } from "./sign";

const envelope = ReviewOrder.parse({
  order_id: "ord_demo",
  class: "review",
  spec_hash: "a".repeat(64),
  artifact_hash_in: "b".repeat(64),
  cert_tag: "demo-reviewer",
  price_tinybars: "20000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 3600,
  schema_version: SCHEMA_VERSION,
});

const order: OrderForSigning = { envelope, escrowAccountId: "MOCK-escrow", topicId: "MOCK-topic-orders" };

const request: SignRequest = { order, verdict: "approve", defects: [], notes: "All three footnotes foot." };

function webChain(content: ContentStore = new InMemoryContentStore()): WebChain {
  return { mode: "mock", chain: new MockChainAdapter(), content };
}

function outcomes() {
  const calls: string[] = [];
  const record: SignRunOutcomes = {
    onSigned: (signed) => calls.push(`signed:${signed.transactionId}`),
    onPublishFailed: (message) => calls.push(`publish-failed:${message}`),
    onPlatformIssue: (message) => calls.push(`platform:${message}`),
  };
  return { calls, record };
}

describe("runSign", () => {
  it("reports signed, and only signed, when everything works", async () => {
    const o = outcomes();
    await runSign(request, { chain: webChain(), afterPublish: async () => {} }, o.record);
    expect(o.calls).toEqual(["signed:MOCK-tx-1"]);
  });

  it("reports not published, and nothing else, when the publish fails", async () => {
    const failing: ContentStore = {
      async put() {
        throw new Error("store down");
      },
    };
    const chain = webChain(failing);
    const o = outcomes();
    await runSign(request, { chain, afterPublish: async () => {} }, o.record);
    expect(o.calls).toEqual(["publish-failed:store down"]);
    expect(await chain.chain.readMessages(order.topicId)).toEqual([]);
  });

  it("never takes back a publish because the platform hook failed", async () => {
    const chain = webChain();
    const o = outcomes();
    await runSign(
      {
        ...request,
      },
      {
        chain,
        afterPublish: async () => {
          throw new Error("verifier unreachable");
        },
      },
      o.record,
    );
    expect(o.calls).toEqual(["signed:MOCK-tx-1", "platform:verifier unreachable"]);
    // The attestation is on the topic regardless.
    expect(await chain.chain.readMessages(order.topicId)).toHaveLength(1);
  });

  it("does nothing after the publish when there is no platform hook, as on testnet", async () => {
    const o = outcomes();
    await runSign(request, { chain: webChain() }, o.record);
    expect(o.calls).toEqual(["signed:MOCK-tx-1"]);
  });
});

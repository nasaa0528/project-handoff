import { describe, expect, it } from "vitest";
import { decodeEnvelope, MockChainAdapter } from "@handoff/schema";
import { FAKE_ARTIFACT, FAKE_SPEC, MockPlatform, seedClaimedReviewOrder, withSimulatedMirrorLag } from "./mockPlatform";

const FIXED_NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const EXPERT = "0.0.12345";
const TOPIC = "MOCK-topic-orders";

function seed(chain: MockChainAdapter) {
  return seedClaimedReviewOrder(chain, {
    ordersTopicId: TOPIC,
    requesterAccountId: "MOCK-requester",
    priceHbar: "200",
    now: () => FIXED_NOW,
  });
}

describe("seedClaimedReviewOrder", () => {
  it("locks the funds and publishes an envelope that carries hashes only", async () => {
    const chain = new MockChainAdapter({ now: () => FIXED_NOW });
    const order = await seed(chain);

    expect(order.envelope.price_tinybars).toBe("20000000000");
    expect(order.envelope.class).toBe("review");
    expect(order.escrowAccountId).toMatch(/^MOCK-escrow-/);
    expect(order.topicId).toBe(TOPIC);

    const messages = await chain.readMessages(TOPIC);
    expect(messages).toHaveLength(1);
    const body = messages[0]?.contents ?? "";
    expect(decodeEnvelope(body)).toEqual(order.envelope);
    expect(body).not.toContain("FAKE");
    expect(body).not.toContain(FAKE_SPEC.slice(0, 20));
    expect(body).not.toContain(FAKE_ARTIFACT.slice(0, 20));
  });

  it("says FAKE on every fixture, out loud", () => {
    expect(FAKE_SPEC).toContain("FAKE");
    expect(FAKE_ARTIFACT).toContain("FAKE");
  });
});

describe("MockPlatform", () => {
  it("releases payment by executing the schedule, and only once", async () => {
    const chain = new MockChainAdapter({ now: () => FIXED_NOW });
    const order = await seed(chain);
    const platform = new MockPlatform(chain, EXPERT);

    expect(await platform.locator(order.envelope.order_id).locate()).toBeNull();

    const first = await platform.releasePayment(order);
    expect(chain.hasExecuted(first.scheduleId)).toBe(true);
    expect(await chain.getTransaction(first.payoutTransactionId)).toMatchObject({ status: "SUCCESS" });
    expect(await platform.locator(order.envelope.order_id).locate()).toBe(first.payoutTransactionId);

    const second = await platform.releasePayment(order);
    expect(second).toEqual(first);
  });
});

describe("withSimulatedMirrorLag", () => {
  it("hides a record until the lag has passed since it was first asked for", async () => {
    let t = 0;
    const chain = new MockChainAdapter({ now: () => FIXED_NOW });
    const { transactionId } = await chain.submitMessage(TOPIC, "{}");
    const lagged = withSimulatedMirrorLag(chain, 6_000, () => t);

    expect(await lagged.getTransaction(transactionId)).toBeNull();
    t = 5_999;
    expect(await lagged.getTransaction(transactionId)).toBeNull();
    t = 6_000;
    expect(await lagged.getTransaction(transactionId)).toMatchObject({ transactionId, status: "SUCCESS" });
  });
});

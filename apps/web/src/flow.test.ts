/**
 * The demo path in miniature: an order is posted and claimed, the expert
 * signs from their own account, the platform releases payment, and the
 * screen learns about it from a lagging mirror read. Against the mock, so
 * every id is a MOCK- id; after the cutover the same sequence runs on testnet
 * and this file stays as the fixture.
 */

import { describe, expect, it } from "vitest";
import { decodeAttestation, MockChainAdapter } from "@handoff/schema";
import { MockPlatform, seedClaimedReviewOrder, withSimulatedMirrorLag } from "./chain/mockPlatform";
import { InMemoryContentStore } from "./content";
import { watchSettlement } from "./sign/settlement";
import { signAndPublish } from "./sign/sign";

const EXPERT = "0.0.12345";

describe("post, claim, sign, settle", () => {
  it("ends settled, with every transaction id in hand", async () => {
    let t = Date.UTC(2026, 8, 5, 12, 0, 0);
    const now = () => t;
    const chain = new MockChainAdapter({ now });
    const content = new InMemoryContentStore();
    const platform = new MockPlatform(chain, EXPERT);

    const order = await seedClaimedReviewOrder(chain, {
      ordersTopicId: "MOCK-topic-orders",
      requesterAccountId: "MOCK-requester",
      priceHbar: "200",
      now,
    });

    const signed = await signAndPublish(
      {
        order,
        verdict: "approve_with_changes",
        defects: ["FN-2-DATE"],
        notes: "Footnote 2 dates the filing before the period ends. Everything else foots.",
      },
      { chain, content },
    );

    // The verifier reads the attestation, validates it, and co-signs. The
    // expert does not do this and cannot: the platform keys are not here.
    const messages = await chain.readMessages(order.topicId);
    expect(messages).toHaveLength(2);
    expect(decodeAttestation(messages[1]?.contents ?? "")).toEqual(signed.attestation);
    const payout = await platform.releasePayment(order);

    const reader = withSimulatedMirrorLag(chain, 6_000, now);
    const final = await watchSettlement(
      {
        attestationTransactionId: signed.transactionId,
        reader,
        payout: platform.locator(order.envelope.order_id),
      },
      {
        now,
        sleep: async (ms) => {
          t += ms;
        },
      },
    );

    expect(final.phase).toBe("settled");
    expect(final.attestation?.transactionId).toBe(signed.transactionId);
    expect(final.payoutTransactionId).toBe(payout.payoutTransactionId);
    expect(final.elapsedMs).toBeGreaterThanOrEqual(6_000);
    expect(content.get(signed.attestation.notes_hash)).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { MockChainAdapter } from "@handoff/schema";
import { InMemoryContentStore } from "../content";
import { confirmClaim } from "../orders/claim";
import { MockOrderSource } from "./mockOrders";

const EXPERT = "0.0.12345";

async function seed() {
  let t = Date.UTC(2026, 8, 8, 12, 0, 0);
  const now = () => t;
  const chain = new MockChainAdapter({ now });
  const content = new InMemoryContentStore();
  const source = await MockOrderSource.seed(chain, content, {
    expertAccountId: EXPERT,
    ordersTopicId: "MOCK-topic-orders",
    attestationsTopicId: "MOCK-topic-attestations",
    requesterAccountId: "MOCK-requester",
    priceHbar: "100",
    mirrorLagMs: 6_000,
    now,
  });
  const advance = async (ms: number) => {
    t += ms;
  };
  return { source, now, advance };
}

describe("MockOrderSource", () => {
  it("lists what the topic says: two open, two claimed by others, none yours", async () => {
    const { source } = await seed();
    const entries = await source.list();
    expect(entries.map((e) => e.claim.kind)).toEqual(["open", "open", "someone-else", "someone-else"]);
    expect(entries.every((e) => e.order.ask.startsWith("FAKE"))).toBe(true);
    expect(entries.every((e) => (e.order.documentWords ?? 0) > 0)).toBe(true);
  });

  it("refuses the document before a confirmed claim, and hands it over after", async () => {
    const { source, now, advance } = await seed();
    const [first] = await source.list();
    if (first === undefined) throw new Error("no orders");
    await expect(source.document(first.order)).rejects.toThrow("after a confirmed claim");

    const submitted = await source.claim(first.order);
    const confirmation = await confirmClaim(
      {
        topicId: first.order.ordersTopicId,
        order: first.order.envelope,
        expertAccountId: EXPERT,
        submitted,
        reader: source.reader,
      },
      { now, sleep: advance, intervalMs: 2_000 },
    );
    expect(confirmation.phase).toBe("yours");
    expect(confirmation.elapsedMs).toBeGreaterThanOrEqual(6_000);
    expect(await source.document(first.order)).toContain("FAKE");
    expect((await source.list())[0]?.claim.kind).toBe("yours");
  });

  it("loses the rigged race to a rival the mirror confirms first", async () => {
    const { source, now, advance } = await seed();
    const [, second] = await source.list();
    if (second === undefined) throw new Error("no orders");
    const submitted = await source.claim(second.order);
    const confirmation = await confirmClaim(
      {
        topicId: second.order.ordersTopicId,
        order: second.order.envelope,
        expertAccountId: EXPERT,
        submitted,
        reader: source.reader,
      },
      { now, sleep: advance, intervalMs: 2_000 },
    );
    expect(confirmation.phase).toBe("someone-else");
    await expect(source.document(second.order)).rejects.toThrow("after a confirmed claim");
  });
});

import { describe, expect, it } from "vitest";
import {
  MockChainAdapter,
  sha256Hex,
  type ChainAdapter,
  type ConsensusRef,
  type EscrowRef,
  type LockFundsParams,
  type ScheduleRef,
  type CreateScheduleParams,
} from "@handoff/schema";
import { InMemoryContentStore } from "./content.js";
import { consensusEpochSeconds, packageReviewOrder, postReviewOrder } from "./order.js";
import type { ReviewOrderRequest } from "./order.js";

const POSTED_AT = Date.parse("2026-09-05T00:00:00Z");

const SPEC = "Review the attached quarterly report for arithmetic and disclosure defects.";
const ARTIFACT = new TextEncoder().encode("FAKE report. Revenue 12,000. Total 11,900.");

function request(overrides: Partial<ReviewOrderRequest> = {}): ReviewOrderRequest {
  return {
    spec: SPEC,
    artifact: ARTIFACT,
    certTag: "cpa-us",
    priceHbar: "200",
    deadline: "2026-09-14T00:00:00Z",
    claimTimeoutSeconds: 3600,
    ...overrides,
  };
}

/** Records the order of chain calls, because the order is the design. */
class RecordingAdapter implements ChainAdapter {
  readonly network = "testnet" as const;
  readonly calls: string[] = [];

  constructor(private readonly inner: MockChainAdapter) {}

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    this.calls.push("submitMessage");
    return this.inner.submitMessage(topicId, contents);
  }

  async readMessages(...args: Parameters<ChainAdapter["readMessages"]>) {
    this.calls.push("readMessages");
    return this.inner.readMessages(...args);
  }

  async publishClaim(...args: Parameters<ChainAdapter["publishClaim"]>) {
    this.calls.push("publishClaim");
    return this.inner.publishClaim(...args);
  }

  async lockFunds(params: LockFundsParams): Promise<EscrowRef> {
    this.calls.push("lockFunds");
    return this.inner.lockFunds(params);
  }

  async createSchedule(params: CreateScheduleParams): Promise<ScheduleRef> {
    this.calls.push("createSchedule");
    return this.inner.createSchedule(params);
  }

  async signSchedule(scheduleId: string) {
    this.calls.push("signSchedule");
    return this.inner.signSchedule(scheduleId);
  }

  async deleteSchedule(scheduleId: string) {
    this.calls.push("deleteSchedule");
    return this.inner.deleteSchedule(scheduleId);
  }

  async getTransaction(transactionId: string) {
    this.calls.push("getTransaction");
    return this.inner.getTransaction(transactionId);
  }
}

function harness(chainNow: number = POSTED_AT) {
  const content = new InMemoryContentStore();
  const chain = new RecordingAdapter(new MockChainAdapter({ now: () => chainNow }));
  return {
    content,
    chain,
    deps: {
      content,
      chain,
      ordersTopicId: "0.0.orders",
      requesterAccountId: "0.0.10376659",
      now: () => POSTED_AT,
      newOrderId: () => "ord_test",
    },
  };
}

describe("packageReviewOrder", () => {
  it("commits to the content by hash and stores the bytes", async () => {
    const { content, deps } = harness();

    const packaged = await packageReviewOrder(request(), deps);

    expect(packaged.envelope.spec_hash).toBe(sha256Hex(new TextEncoder().encode(SPEC)));
    expect(packaged.envelope.artifact_hash_in).toBe(sha256Hex(ARTIFACT));
    expect(content.size).toBe(2);
    expect(await content.get(packaged.envelope.artifact_hash_in)).toEqual(ARTIFACT);
    expect(packaged.specRef).toContain(packaged.envelope.spec_hash);
  });

  it("publishes hashes only, never the content", async () => {
    const { deps } = harness();

    const { body } = await packageReviewOrder(request(), deps);

    // Hard rule 1, as a test rather than a comment.
    expect(body).not.toContain("quarterly");
    expect(body).not.toContain("Revenue");
    expect(body).not.toContain("FAKE report");
  });

  it("converts the price through the money module and keeps it a string", async () => {
    const { deps } = harness();

    const whole = await packageReviewOrder(request({ priceHbar: "200" }), deps);
    const fractional = await packageReviewOrder(request({ priceHbar: "0.1" }), deps);

    expect(whole.envelope.price_tinybars).toBe("20000000000");
    expect(fractional.envelope.price_tinybars).toBe("10000000");
    expect(typeof whole.envelope.price_tinybars).toBe("string");
  });

  it("refuses a review order with nothing to review", async () => {
    const { deps } = harness();

    await expect(
      packageReviewOrder(request({ artifact: new Uint8Array() }), deps),
    ).rejects.toThrow(/needs an artifact/);
  });

  it("refuses a claim timeout that eats the window, before any money moves", async () => {
    const { chain, deps } = harness();

    await expect(
      packageReviewOrder(
        // One hour of window, so a 30-minute claim timeout is over the third
        // that keeps a lazy claimant from holding the funds to the deadline.
        request({ deadline: "2026-09-05T01:00:00Z", claimTimeoutSeconds: 1800 }),
        deps,
      ),
    ).rejects.toThrow(/claim_timeout_seconds/);

    expect(chain.calls).toEqual([]);
  });

  it("refuses a deadline that has already passed", async () => {
    const { deps } = harness();

    await expect(
      packageReviewOrder(request({ deadline: "2026-09-04T00:00:00Z" }), deps),
    ).rejects.toThrow(/not in the future/);
  });
});

describe("postReviewOrder", () => {
  it("locks the funds before it publishes the order", async () => {
    const { chain, deps } = harness();

    await postReviewOrder(request(), deps);

    expect(chain.calls).toEqual(["lockFunds", "submitMessage"]);
  });

  it("creates no schedule at post time, because the payee is unknown", async () => {
    const { chain, deps } = harness();

    await postReviewOrder(request(), deps);

    expect(chain.calls).not.toContain("createSchedule");
  });

  it("threads every transaction id and the consensus timestamp out", async () => {
    const { deps } = harness();

    const posted = await postReviewOrder(request(), deps);

    expect(posted.orderId).toBe("ord_test");
    expect(posted.transactionIds.lockFunds).not.toBe(posted.transactionIds.submitEnvelope);
    expect(posted.transactionIds.lockFunds).toBeTruthy();
    expect(posted.transactionIds.submitEnvelope).toBeTruthy();
    expect(posted.escrowAccountId).toContain("ord_test");
    expect(posted.consensusTimestamp).toMatch(/^\d+\.\d{9}$/);
    expect(posted.sequenceNumber).toBe(1);
  });

  it("carries both ids out when the network's clock invalidates the envelope", async () => {
    // Our clock says there are nine days of window. The network's says there
    // are one hundred seconds, which no claim timeout fits inside.
    const { deps } = harness(Date.parse("2026-09-13T23:58:20Z"));

    await expect(postReviewOrder(request(), deps)).rejects.toThrow(
      /was published but its claim timeout does not fit.*lockFunds MOCK-tx-\d+.*submitEnvelope MOCK-tx-\d+/s,
    );
  });
});

describe("consensusEpochSeconds", () => {
  it("truncates rather than rounding the nanoseconds into the second", () => {
    expect(consensusEpochSeconds("1757000000.999999999")).toBe(1757000000);
  });

  it("rejects anything that is not seconds.nanoseconds", () => {
    expect(() => consensusEpochSeconds("MOCK-tx-1")).toThrow(/seconds.nanoseconds/);
  });
});

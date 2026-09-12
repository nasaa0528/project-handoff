/**
 * The double-payment guard, on the real adapter.
 *
 * `PendingPayoutStore` is in-memory, so every restart is a clean slate that
 * remembers no payout it has ever made. The invariant that survives that is
 * not in this process — it is the payout memo on the mirror node. These tests
 * cover the path that reads it, and they are the reason a settle endpoint can
 * be retried at all.
 *
 * No network: `findPayout` goes through `fetch`, which is stubbed, and the
 * co-signed transfer is never reached on the paths under test. The keys are
 * generated locally and sign nothing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountId, type Client, PrivateKey } from "@hiero-ledger/sdk";
import { HederaChainAdapter } from "./hedera-adapter.js";
import { PAYOUT_MEMO_PREFIX } from "./payout-memo.js";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const ESCROW = "0.0.100";
const PAYEE = "0.0.200";
const AMOUNT = "500000000";

const PARAMS = {
  orderId: "ord_abc",
  escrowAccountId: ESCROW,
  payeeAccountId: PAYEE,
  amountTinybars: AMOUNT,
  expiresAt: "2099-01-01T00:00:00Z",
};

/**
 * A client that fails loudly if anything tries to use it.
 *
 * The point of every test here is that no transfer is composed, so a client
 * that would throw on contact is a stronger assertion than a spy.
 */
const UNUSABLE_CLIENT = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`the payout touched the network: client.${String(property)}`);
    },
  },
) as Client;

function adapter(): HederaChainAdapter {
  return new HederaChainAdapter({
    client: UNUSABLE_CLIENT,
    mirrorNodeUrl: MIRROR,
    escrowAccountId: AccountId.fromString(ESCROW),
    verifierKey: PrivateKey.generateED25519(),
    scheduleAdminKey: PrivateKey.generateED25519(),
  });
}

function stubMirror(transactions: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ transactions }), { status: 200 })),
  );
}

function paidRow(orderId: string) {
  return {
    transaction_id: "0.0.999-1789035890-122059080",
    consensus_timestamp: "1789035890.122059080",
    result: "SUCCESS",
    memo_base64: Buffer.from(`${PAYOUT_MEMO_PREFIX}${orderId}`, "utf8").toString("base64"),
    transfers: [
      { account: ESCROW, amount: -Number(AMOUNT) },
      { account: PAYEE, amount: Number(AMOUNT) },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signSchedule across a restart", () => {
  it("does not pay again for an order the escrow has already paid", async () => {
    // A fresh adapter is a restarted process: it has no memory of the payout
    // the mirror node is about to report.
    const chain = adapter();
    stubMirror([paidRow(PARAMS.orderId)]);

    const schedule = await chain.createSchedule(PARAMS);
    // alreadyExisted is false — this process has genuinely never seen it. That
    // is exactly the state in which a naive retry pays twice.
    expect(schedule.alreadyExisted).toBe(false);

    const signed = await chain.signSchedule(schedule.scheduleId);

    // Reported as executed, with the ORIGINAL payout's id, in SDK shape. No
    // transfer was composed — UNUSABLE_CLIENT would have thrown.
    expect(signed.executed).toBe(true);
    expect(signed.transactionId).toBe("0.0.999@1789035890.122059080");
  });

  it("asks the mirror node before composing a signature, not after", async () => {
    const chain = adapter();
    stubMirror([paidRow(PARAMS.orderId)]);

    const schedule = await chain.createSchedule(PARAMS);
    await chain.signSchedule(schedule.scheduleId);

    // If the order were reversed, the irreversible half would run first and
    // the check would be a report rather than a guard.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not treat another order's payout as this one's", async () => {
    const chain = adapter();
    stubMirror([paidRow("ord_somebody_else")]);

    const schedule = await chain.createSchedule(PARAMS);

    // Nothing on the mirror matches, so it proceeds to pay — and the unusable
    // client proves that is what it tried to do.
    await expect(chain.signSchedule(schedule.scheduleId)).rejects.toThrow(/touched the network/);
  });

  it("refuses to pay when the mirror node cannot answer", async () => {
    const chain = adapter();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const schedule = await chain.createSchedule(PARAMS);

    // A read failure read as "not paid yet" is a read failure that pays twice.
    await expect(chain.signSchedule(schedule.scheduleId)).rejects.toThrow(/500/);
  });

  it("short-circuits on its own record without a mirror read", async () => {
    const chain = adapter();
    stubMirror([]);

    const schedule = await chain.createSchedule(PARAMS);
    // Force the in-process executed state the way a completed payout would.
    stubMirror([paidRow(PARAMS.orderId)]);
    await chain.signSchedule(schedule.scheduleId);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("the mirror node was consulted again"); }));
    const again = await chain.signSchedule(schedule.scheduleId);

    expect(again.executed).toBe(true);
    expect(again.transactionId).toBe("0.0.999@1789035890.122059080");
  });

  it("refuses to sign a cancelled payout", async () => {
    const chain = adapter();
    stubMirror([]);

    const schedule = await chain.createSchedule(PARAMS);
    await chain.deleteSchedule(schedule.scheduleId);

    await expect(chain.signSchedule(schedule.scheduleId)).rejects.toThrow(/cancelled/);
  });
});

describe("two settles at once, in one process", () => {
  it("coalesces concurrent signSchedule calls instead of paying twice", async () => {
    const chain = adapter();
    // Nothing on the mirror: neither caller can see a payout, because neither
    // has submitted one yet. This is the window a per-call mirror check cannot
    // close on its own.
    stubMirror([]);

    const schedule = await chain.createSchedule(PARAMS);
    const [first, second] = await Promise.allSettled([
      chain.signSchedule(schedule.scheduleId),
      chain.signSchedule(schedule.scheduleId),
    ]);

    // One mirror read, so only one call ever got as far as deciding to pay.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    // Both callers get the same outcome — here a refusal, because the unusable
    // client proves a transfer was attempted exactly once.
    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect((first as PromiseRejectedResult).reason).toBe(
      (second as PromiseRejectedResult).reason,
    );
  });

  it("lets the next caller try again after an in-flight payout fails", async () => {
    const chain = adapter();
    stubMirror([]);
    const schedule = await chain.createSchedule(PARAMS);
    await expect(chain.signSchedule(schedule.scheduleId)).rejects.toThrow();

    // The failed payout may or may not have landed, so the next caller has to
    // reach the mirror node rather than be handed the old rejection forever.
    stubMirror([paidRow(PARAMS.orderId)]);
    const retried = await chain.signSchedule(schedule.scheduleId);

    expect(retried.transactionId).toBe("0.0.999@1789035890.122059080");
  });
});

describe("a sighting that credited somebody else", () => {
  it("refuses rather than reporting the order settled", async () => {
    const chain = adapter();
    // The memo names this order and the money went somewhere else. Nobody
    // here can explain that, and the wrong answer is to call it settled.
    stubMirror([
      {
        ...paidRow(PARAMS.orderId),
        transfers: [
          { account: ESCROW, amount: -Number(AMOUNT) },
          { account: "0.0.999999", amount: Number(AMOUNT) },
        ],
      },
    ]);

    const schedule = await chain.createSchedule(PARAMS);

    await expect(chain.signSchedule(schedule.scheduleId)).rejects.toThrow(/credited 0\.0\.999999/);
  });

  it("accepts a sighting whose payee cannot be named, because the fee nets the leg out", async () => {
    const chain = adapter();
    stubMirror([
      {
        ...paidRow(PARAMS.orderId),
        transfers: [
          { account: ESCROW, amount: -Number(AMOUNT) },
          // The payee also paid the transaction fee, so their credit no longer
          // equals the escrow's debit. Observed on testnet 2026-09-12.
          { account: PAYEE, amount: Number(AMOUNT) - 113_000 },
        ],
      },
    ]);

    const schedule = await chain.createSchedule(PARAMS);
    const signed = await chain.signSchedule(schedule.scheduleId);

    // The memo is the binding. An unnameable payee is not a wrong payee, and
    // refusing here would refuse a correct payout.
    expect(signed.transactionId).toBe("0.0.999@1789035890.122059080");
  });
});

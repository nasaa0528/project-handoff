import { afterEach, describe, expect, it, vi } from "vitest";
import { FUND_LOCK_MEMO_MAX_BYTES } from "@handoff/schema";
import { findPayout } from "./payout-lookup.js";
import { PayoutMemoError, PAYOUT_MEMO_PREFIX, orderIdFromPayoutMemo, payoutMemoFor } from "./payout-memo.js";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const ESCROW = "0.0.100";
const PAYEE = "0.0.200";

function memo64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

/** One mirror row shaped like the REST API's, fee legs included. */
function payoutRow(orderId: string, amount: number) {
  return {
    transaction_id: "0.0.999-1789035890-122059080",
    consensus_timestamp: "1789035890.122059080",
    result: "SUCCESS",
    memo_base64: memo64(`${PAYOUT_MEMO_PREFIX}${orderId}`),
    transfers: [
      { account: ESCROW, amount: -amount },
      { account: PAYEE, amount },
      { account: "0.0.9", amount: -113000 },
      { account: "0.0.98", amount: 113000 },
    ],
  };
}

function stubMirror(transactions: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ transactions }), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("payoutMemoFor", () => {
  it("prefixes the order id, so a payout is distinguishable from the fund lock that memoes the bare id", () => {
    expect(payoutMemoFor("ord_abc")).toBe("handoff-payout:ord_abc");
    expect(orderIdFromPayoutMemo(payoutMemoFor("ord_abc"))).toBe("ord_abc");
  });

  it("is not fooled by the fund lock's bare order id", () => {
    expect(orderIdFromPayoutMemo("ord_abc")).toBeNull();
  });

  it("refuses an order id whose memo would not fit, before anything is signed", () => {
    const tooLong = "o".repeat(FUND_LOCK_MEMO_MAX_BYTES);
    expect(() => payoutMemoFor(tooLong)).toThrow(PayoutMemoError);
  });

  it("counts bytes, not UTF-16 units", () => {
    // 30 four-byte characters is 120 bytes of order id alone.
    expect(() => payoutMemoFor("𝒜".repeat(30))).toThrow(PayoutMemoError);
  });
});

describe("findPayout", () => {
  it("finds the escrow debit memoed for this order and reports it in SDK id shape", async () => {
    stubMirror([payoutRow("ord_abc", 500_000_000)]);

    const found = await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" });

    expect(found).not.toBeNull();
    // Mirror shape in, SDK shape out — a mirror-shaped id throws in hashscanTransactionUrl.
    expect(found?.transactionId).toBe("0.0.999@1789035890.122059080");
    expect(found?.payeeAccountId).toBe(PAYEE);
    expect(found?.amountTinybars).toBe("500000000");
  });

  it("returns null for a different order, so its payout is not mistaken for this one's", async () => {
    stubMirror([payoutRow("ord_other", 500_000_000)]);

    expect(await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" })).toBeNull();
  });

  it("returns null when the escrow has never paid out", async () => {
    stubMirror([]);

    expect(await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" })).toBeNull();
  });

  it("queries only this escrow's successful CRYPTOTRANSFER debits, newest first", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transactions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" });

    const [firstCall] = fetchMock.mock.calls;
    const url = new URL(String((firstCall as unknown as [string])[0]));
    expect(url.pathname).toBe("/api/v1/transactions");
    expect(url.searchParams.get("account.id")).toBe(ESCROW);
    expect(url.searchParams.get("transactiontype")).toBe("CRYPTOTRANSFER");
    expect(url.searchParams.get("result")).toBe("success");
    expect(url.searchParams.get("type")).toBe("debit");
    expect(url.searchParams.get("order")).toBe("desc");
  });

  it("ignores a row memoed for this order that does not debit the escrow", async () => {
    stubMirror([
      {
        ...payoutRow("ord_abc", 500_000_000),
        transfers: [
          { account: "0.0.777", amount: -500_000_000 },
          { account: PAYEE, amount: 500_000_000 },
        ],
      },
    ]);

    expect(await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" })).toBeNull();
  });

  it("reports the payout with no payee when a fee leg makes the credit ambiguous", async () => {
    stubMirror([
      {
        ...payoutRow("ord_abc", 113_000),
        transfers: [
          { account: ESCROW, amount: -113_000 },
          { account: PAYEE, amount: 113_000 },
          { account: "0.0.98", amount: 113_000 },
        ],
      },
    ]);

    const found = await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" });

    // Still a payout — the memo is the binding. The payee is what cannot be proven.
    expect(found?.payeeAccountId).toBeNull();
    expect(found?.amountTinybars).toBe("113000");
  });

  it("raises rather than reporting 'not paid' when the mirror node is unhappy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    // A read failure that answered "no payout found" would be a read failure that pays twice.
    await expect(findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" })).rejects.toThrow(/500/);
  });
});

describe("tinybars off the mirror node", () => {
  it("keeps a tinybar figure past 2^53 exact, which a plain JSON.parse would round", async () => {
    // 4 billion HBAR. Under the 50-billion max supply and three orders of
    // magnitude past Number.MAX_SAFE_INTEGER, so a plain parse loses the tail.
    const huge = "400000000000000001";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `{"transactions":[{"transaction_id":"0.0.999-1789035890-122059080",` +
              `"consensus_timestamp":"1789035890.122059080","result":"SUCCESS",` +
              `"memo_base64":"${memo64(`${PAYOUT_MEMO_PREFIX}ord_abc`)}",` +
              `"transfers":[{"account":"${ESCROW}","amount":-${huge}},` +
              `{"account":"${PAYEE}","amount":${huge}}]}]}`,
            { status: 200 },
          ),
      ),
    );

    const found = await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" });

    expect(found?.amountTinybars).toBe(huge);
    expect(String(JSON.parse(`{"a":${huge}}`).a)).not.toBe(huge);
    // And the payee is still identifiable, which a rounded pair of legs would
    // also survive — but only by accident.
    expect(found?.payeeAccountId).toBe(PAYEE);
  });

  it("skips a leg whose amount is not a tinybar figure rather than failing the check", async () => {
    stubMirror([
      {
        ...payoutRow("ord_abc", 500_000_000),
        transfers: [
          { account: "0.0.junk", amount: "not-a-number" },
          { account: ESCROW, amount: -500_000_000 },
          { account: PAYEE, amount: 500_000_000 },
        ],
      },
    ]);

    // A malformed row is somebody else's transaction, not a reason to fail a
    // check that stands between a retry and a double payment.
    const found = await findPayout(MIRROR, { escrowAccountId: ESCROW, orderId: "ord_abc" });

    expect(found?.payeeAccountId).toBe(PAYEE);
  });
});

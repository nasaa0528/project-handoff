import { describe, expect, it } from "vitest";
import { decodeSettled, settleOrder, SettleRefused } from "./settle";

const PAYOUT = "0.0.10376667@1789200311.136173331";
const OK = { orderId: "ord_1", state: "SETTLED", payoutTransactionId: PAYOUT, payeeAccountId: "0.0.12345", amountTinybars: "10000000000" };

function answering(...answers: Array<{ status: number; body?: unknown } | Error>) {
  const seen: Array<{ url: string; method: string | undefined }> = [];
  let i = 0;
  const fetchImpl: typeof fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, method: init?.method });
    const next = answers[Math.min(i, answers.length - 1)];
    i += 1;
    if (next === undefined) throw new Error("the test gave no answers");
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

/** No real time passes: the clock advances by the interval on every sleep. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("reading the 200", () => {
  it("takes the payout id and the two facts beside it", () => {
    expect(decodeSettled(OK)).toEqual({ payoutTransactionId: PAYOUT, payeeAccountId: "0.0.12345", amountTinybars: "10000000000" });
  });
  it("refuses a body with no payout, because there would be nothing to read on the mirror", () => {
    expect(decodeSettled({ orderId: "ord_1", state: "SETTLED" })).toBeNull();
    expect(decodeSettled(null)).toBeNull();
  });
});

describe("settleOrder", () => {
  it("posts the order id and nothing else, and returns the payout", async () => {
    const { fetchImpl, seen } = answering({ status: 200, body: OK });
    const settled = await settleOrder({ apiUrl: "https://api.example/", orderId: "ord 1", fetchImpl }, clock());
    expect(settled.payoutTransactionId).toBe(PAYOUT);
    expect(seen).toEqual([{ url: "https://api.example/orders/ord%201/settle", method: "POST" }]);
  });

  it("waits out a not-ready that is retryable, which is the mirror's normal lag", async () => {
    const { fetchImpl, seen } = answering(
      { status: 409, body: { error: "not ready to settle", message: "no attestation yet", retryable: true, state: "CLAIMED" } },
      { status: 409, body: { error: "not ready to settle", message: "no attestation yet", retryable: true, state: "CLAIMED" } },
      { status: 200, body: OK },
    );
    const settled = await settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, clock());
    expect(settled.payoutTransactionId).toBe(PAYOUT);
    expect(seen).toHaveLength(3);
  });

  it("treats an unreachable service as not yet, not as a verdict", async () => {
    const { fetchImpl } = answering(new TypeError("Failed to fetch"), { status: 200, body: OK });
    await expect(settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, clock())).resolves.toMatchObject({
      payoutTransactionId: PAYOUT,
    });
  });

  it("stops on a violation, says so, and never calls again", async () => {
    const { fetchImpl, seen } = answering({ status: 409, body: { error: "schema violation", message: "artifact hash is not the one the order named", retryable: false } });
    const failure = await settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, clock()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SettleRefused);
    expect(failure).toMatchObject({ violation: true, retryable: false, message: "artifact hash is not the one the order named" });
    expect(seen).toHaveLength(1);
  });

  it("stops on a not-ready that cannot change, such as an order past its deadline with nobody holding it", async () => {
    const { fetchImpl, seen } = answering({ status: 409, body: { error: "not ready to settle", message: "the order expired unclaimed", retryable: false, state: "TIMEOUT" } });
    const failure = await settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, clock()).catch((e: unknown) => e);
    expect(failure).toMatchObject({ violation: false, retryable: false, message: "the order expired unclaimed" });
    expect(seen).toHaveLength(1);
  });

  it("passes a 502's detail through whole, because it may name a payout whose outcome is unknown", async () => {
    const { fetchImpl } = answering({ status: 502, body: { error: "the payout did not complete", detail: `submitted ${PAYOUT}, receipt unknown` } });
    const failure = await settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, clock()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SettleRefused);
    expect((failure as Error).message).toContain(PAYOUT);
  });

  it("gives up after the watcher's minute, saying the verdict stands", async () => {
    const { fetchImpl, seen } = answering({ status: 409, body: { error: "not ready to settle", message: "no attestation yet", retryable: true } });
    const failure = await settleOrder({ apiUrl: "https://api.example", orderId: "ord_1", fetchImpl }, { ...clock(), intervalMs: 3_000, giveUpAfterMs: 60_000 }).catch((e: unknown) => e);
    expect(failure).toMatchObject({ retryable: true, violation: false });
    expect((failure as Error).message).toContain("the verdict stands");
    expect(seen.length).toBe(21);
  });
});

import { describe, expect, it } from "vitest";
import type { TransactionRecord } from "@handoff/schema";
import {
  abortableSleep,
  initialSettlementState,
  resumedSettlementState,
  watchSettlement,
  type PayoutLocator,
  type SettlementReader,
  type SettlementState,
} from "./settlement";

const ATT = "0.0.12345@1757000000.000000000";
const PAY = "0.0.777@1757000010.000000000";

const success = (transactionId: string): TransactionRecord => ({
  transactionId,
  status: "SUCCESS",
  consensusTimestamp: "1757000001.000000000",
});
const failed = (transactionId: string): TransactionRecord => ({ ...success(transactionId), status: "FAILED" });

/** Answers per id, in order. The last answer repeats. Unknown ids are never seen. */
function scripted(script: Record<string, readonly (TransactionRecord | null)[]>) {
  const remaining = new Map(Object.entries(script).map(([id, answers]) => [id, [...answers]]));
  const calls: string[] = [];
  const reader: SettlementReader = {
    async getTransaction(transactionId) {
      calls.push(transactionId);
      const answers = remaining.get(transactionId);
      if (answers === undefined || answers.length === 0) return null;
      return (answers.length === 1 ? answers[0] : answers.shift()) ?? null;
    },
  };
  return { reader, calls };
}

/** Null for the first `nulls` asks, then the id. */
function locatorAfter(nulls: number, transactionId: string): PayoutLocator & { calls: number } {
  const locator: PayoutLocator & { calls: number } = {
    calls: 0,
    async locate() {
      locator.calls += 1;
      return locator.calls > nulls ? transactionId : null;
    },
  };
  return locator;
}

/** A clock that only moves when the watcher sleeps. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("watchSettlement", () => {
  it("goes waiting, attested, settled as the mirror node catches up", async () => {
    const { reader, calls } = scripted({ [ATT]: [null, null, success(ATT)], [PAY]: [null, success(PAY)] });
    const payout = locatorAfter(1, PAY);
    const c = clock();
    const phases: string[] = [];

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout, onChange: (s) => phases.push(s.phase) },
      { now: c.now, sleep: c.sleep },
    );

    expect(final.phase).toBe("settled");
    expect(final.attestation?.transactionId).toBe(ATT);
    expect(final.payoutTransactionId).toBe(PAY);
    expect(final.payout?.status).toBe("SUCCESS");
    expect(final.failure).toBeNull();

    expect(phases[0]).toBe("waiting-for-mirror");
    expect(phases.at(-1)).toBe("settled");
    expect(phases.indexOf("attested")).toBeGreaterThan(phases.lastIndexOf("waiting-for-mirror"));

    // Read until seen, never again after that. And the payout id, once
    // located, is kept rather than asked for on every tick.
    expect(calls.filter((id) => id === ATT)).toHaveLength(3);
    expect(payout.calls).toBe(2);
  });

  it("says so when the mirror node is slower than usual, and stops rather than spinning", async () => {
    const { reader, calls } = scripted({ [ATT]: [null] });
    const c = clock();
    const states: SettlementState[] = [];

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout: locatorAfter(0, PAY), onChange: (s) => states.push(s) },
      { now: c.now, sleep: c.sleep, intervalMs: 2_000, slowAfterMs: 20_000, giveUpAfterMs: 90_000 },
    );

    expect(final.phase).toBe("stalled");
    expect(final.attestation).toBeNull();
    expect(final.elapsedMs).toBe(90_000);

    expect(states.filter((s) => s.elapsedMs < 20_000).every((s) => !s.slow)).toBe(true);
    expect(states.find((s) => s.slow)?.elapsedMs).toBe(20_000);

    // One read at t = 0, 2000, ..., 90000.
    expect(calls).toHaveLength(46);
  });

  it("reports a failed attestation transaction as a failure, not as settlement", async () => {
    const { reader } = scripted({ [ATT]: [failed(ATT)] });
    const payout = locatorAfter(0, PAY);

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout },
      { now: () => 0, sleep: async () => {} },
    );

    expect(final.phase).toBe("failed");
    expect(final.failure).toContain("attestation");
    expect(final.failure).toContain("FAILED");
    expect(final.payoutTransactionId).toBeNull();
    expect(payout.calls).toBe(0);
  });

  it("reports a failed payout as a failure", async () => {
    const { reader } = scripted({ [ATT]: [success(ATT)], [PAY]: [failed(PAY)] });

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout: locatorAfter(0, PAY) },
      { now: () => 0, sleep: async () => {} },
    );

    expect(final.phase).toBe("failed");
    expect(final.failure).toContain("payout");
    expect(final.attestation?.status).toBe("SUCCESS");
  });

  it("stops when aborted and hands back the state as it stands", async () => {
    const { reader, calls } = scripted({ [ATT]: [null] });
    const controller = new AbortController();
    const c = clock();
    let emitted = 0;

    const final = await watchSettlement(
      {
        attestationTransactionId: ATT,
        reader,
        payout: locatorAfter(0, PAY),
        signal: controller.signal,
        onChange: () => {
          emitted += 1;
          if (emitted === 3) controller.abort();
        },
      },
      { now: c.now, sleep: c.sleep },
    );

    expect(final.phase).toBe("waiting-for-mirror");
    expect(calls).toHaveLength(2);
  });

  it("starts from a state the screen can render before the first read", () => {
    expect(initialSettlementState(ATT)).toEqual({
      phase: "waiting-for-mirror",
      elapsedMs: 0,
      slow: false,
      attestationTransactionId: ATT,
      attestation: null,
      payoutTransactionId: null,
      payout: null,
      failure: null,
      lastReadError: null,
    });
  });
});

describe("abortableSleep", () => {
  it("resolves early when the signal aborts", async () => {
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await sleeping;
  });

  it("resolves at once for a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await abortableSleep(60_000, controller.signal);
  });
});

describe("watchSettlement under a failing mirror node", () => {
  it("treats a rejected read as not yet, keeps reading, and carries the error", async () => {
    let calls = 0;
    const reader: SettlementReader = {
      async getTransaction(transactionId) {
        calls += 1;
        if (calls === 2) throw new Error("503 from the mirror node");
        return calls >= 3 ? success(transactionId) : null;
      },
    };
    const c = clock();
    const states: SettlementState[] = [];

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout: locatorAfter(0, PAY), onChange: (s) => states.push(s) },
      { now: c.now, sleep: c.sleep },
    );

    expect(final.phase).toBe("settled");
    expect(final.lastReadError).toBeNull();
    const errored = states.find((s) => s.lastReadError !== null);
    expect(errored?.lastReadError).toBe("503 from the mirror node");
    expect(errored?.phase).toBe("waiting-for-mirror");
  });

  it("treats a rejected locate the same way", async () => {
    const { reader } = scripted({ [ATT]: [success(ATT)], [PAY]: [success(PAY)] });
    let asks = 0;
    const payout: PayoutLocator = {
      async locate() {
        asks += 1;
        if (asks === 1) throw new Error("verifier down");
        return PAY;
      },
    };
    const c = clock();

    const final = await watchSettlement({ attestationTransactionId: ATT, reader, payout }, { now: c.now, sleep: c.sleep });

    expect(final.phase).toBe("settled");
    expect(asks).toBe(2);
  });

  it("stalls, never spins, when every read throws", async () => {
    const reader: SettlementReader = {
      async getTransaction() {
        throw new Error("network down");
      },
    };
    const c = clock();

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout: locatorAfter(0, PAY) },
      { now: c.now, sleep: c.sleep, giveUpAfterMs: 10_000 },
    );

    expect(final.phase).toBe("stalled");
    expect(final.lastReadError).toBe("network down");
  });
});

describe("resuming a watch", () => {
  it("keeps a confirmed attestation and a located payout id, and reads only what is unknown", async () => {
    const { reader, calls } = scripted({ [PAY]: [success(PAY)] });
    const payout = locatorAfter(0, PAY);
    const stalled: SettlementState = {
      ...initialSettlementState(ATT),
      phase: "stalled",
      elapsedMs: 90_000,
      slow: true,
      attestation: success(ATT),
      payoutTransactionId: PAY,
    };
    const phases: string[] = [];

    const final = await watchSettlement(
      { attestationTransactionId: ATT, reader, payout, resumeFrom: stalled, onChange: (s) => phases.push(s.phase) },
      { now: () => 0, sleep: async () => {} },
    );

    expect(phases[0]).toBe("attested");
    expect(final.phase).toBe("settled");
    expect(calls).toEqual([PAY]);
    expect(payout.calls).toBe(0);
  });

  it("starts the clock again, so slow and stalled are judged from the retry", () => {
    const resumed = resumedSettlementState({
      ...initialSettlementState(ATT),
      phase: "stalled",
      elapsedMs: 90_000,
      slow: true,
      attestation: success(ATT),
      lastReadError: "network down",
    });
    expect(resumed).toEqual({ ...initialSettlementState(ATT), phase: "attested", attestation: success(ATT) });
  });

  it("does not carry a failed attestation forward", () => {
    const resumed = resumedSettlementState({ ...initialSettlementState(ATT), attestation: failed(ATT), payoutTransactionId: PAY });
    expect(resumed.attestation).toBeNull();
    expect(resumed.payoutTransactionId).toBeNull();
    expect(resumed.phase).toBe("waiting-for-mirror");
  });
});

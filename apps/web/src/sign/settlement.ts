/**
 * Settlement, read from a mirror node and never assumed.
 *
 * After the attestation is published there are two things the screen has to
 * learn, in order: that a mirror node has seen the attestation, and that the
 * scheduled payout to the expert has executed. Both are reads. Neither is
 * inferred from "we sent it".
 *
 * The mirror node lags. Hedera's own tutorial waits six seconds after a submit
 * before querying, so the first few empty reads are the normal case and the
 * screen says so rather than spinning. After `slowAfterMs` the copy changes to
 * "longer than usual", and after `giveUpAfterMs` the watch stops with a state
 * the screen can offer a retry from. There is no infinite spinner here.
 *
 * Losing the mirror node for a while loses nothing. The attestation stands on
 * HCS from the moment consensus assigned it a timestamp, and the platform's
 * payout is an idempotent retry that lands on recovery.
 */

import type { TransactionRecord } from "@handoff/schema";

/** `ChainAdapter` satisfies this structurally. Narrowed so a test can fake one read. */
export interface SettlementReader {
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
}

/**
 * Where the payout transaction id comes from.
 *
 * On Hedera the payout is the scheduled transfer the platform created at claim
 * time, executed once the verifier and the schedule admin have both signed.
 * Its transaction id is the ScheduleCreate's id with the scheduled flag set,
 * and a mirror node exposes the schedule's `executed_timestamp` directly. How
 * the expert app learns the schedule id is the seam with `packages/chain`;
 * this interface is that seam. Before the cutover the mock platform fills it.
 */
export interface PayoutLocator {
  /** Null until the payout exists. */
  locate(): Promise<string | null>;
}

export type SettlementPhase =
  /** Published and accepted by consensus; the mirror node has not shown it yet. */
  | "waiting-for-mirror"
  /** The mirror node shows the attestation. Waiting for the payout. */
  | "attested"
  /** The mirror node shows the payout executed. SETTLED. */
  | "settled"
  /** A transaction the mirror node reports as failed. */
  | "failed"
  /** Polling stopped without an answer. Nothing is lost; a retry is offered. */
  | "stalled";

export interface SettlementState {
  readonly phase: SettlementPhase;
  readonly elapsedMs: number;
  /** Past the point where "usually about six seconds" stops being true. */
  readonly slow: boolean;
  readonly attestationTransactionId: string;
  readonly attestation: TransactionRecord | null;
  readonly payoutTransactionId: string | null;
  readonly payout: TransactionRecord | null;
  readonly failure: string | null;
}

export interface WatchOptions {
  readonly intervalMs: number;
  readonly slowAfterMs: number;
  readonly giveUpAfterMs: number;
  /** Injectable so tests are deterministic. Epoch milliseconds. */
  readonly now: () => number;
  /** Injectable so tests do not wait. Must resolve early when the signal aborts. */
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

/** What Hedera's tutorial waits. Copy, not control: the loop polls sooner. */
export const MIRROR_EXPECTED_LAG_MS = 6_000;

export const DEFAULT_WATCH_OPTIONS: WatchOptions = {
  intervalMs: 2_000,
  slowAfterMs: 20_000,
  giveUpAfterMs: 90_000,
  now: Date.now,
  sleep: abortableSleep,
};

export function abortableSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface WatchParams {
  readonly attestationTransactionId: string;
  readonly reader: SettlementReader;
  readonly payout: PayoutLocator;
  readonly onChange?: (state: SettlementState) => void;
  /** Aborting returns the state as it stands. It is not a failure. */
  readonly signal?: AbortSignal;
}

export function initialSettlementState(attestationTransactionId: string): SettlementState {
  return {
    phase: "waiting-for-mirror",
    elapsedMs: 0,
    slow: false,
    attestationTransactionId,
    attestation: null,
    payoutTransactionId: null,
    payout: null,
    failure: null,
  };
}

export async function watchSettlement(
  params: WatchParams,
  overrides: Partial<WatchOptions> = {},
): Promise<SettlementState> {
  const options: WatchOptions = { ...DEFAULT_WATCH_OPTIONS, ...overrides };
  const started = options.now();
  let state = initialSettlementState(params.attestationTransactionId);
  const emit = (next: SettlementState): SettlementState => {
    state = next;
    params.onChange?.(next);
    return next;
  };

  emit(state);

  for (;;) {
    if (params.signal?.aborted) {
      return state;
    }

    let next: SettlementState = state;

    if (next.attestation === null) {
      const record = await params.reader.getTransaction(next.attestationTransactionId);
      if (record !== null) {
        next =
          record.status === "SUCCESS"
            ? { ...next, attestation: record, phase: "attested" }
            : {
                ...next,
                attestation: record,
                phase: "failed",
                failure: `the mirror node reports the attestation transaction as ${record.status}`,
              };
      }
    }

    if (next.phase === "attested") {
      const payoutId = next.payoutTransactionId ?? (await params.payout.locate());
      next = { ...next, payoutTransactionId: payoutId };

      if (payoutId !== null) {
        const record = await params.reader.getTransaction(payoutId);
        if (record !== null) {
          next =
            record.status === "SUCCESS"
              ? { ...next, payout: record, phase: "settled" }
              : {
                  ...next,
                  payout: record,
                  phase: "failed",
                  failure: `the mirror node reports the payout transaction as ${record.status}`,
                };
        }
      }
    }

    const elapsedMs = options.now() - started;
    next = { ...next, elapsedMs, slow: elapsedMs >= options.slowAfterMs };

    if (next.phase === "settled" || next.phase === "failed") {
      return emit(next);
    }

    if (elapsedMs >= options.giveUpAfterMs) {
      return emit({ ...next, phase: "stalled" });
    }

    emit(next);
    await options.sleep(options.intervalMs, params.signal);
  }
}

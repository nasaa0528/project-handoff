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
 * A read that throws is "not yet", never a verdict. A mirror node answering
 * 503 for a while says nothing about the ledger, so the loop keeps going and
 * carries the error on the state for the screen to mention. Losing the mirror
 * node loses nothing: the attestation stands on HCS from the moment consensus
 * assigned it a timestamp, and the platform's payout is an idempotent retry
 * that lands on recovery.
 */

import type { TransactionRecord } from "@handoff/schema";

/** `ChainAdapter` satisfies this structurally. Narrowed so a test can fake one read. */
export interface SettlementReader {
  getTransaction(transactionId: string): Promise<TransactionRecord | null>;
}

/**
 * Where the payout transaction id comes from.
 *
 * The contract is narrow and load-bearing: `locate` returns the id of the
 * transaction whose SUCCESS means the transfer to the expert fired, or null
 * until that transaction exists. On Hedera that is the scheduled transaction
 * itself, the ScheduleCreate's id with the scheduled flag, in the spelling the
 * adapter's `getTransaction` accepts. It is never the ScheduleCreate's own
 * record and never a ScheduleSign's, both of which read SUCCESS while the
 * escrow is still funded. A mirror node also exposes the schedule's
 * `executed_timestamp` directly, which is the stronger read and the one
 * requested of `packages/chain` for the cutover. Until then the mock fills
 * this seam, and its guard against handing back a non-executing id is the
 * obligation the real implementation inherits.
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
  /** Set only with phase `failed`: what the mirror node said. */
  readonly failure: string | null;
  /** The last tick's read threw. Not a verdict; the loop keeps reading. */
  readonly lastReadError: string | null;
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
  /**
   * Start from what an earlier watch already confirmed. A seen attestation
   * and a located payout id are facts; a retry after a stall keeps them and
   * reads only what is still unknown.
   */
  readonly resumeFrom?: SettlementState;
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
    lastReadError: null,
  };
}

/** The state a retry starts from: confirmed facts kept, the clock reset. */
export function resumedSettlementState(previous: SettlementState): SettlementState {
  const attestation = previous.attestation?.status === "SUCCESS" ? previous.attestation : null;
  return {
    ...initialSettlementState(previous.attestationTransactionId),
    phase: attestation === null ? "waiting-for-mirror" : "attested",
    attestation,
    payoutTransactionId: attestation === null ? null : previous.payoutTransactionId,
  };
}

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

async function attempt<T>(read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function watchSettlement(
  params: WatchParams,
  overrides: Partial<WatchOptions> = {},
): Promise<SettlementState> {
  const options: WatchOptions = { ...DEFAULT_WATCH_OPTIONS, ...overrides };
  const started = options.now();
  let state =
    params.resumeFrom === undefined
      ? initialSettlementState(params.attestationTransactionId)
      : resumedSettlementState(params.resumeFrom);
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
    let readError: string | null = null;

    if (next.attestation === null) {
      const read = await attempt(() => params.reader.getTransaction(next.attestationTransactionId));
      if (!read.ok) {
        readError = read.error;
      } else if (read.value !== null) {
        next =
          read.value.status === "SUCCESS"
            ? { ...next, attestation: read.value, phase: "attested" }
            : {
                ...next,
                attestation: read.value,
                phase: "failed",
                failure: `the mirror node reports the attestation transaction as ${read.value.status}`,
              };
      }
    }

    if (next.phase === "attested") {
      let payoutId = next.payoutTransactionId;
      if (payoutId === null) {
        const located = await attempt(() => params.payout.locate());
        if (located.ok) {
          payoutId = located.value;
        } else {
          readError = located.error;
        }
      }
      next = { ...next, payoutTransactionId: payoutId };

      if (payoutId !== null) {
        const id = payoutId;
        const read = await attempt(() => params.reader.getTransaction(id));
        if (!read.ok) {
          readError = read.error;
        } else if (read.value !== null) {
          next =
            read.value.status === "SUCCESS"
              ? { ...next, payout: read.value, phase: "settled" }
              : {
                  ...next,
                  payout: read.value,
                  phase: "failed",
                  failure: `the mirror node reports the payout transaction as ${read.value.status}`,
                };
        }
      }
    }

    const elapsedMs = options.now() - started;
    next = { ...next, elapsedMs, slow: elapsedMs >= options.slowAfterMs, lastReadError: readError };

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

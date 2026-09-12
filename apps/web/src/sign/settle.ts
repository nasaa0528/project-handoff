/**
 * Asking the platform to release the escrow, after the attestation stands.
 *
 * `POST {api}/orders/{id}/settle` takes the order id and nothing else: who
 * claimed, what they signed and what it is worth all come off the public
 * topics, so a caller can trigger the payout but cannot change what it pays
 * or to whom (docs/decisions/2026-09-12-settle-is-an-explicit-endpoint-and-
 * idempotency-lives-on-the-mirror.md). Nothing here is money math and nothing
 * here is a key; it is one request and the reading of three answers.
 *
 * The three answers, and what each means for the screen:
 * - 200: the payout's transaction id. Rendered, then read on the mirror
 *   like everything else — the id is a claim until a mirror node shows it.
 * - 409 `retryable`: the mirror has not caught up with the attestation yet,
 *   which is the normal case for a caller who calls the instant they
 *   publish. Tried again, with the same patience as the settlement watcher.
 * - 409 not retryable, or a violation: never pays. Said once and stopped.
 * - 502: the chain or the mirror failed mid-payout. The detail may carry a
 *   transaction id whose outcome is unknown, so it is passed through whole.
 *
 * Whatever this returns or throws, the attestation stands. `runSign` routes
 * a throw to the platform-issue line, never to the sign button.
 */

import { abortableSleep } from "./settlement";

export interface SettleParams {
  readonly apiUrl: string;
  readonly orderId: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface SettleOptions {
  readonly intervalMs: number;
  readonly giveUpAfterMs: number;
  readonly now: () => number;
  readonly sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

/** The same patience as the settlement watcher: the mirror lags ~6 s, and after a minute the screen says pending. */
export const DEFAULT_SETTLE_OPTIONS: SettleOptions = {
  intervalMs: 3_000,
  giveUpAfterMs: 60_000,
  now: Date.now,
  sleep: abortableSleep,
};

export interface Settled {
  readonly payoutTransactionId: string;
  readonly payeeAccountId: string | null;
  readonly amountTinybars: string | null;
}

export class SettleRefused extends Error {
  constructor(
    message: string,
    /** True when waiting could have changed the answer and the patience ran out. */
    readonly retryable: boolean,
    /** True for the one non-retryable kind that is a breach rather than a timing. */
    readonly violation: boolean,
  ) {
    super(message);
    this.name = "SettleRefused";
  }
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const found = value[key];
  return typeof found === "string" && found !== "" ? found : null;
}

/** The 200 body. Parsed rather than cast; the id decides what the screen reads next. */
export function decodeSettled(body: unknown): Settled | null {
  if (typeof body !== "object" || body === null) return null;
  const top = body as Record<string, unknown>;
  const payoutTransactionId = stringAt(top, "payoutTransactionId");
  if (payoutTransactionId === null) return null;
  return {
    payoutTransactionId,
    payeeAccountId: stringAt(top, "payeeAccountId"),
    amountTinybars: stringAt(top, "amountTinybars"),
  };
}

type Answer =
  | { readonly kind: "settled"; readonly settled: Settled }
  | { readonly kind: "not-yet"; readonly message: string }
  | { readonly kind: "never"; readonly message: string; readonly violation: boolean };

async function ask(params: SettleParams): Promise<Answer> {
  const fetchImpl = params.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${params.apiUrl.replace(/\/+$/, "")}/orders/${encodeURIComponent(params.orderId)}/settle`;

  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", ...(params.signal === undefined ? {} : { signal: params.signal }) });
  } catch (error) {
    // Unreachable is "not yet": the attestation stands, and a service that
    // is down comes back. The watcher's own clock bounds how long this lasts.
    return { kind: "not-yet", message: `the settle service did not answer: ${error instanceof Error ? error.message : String(error)}` };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A body that is not JSON is read as its status alone.
  }
  const top = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (response.status === 200) {
    const settled = decodeSettled(body);
    return settled === null
      ? { kind: "never", message: "the service said the order settled but did not name the payout transaction", violation: false }
      : { kind: "settled", settled };
  }
  if (response.status === 409) {
    const message = stringAt(top, "message") ?? stringAt(top, "error") ?? "the order is not ready to settle";
    const violation = stringAt(top, "error") === "schema violation";
    const retryable = top["retryable"] === true;
    return retryable && !violation ? { kind: "not-yet", message } : { kind: "never", message, violation };
  }
  if (response.status === 502) {
    // Never flattened: the detail may carry the id of a payout whose outcome is unknown.
    const detail = stringAt(top, "detail") ?? stringAt(top, "error") ?? "the payout did not complete";
    return { kind: "never", message: `the payout did not complete: ${detail}`, violation: false };
  }
  return { kind: "never", message: `the settle service answered ${String(response.status)}`, violation: false };
}

/**
 * Settle, retrying while the service says the mirror has not caught up.
 * Resolves with the payout; throws `SettleRefused` for anything that will
 * not change by waiting, or when the patience runs out.
 */
export async function settleOrder(params: SettleParams, overrides: Partial<SettleOptions> = {}): Promise<Settled> {
  const options: SettleOptions = { ...DEFAULT_SETTLE_OPTIONS, ...overrides };
  const started = options.now();
  let last = "the order is not ready to settle";
  for (;;) {
    const answer = await ask(params);
    if (answer.kind === "settled") return answer.settled;
    if (answer.kind === "never") throw new SettleRefused(answer.message, false, answer.violation);
    last = answer.message;
    if (params.signal?.aborted || options.now() - started >= options.giveUpAfterMs) {
      throw new SettleRefused(`${last} (gave up after ${String(Math.round(options.giveUpAfterMs / 1000))} s; the verdict stands and payment lands on retry)`, true, false);
    }
    await options.sleep(options.intervalMs, params.signal);
  }
}

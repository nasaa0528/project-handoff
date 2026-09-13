/**
 * The sign screen's state, kept out of the components so the sequence reads
 * in one place: sign, then watch settlement, then offer a retry if the mirror
 * node goes quiet. The chain work itself lives in `runSign.ts` and
 * `settlement.ts`, which have no React in them and are tested without it.
 *
 * The state is the order's, not the session's. One hook serves every
 * workspace the expert opens, so it keeps a status per order id: a verdict
 * signed on order A is "signed" for A, and A alone. It was one status for the
 * whole session once, and after the first sign every later claim opened on
 * A's receipt instead of its own form, until a reload forgot it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeError,
  runSign,
  type SignRequest,
  type SignRunDeps,
} from "./runSign";
import type { OrderForSigning, SignedAttestation } from "./sign";
import {
  watchSettlement,
  type PayoutLocator,
  type SettlementReader,
  type SettlementState,
} from "./settlement";

export type { SignRequest } from "./runSign";

export type SignStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "signing" }
  /** Irreversible. Nothing that happens later moves the status back. */
  | { readonly kind: "signed"; readonly signed: SignedAttestation }
  /** Nothing was published. The draft can be corrected and signed again. */
  | { readonly kind: "error"; readonly message: string };

export interface SignFlowDeps extends SignRunDeps {
  /** Mirror reads. The adapter itself, or in mock mode the adapter behind a simulated lag. */
  readonly reader: SettlementReader;
  /** Where the payout's transaction id comes from. Knows the order and when the verdict was published. */
  readonly locatePayout: (order: OrderForSigning, signed: SignedAttestation) => PayoutLocator;
}

/** One order's sign state, as the workspace consumes it. */
export interface SignFlow {
  readonly status: SignStatus;
  readonly settlement: SettlementState | null;
  /** A failure after the publish. The attestation stands; the platform's side did not. */
  readonly platformIssue: string | null;
  readonly sign: (request: SignRequest) => Promise<void>;
  /** After a stall: watch again from what is already confirmed. Nothing is re-signed or re-sent. */
  readonly checkAgain: () => void;
}

/** Every order's sign state, keyed by order id. */
export interface SignFlows {
  /** The flow for one order. Idle for an order nothing has happened to. */
  readonly forOrder: (orderId: string) => SignFlow;
  /** Whether any order is mid-sign. Disconnecting then would strand a publish. */
  readonly anySigning: boolean;
}

interface OrderSignState {
  readonly status: SignStatus;
  readonly settlement: SettlementState | null;
  readonly platformIssue: string | null;
}

const IDLE: OrderSignState = { status: { kind: "idle" }, settlement: null, platformIssue: null };

export function useSignFlow(deps: SignFlowDeps): SignFlows {
  const [states, setStates] = useState<ReadonlyMap<string, OrderSignState>>(new Map());
  const watching = useRef(new Map<string, AbortController>());
  const lastOrder = useRef(new Map<string, OrderForSigning>());

  const patch = useCallback((orderId: string, change: Partial<OrderSignState>) => {
    setStates((current) => new Map(current).set(orderId, { ...(current.get(orderId) ?? IDLE), ...change }));
  }, []);

  const stopWatching = useCallback((orderId: string) => {
    watching.current.get(orderId)?.abort();
    watching.current.delete(orderId);
  }, []);

  useEffect(() => {
    const all = watching.current;
    return () => {
      for (const controller of all.values()) controller.abort();
      all.clear();
    };
  }, []);

  const watch = useCallback(
    (
      order: OrderForSigning,
      signed: SignedAttestation,
      resumeFrom?: SettlementState,
    ) => {
      const orderId = order.envelope.order_id;
      stopWatching(orderId);
      const controller = new AbortController();
      watching.current.set(orderId, controller);

      // The watcher emits its starting state synchronously, so the screen has
      // something to render before the first read.
      watchSettlement({
        attestationTransactionId: signed.transactionId,
        reader: deps.reader,
        payout: deps.locatePayout(order, signed),
        signal: controller.signal,
        ...(resumeFrom === undefined ? {} : { resumeFrom }),
        onChange: (state) => {
          if (!controller.signal.aborted) patch(orderId, { settlement: state });
        },
      }).catch((error: unknown) => {
        // The loop treats a rejected read as "not yet", so this is a bug
        // rather than a mirror-node outage. Stall with the message, which
        // puts the retry on screen instead of a spinner.
        if (controller.signal.aborted) return;
        setStates((current) => {
          const state = current.get(orderId);
          if (state === undefined || state.settlement === null) return current;
          return new Map(current).set(orderId, {
            ...state,
            settlement: { ...state.settlement, phase: "stalled", lastReadError: describeError(error) },
          });
        });
      });
    },
    [deps, patch, stopWatching],
  );

  const sign = useCallback(
    async (request: SignRequest) => {
      const orderId = request.order.envelope.order_id;
      patch(orderId, { status: { kind: "signing" }, platformIssue: null });
      lastOrder.current.set(orderId, request.order);
      await runSign(request, deps, {
        onSigned: (signed) => {
          patch(orderId, { status: { kind: "signed", signed } });
          watch(request.order, signed);
        },
        onPublishFailed: (message) => patch(orderId, { status: { kind: "error", message } }),
        onPlatformIssue: (issue) => patch(orderId, { platformIssue: issue }),
      });
    },
    [deps, patch, watch],
  );

  return useMemo<SignFlows>(
    () => ({
      anySigning: [...states.values()].some((s) => s.status.kind === "signing"),
      forOrder: (orderId) => {
        const state = states.get(orderId) ?? IDLE;
        return {
          ...state,
          sign,
          checkAgain: () => {
            const order = lastOrder.current.get(orderId);
            if (state.status.kind === "signed" && order !== undefined) {
              watch(order, state.status.signed, state.settlement ?? undefined);
            }
          },
        };
      },
    }),
    [states, sign, watch],
  );
}

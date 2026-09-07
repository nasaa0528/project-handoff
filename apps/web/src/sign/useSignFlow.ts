/**
 * The sign screen's state, kept out of the components so the sequence reads
 * in one place: sign, then watch settlement, then offer a retry if the mirror
 * node goes quiet. The chain work itself lives in `runSign.ts` and
 * `settlement.ts`, which have no React in them and are tested without it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, runSign, type SignRequest, type SignRunDeps } from "./runSign";
import type { OrderForSigning, SignedAttestation } from "./sign";
import { watchSettlement, type PayoutLocator, type SettlementReader, type SettlementState } from "./settlement";

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
  readonly locatePayout: (order: OrderForSigning) => PayoutLocator;
}

export interface SignFlow {
  readonly status: SignStatus;
  readonly settlement: SettlementState | null;
  /** A failure after the publish. The attestation stands; the platform's side did not. */
  readonly platformIssue: string | null;
  readonly sign: (request: SignRequest) => Promise<void>;
  /** After a stall: watch again from what is already confirmed. Nothing is re-signed or re-sent. */
  readonly checkAgain: () => void;
}

export function useSignFlow(deps: SignFlowDeps): SignFlow {
  const [status, setStatus] = useState<SignStatus>({ kind: "idle" });
  const [settlement, setSettlement] = useState<SettlementState | null>(null);
  const [platformIssue, setPlatformIssue] = useState<string | null>(null);
  const watching = useRef<AbortController | null>(null);
  const lastOrder = useRef<OrderForSigning | null>(null);

  const stopWatching = useCallback(() => {
    watching.current?.abort();
    watching.current = null;
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const watch = useCallback(
    (order: OrderForSigning, signed: SignedAttestation, resumeFrom?: SettlementState) => {
      stopWatching();
      const controller = new AbortController();
      watching.current = controller;

      // The watcher emits its starting state synchronously, so the screen has
      // something to render before the first read.
      watchSettlement({
        attestationTransactionId: signed.transactionId,
        reader: deps.reader,
        payout: deps.locatePayout(order),
        signal: controller.signal,
        ...(resumeFrom === undefined ? {} : { resumeFrom }),
        onChange: (state) => {
          if (!controller.signal.aborted) setSettlement(state);
        },
      }).catch((error: unknown) => {
        // The loop treats a rejected read as "not yet", so this is a bug
        // rather than a mirror-node outage. Stall with the message, which
        // puts the retry on screen instead of a spinner.
        if (controller.signal.aborted) return;
        setSettlement((current) =>
          current === null ? null : { ...current, phase: "stalled", lastReadError: describeError(error) },
        );
      });
    },
    [deps, stopWatching],
  );

  const sign = useCallback(
    async (request: SignRequest) => {
      setStatus({ kind: "signing" });
      setPlatformIssue(null);
      lastOrder.current = request.order;
      await runSign(request, deps, {
        onSigned: (signed) => {
          setStatus({ kind: "signed", signed });
          watch(request.order, signed);
        },
        onPublishFailed: (message) => setStatus({ kind: "error", message }),
        onPlatformIssue: setPlatformIssue,
      });
    },
    [deps, watch],
  );

  const checkAgain = useCallback(() => {
    if (status.kind === "signed" && lastOrder.current !== null) {
      watch(lastOrder.current, status.signed, settlement ?? undefined);
    }
  }, [status, settlement, watch]);

  return { status, settlement, platformIssue, sign, checkAgain };
}

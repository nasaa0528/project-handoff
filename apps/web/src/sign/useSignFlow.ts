/**
 * The sign screen's state, kept out of the components so the sequence reads
 * in one place: sign, then watch settlement, then offer a retry if the mirror
 * node goes quiet. The chain work itself lives in `sign.ts` and
 * `settlement.ts`, which have no React in them and are tested without it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Verdict } from "@handoff/schema";
import type { WebChain } from "../chain/adapter";
import { signAndPublish, type OrderForSigning, type SignedAttestation } from "./sign";
import {
  initialSettlementState,
  watchSettlement,
  type PayoutLocator,
  type SettlementReader,
  type SettlementState,
} from "./settlement";

export type SignStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "signing" }
  | { readonly kind: "signed"; readonly signed: SignedAttestation }
  | { readonly kind: "error"; readonly message: string };

export interface SignRequest {
  readonly order: OrderForSigning;
  readonly verdict: Verdict;
  readonly defects: readonly string[];
  readonly notes: string;
}

export interface SignFlowDeps {
  readonly chain: WebChain;
  /** Mirror reads. The adapter itself, or in mock mode the adapter behind a simulated lag. */
  readonly reader: SettlementReader;
  readonly locatePayout: (order: OrderForSigning) => PayoutLocator;
  /**
   * Mock mode only: the platform's side, standing in for the verifier that
   * reads the attestation and co-signs the payout. On testnet this is absent.
   * The expert app never triggers a payout; it only reads whether one landed.
   */
  readonly afterPublish?: (order: OrderForSigning, signed: SignedAttestation) => Promise<void>;
}

export interface SignFlow {
  readonly status: SignStatus;
  readonly settlement: SettlementState | null;
  readonly sign: (request: SignRequest) => Promise<void>;
  /** After a stall: start the watch again. Nothing is re-signed or re-sent. */
  readonly checkAgain: () => void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSignFlow(deps: SignFlowDeps): SignFlow {
  const [status, setStatus] = useState<SignStatus>({ kind: "idle" });
  const [settlement, setSettlement] = useState<SettlementState | null>(null);
  const watching = useRef<AbortController | null>(null);
  const lastOrder = useRef<OrderForSigning | null>(null);

  const stopWatching = useCallback(() => {
    watching.current?.abort();
    watching.current = null;
  }, []);

  useEffect(() => stopWatching, [stopWatching]);

  const watch = useCallback(
    (order: OrderForSigning, signed: SignedAttestation) => {
      stopWatching();
      const controller = new AbortController();
      watching.current = controller;
      setSettlement(initialSettlementState(signed.transactionId));

      void watchSettlement({
        attestationTransactionId: signed.transactionId,
        reader: deps.reader,
        payout: deps.locatePayout(order),
        signal: controller.signal,
        onChange: (state) => {
          if (!controller.signal.aborted) setSettlement(state);
        },
      });
    },
    [deps, stopWatching],
  );

  const sign = useCallback(
    async (request: SignRequest) => {
      setStatus({ kind: "signing" });
      lastOrder.current = request.order;
      try {
        const signed = await signAndPublish(request, {
          chain: deps.chain.chain,
          content: deps.chain.content,
        });
        setStatus({ kind: "signed", signed });
        watch(request.order, signed);
        await deps.afterPublish?.(request.order, signed);
      } catch (error) {
        setStatus({ kind: "error", message: describe(error) });
      }
    },
    [deps, watch],
  );

  const checkAgain = useCallback(() => {
    if (status.kind === "signed" && lastOrder.current !== null) {
      watch(lastOrder.current, status.signed);
    }
  }, [status, watch]);

  return { status, settlement, sign, checkAgain };
}

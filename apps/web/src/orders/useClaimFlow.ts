/**
 * The claim button's state, kept out of the component: idle, then
 * Confirming, then yours or someone-else, or stalled with a retry. The
 * chain work is in `claim.ts`, which has no React in it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsensusRef } from "@handoff/schema";
import { describeError } from "../sign/runSign";
import { confirmClaim, type ClaimConfirmation } from "./claim";
import type { ExpertOrder } from "./order";
import type { OrderSource } from "./source";

export type ClaimStatus =
  | { readonly kind: "idle" }
  /** Submitted, or being submitted. The button acknowledges; the result waits. */
  | { readonly kind: "confirming"; readonly confirmation: ClaimConfirmation | null }
  | { readonly kind: "decided"; readonly confirmation: ClaimConfirmation }
  /** The submit itself failed. Nothing is on the topic; Claim can be pressed again. */
  | { readonly kind: "error"; readonly message: string };

export interface ClaimFlow {
  readonly status: ClaimStatus;
  readonly claim: (order: ExpertOrder) => Promise<void>;
  /** After a stall: read again. Nothing is re-submitted. */
  readonly checkAgain: () => void;
}

export function useClaimFlow(source: OrderSource, expertAccountId: string): ClaimFlow {
  const [status, setStatus] = useState<ClaimStatus>({ kind: "idle" });
  const watching = useRef<AbortController | null>(null);
  const last = useRef<{ order: ExpertOrder; submitted: ConsensusRef } | null>(null);

  const stop = useCallback(() => {
    watching.current?.abort();
    watching.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const watch = useCallback(
    (order: ExpertOrder, submitted: ConsensusRef) => {
      stop();
      const controller = new AbortController();
      watching.current = controller;
      confirmClaim({
        topicId: order.ordersTopicId,
        order: order.envelope,
        expertAccountId,
        submitted,
        reader: source.reader,
        signal: controller.signal,
        onChange: (confirmation) => {
          if (controller.signal.aborted) return;
          setStatus(
            confirmation.phase === "confirming" ? { kind: "confirming", confirmation } : { kind: "decided", confirmation },
          );
        },
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus((current) =>
          current.kind === "confirming" && current.confirmation !== null
            ? { kind: "decided", confirmation: { ...current.confirmation, phase: "stalled", lastReadError: describeError(error) } }
            : current,
        );
      });
    },
    [expertAccountId, source, stop],
  );

  const claim = useCallback(
    async (order: ExpertOrder) => {
      setStatus({ kind: "confirming", confirmation: null });
      let submitted: ConsensusRef;
      try {
        submitted = await source.claim(order);
      } catch (error) {
        setStatus({ kind: "error", message: describeError(error) });
        return;
      }
      last.current = { order, submitted };
      watch(order, submitted);
    },
    [source, watch],
  );

  const checkAgain = useCallback(() => {
    if (last.current !== null) watch(last.current.order, last.current.submitted);
  }, [watch]);

  return { status, claim, checkAgain };
}

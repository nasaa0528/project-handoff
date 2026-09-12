import { ArrowLeft, CalendarDays, Clock, FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copyable } from "../components/Copyable";
import { HashscanLink } from "../components/HashscanLink";
import { Escrow } from "../components/Money";
import { Mono } from "../components/Mono";
import { ProofRow } from "../components/ProofRow";
import { claimRefusal, claimWindowWords, clockWords } from "../lib/clock";
import type { ClaimState, ExpertOrder } from "../orders/order";
import type { ClaimFlow } from "../orders/useClaimFlow";

/**
 * "Take it, or learn I lost." The same facts as the row, plus what the
 * requester is asking, from the content store. The document is not here:
 * it opens after a confirmed claim, because showing it to a non-claimant
 * would leak access-controlled content.
 *
 * Claim asks once. After the click the status reads Confirming, the same
 * labeled state as payout, then Claimed · yours to review, or Someone else
 * claimed this. The workspace opens only on a confirmed claim. Losing is an
 * ordinary outcome: the button is replaced, nothing reddens.
 */
export function OrderScreen({
  order,
  claim,
  flow,
  now,
  onBack,
  onOpenWorkspace,
}: {
  order: ExpertOrder;
  /** What the mirror said when the inbox was read. */
  claim: ClaimState;
  flow: ClaimFlow;
  now: Date;
  onBack: () => void;
  onOpenWorkspace: () => void;
}) {
  const { envelope } = order;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const refusal = claimRefusal(envelope.deadline, nowSeconds);

  const decided = flow.status.kind === "decided" ? flow.status.confirmation : null;
  const confirmedYours =
    (decided?.phase === "yours" && decided.state?.kind === "yours" ? decided.state : null) ??
    (claim.kind === "yours" ? claim : null);
  const lost = decided?.phase === "someone-else" || (claim.kind === "someone-else" && decided === null);
  const closed = decided === null && claim.kind === "closed";
  const confirming = flow.status.kind === "confirming";
  const stalled = decided?.phase === "stalled";

  return (
    <div className="grid gap-6">
      <Button type="button" variant="ghost" size="sm" className="w-fit text-muted-foreground" onClick={onBack}>
        <ArrowLeft data-icon="inline-start" aria-hidden />
        Inbox
      </Button>

      <section className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-2">
            <h2 className="font-serif text-2xl leading-tight font-bold tracking-tight">{order.title}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3" aria-hidden />
                Open until <span className="text-foreground">{clockWords(envelope.deadline, now)}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {claimWindowWords(envelope.claim_timeout_seconds)}
              </span>
              {order.documentWords !== null && (
                <span className="flex items-center gap-1 tabular-nums">
                  <FileText className="size-3" aria-hidden />
                  {order.documentWords} words
                </span>
              )}
            </div>
          </div>
          <Escrow priceTinybars={envelope.price_tinybars} size="lg" />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Required credential:</span>
          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-[10px] tracking-[0.04em] text-primary uppercase">
            {envelope.cert_tag}
          </Badge>
          <span className="text-muted-foreground">· Paid whatever the verdict is.</span>
        </div>

        <div className="grid gap-2 border-t border-border pt-5">
          <h3 className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">What the requester is asking</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{order.ask}</p>
          <p className="text-xs text-faint">The document opens after you claim.</p>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-faint">Details</summary>
          <dl className="grid gap-x-4 gap-y-1.5 pt-3 sm:grid-cols-[8rem_1fr]">
            <dt className="text-faint">Order</dt>
            <dd>
              <Copyable value={envelope.order_id} className="text-xs" />
            </dd>
            <dt className="text-faint">Escrow account</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Mono className="text-xs">{order.escrowAccountId}</Mono>
              <HashscanLink kind="account" id={order.escrowAccountId} />
            </dd>
            <dt className="text-faint">Record</dt>
            <dd>
              <HashscanLink kind="topic" id={order.ordersTopicId} label="View record" />
            </dd>
          </dl>
        </details>
      </section>

      <section className="grid gap-3" aria-live="polite">
        {flow.status.kind === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Not claimed</AlertTitle>
            <AlertDescription>{flow.status.message}. Nothing was sent; you can try again.</AlertDescription>
          </Alert>
        )}

        {confirmedYours !== null ? (
          <div className="grid gap-3 rounded-xl border border-border bg-card p-6 shadow-xs">
            <p className="font-serif text-lg font-semibold tracking-tight">Claimed · yours to review</p>
            <p className="text-sm text-muted-foreground">
              Sign by <span className="font-semibold text-foreground">{clockWords(confirmedYours.signBy, now)}</span>
            </p>
            <Button type="button" size="lg" className="h-11 w-full rounded-[10px] bg-paid text-[14px] font-bold hover:bg-paid/90" onClick={onOpenWorkspace}>
              Open the document
            </Button>
            <p className="text-xs text-faint">
              Changed your mind? Do nothing — this returns to the inbox at {clockWords(confirmedYours.signBy, now)}.
              Your notes are kept.
            </p>
          </div>
        ) : lost ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm shadow-xs">Someone else claimed this.</p>
        ) : closed ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm shadow-xs">Claim window passed twice · this order is closed.</p>
        ) : confirming ? (
          <div className="grid gap-2 rounded-xl border border-border bg-card p-6 shadow-xs">
            <p className="flex items-center gap-2 font-serif text-lg font-semibold tracking-tight">
              <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
              Confirming
            </p>
            <p className="text-sm text-muted-foreground">Waiting for the network to confirm who was first. A few seconds.</p>
            <ProofRow transactionId={flow.status.confirmation?.claimTransactionId ?? null} reserved />
          </div>
        ) : stalled ? (
          <div className="grid gap-3 rounded-xl border border-border bg-card p-6 shadow-xs">
            <p className="font-serif text-lg font-semibold tracking-tight">Still confirming</p>
            <p className="text-sm text-muted-foreground">
              The network has not answered yet. Your claim was sent and stands; nothing is re-sent.
            </p>
            <Button type="button" variant="outline" className="w-fit rounded-lg" onClick={flow.checkAgain}>
              Check again
            </Button>
          </div>
        ) : refusal !== null ? (
          <p className="rounded-xl border border-border bg-card p-5 text-sm shadow-xs">{refusal}</p>
        ) : (
          <div className="grid gap-2">
            <Button
              type="button"
              size="lg"
              className="h-11 w-full rounded-[10px] text-[14px] font-bold hover:bg-azure-hover"
              onClick={() => {
                void flow.claim(order);
              }}
            >
              Claim
            </Button>
            <p className="text-center text-xs text-faint">
              {claimWindowWords(envelope.claim_timeout_seconds)}, never past {clockWords(envelope.deadline, now)}.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

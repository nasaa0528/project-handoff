import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { MIRROR_EXPECTED_LAG_MS, type SettlementState } from "../sign/settlement";
import type { OrderForSigning, SignedAttestation } from "../sign/sign";
import { HashscanLink } from "./HashscanLink";
import { Mono } from "./Mono";

type StepState = "done" | "active" | "pending" | "failed";

function Node({ state, label, hint }: { state: StepState; label: string; hint: string }) {
  const bar = {
    done: "bg-emerald-600",
    active: "bg-foreground/30",
    pending: "bg-border",
    failed: "bg-destructive",
  }[state];
  const dot = {
    done: "bg-emerald-600 text-white",
    active: "border-2 border-foreground text-foreground",
    pending: "border border-border text-muted-foreground",
    failed: "bg-destructive text-white",
  }[state];
  return (
    <li className="grid gap-2">
      <div className={`h-1 rounded-full ${bar} ${state === "active" ? "animate-pulse" : ""}`} aria-hidden />
      <div className="flex items-center gap-2">
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${dot}`}
          aria-hidden
        >
          {state === "done" ? <Check className="size-3" strokeWidth={3} /> : state === "failed" ? "!" : ""}
        </span>
        <span className={`text-xs font-medium sm:text-sm ${state === "pending" ? "text-muted-foreground" : ""}`}>{label}</span>
      </div>
      <span className="hidden text-xs text-muted-foreground sm:block">{hint}</span>
    </li>
  );
}

function Row({ state, title, children }: { state: StepState; title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className={`text-xs font-medium tracking-wider uppercase ${state === "pending" ? "text-muted-foreground/70" : "text-muted-foreground"}`}>
        {title}
      </span>
      <div className={`grid gap-1 text-sm ${state === "pending" ? "text-muted-foreground/80" : ""}`}>{children}</div>
    </div>
  );
}

function seconds(ms: number): string {
  return `${Math.floor(ms / 1000)} s`;
}

function TransactionLine({ id }: { id: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Mono className="text-xs text-muted-foreground">{id}</Mono>
      <HashscanLink kind="transaction" id={id} />
    </span>
  );
}

function ReadError({ error }: { error: string | null }) {
  if (error === null) return null;
  return <span className="text-xs text-muted-foreground">Last read failed: {error}. Reading again.</span>;
}

/**
 * The three things the screen learns after the sign, in order: consensus
 * accepted the attestation, a mirror node shows it, and the mirror node shows
 * the payout. The first comes back with the submit; the other two are reads,
 * and every word below is gated on what a read actually returned.
 */
export function SettlementStatus({
  mode,
  order,
  expertAccountId,
  signed,
  settlement,
  platformIssue,
  onCheckAgain,
}: {
  mode: ChainMode;
  order: OrderForSigning;
  expertAccountId: string;
  signed: SignedAttestation;
  settlement: SettlementState;
  platformIssue: string | null;
  onCheckAgain: () => void;
}) {
  const expected = Math.round(MIRROR_EXPECTED_LAG_MS / 1000);
  const attestationSeen = settlement.attestation?.status === "SUCCESS";
  const attestationFailed = settlement.attestation !== null && settlement.attestation.status !== "SUCCESS";
  const payoutSeen = settlement.payout?.status === "SUCCESS";
  const payoutFailed = settlement.payout !== null && settlement.payout.status !== "SUCCESS";
  const settled = settlement.phase === "settled";
  const failed = settlement.phase === "failed";
  const stalled = settlement.phase === "stalled";

  const mirrorState: StepState = attestationSeen
    ? "done"
    : attestationFailed
      ? "failed"
      : stalled
        ? "pending"
        : "active";
  const payoutState: StepState = payoutSeen
    ? "done"
    : payoutFailed
      ? "failed"
      : attestationSeen && !stalled
        ? "active"
        : "pending";

  const price = tinybarsToDisplay(parseTinybars(order.envelope.price_tinybars));

  return (
    <section className="rounded-2xl border border-border/60 bg-card shadow-xs">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-5 sm:px-6">
        <h3 className="text-base font-semibold">Settlement</h3>
        <Badge variant={settled ? "default" : failed ? "destructive" : "outline"}>
          {settled ? "SETTLED" : failed ? "FAILED" : "DELIVERED"}
        </Badge>
        {mode === "mock" && (
          <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">
            MOCK
          </Badge>
        )}
        <span className="text-xs text-muted-foreground sm:ml-auto">Read from a mirror node, never assumed.</span>
      </div>

      <ol className="grid grid-cols-3 gap-2 px-5 py-5 sm:px-6" aria-label="Settlement progress">
        <Node state="done" label="Published" hint="From your account" />
        <Node state={mirrorState} label="Mirror node" hint={`Usually about ${expected} seconds`} />
        <Node state={payoutState} label="Settled" hint="Payment released" />
      </ol>

      <div className="grid gap-4 border-t border-border/60 px-5 py-5 sm:px-6">
        <Row state="done" title="Published from your account">
          <span>
            Accepted by consensus at <Mono>{signed.consensusTimestamp}</Mono>, sequence {signed.sequenceNumber}.
          </span>
          <TransactionLine id={signed.transactionId} />
        </Row>

        <Row state={mirrorState} title="Mirror node">
          {attestationSeen && settlement.attestation !== null ? (
            <span>
              Seen at <Mono>{settlement.attestation.consensusTimestamp}</Mono>.
            </span>
          ) : attestationFailed ? (
            <span className="text-destructive">{settlement.failure}</span>
          ) : stalled ? (
            <span>
              No answer in {seconds(settlement.elapsedMs)}. Nothing is lost: the attestation stands on the ledger
              from the moment consensus accepted it.
            </span>
          ) : settlement.slow ? (
            <span>
              Taking longer than usual, {seconds(settlement.elapsedMs)} so far. Still reading. A slow mirror
              changes nothing about what is already on the ledger.
            </span>
          ) : (
            <span>
              Waiting for the mirror node, usually about {expected} seconds.{" "}
              <span className="tabular-nums">{seconds(settlement.elapsedMs)}</span> so far.
            </span>
          )}
          {!attestationSeen && !attestationFailed && <ReadError error={settlement.lastReadError} />}
        </Row>

        <Row state={payoutState} title="Payment">
          {payoutSeen && settlement.payout !== null ? (
            <span>
              {price}, the order value per the envelope, to your account <Mono>{expertAccountId}</Mono>, executed
              at <Mono>{settlement.payout.consensusTimestamp}</Mono>.
            </span>
          ) : payoutFailed ? (
            <span className="text-destructive">{settlement.failure}</span>
          ) : stalled && attestationSeen ? (
            <span>
              No answer about the payout in {seconds(settlement.elapsedMs)}.{" "}
              {settlement.payoutTransactionId === null
                ? "The platform has not released payment yet."
                : "The payout is known but the mirror node has not shown it yet."}{" "}
              Nothing is lost: the attestation stands on the ledger, and the payout is an idempotent retry that
              lands on recovery.
            </span>
          ) : (
            <span>
              The platform verifier and the schedule admin co-sign after validating your attestation. You do not
              do this step, and your key cannot.
              {mode === "mock" ? " In mock mode a stand-in platform does it here." : ""}
            </span>
          )}
          {settlement.payoutTransactionId !== null && <TransactionLine id={settlement.payoutTransactionId} />}
          {attestationSeen && !payoutSeen && !payoutFailed && <ReadError error={settlement.lastReadError} />}
          {platformIssue !== null && (
            <span className="text-amber-700 dark:text-amber-300">
              {mode === "mock" ? "The stand-in platform failed" : "The platform reported a problem"}: {platformIssue}.
              Your attestation stands regardless.
            </span>
          )}
        </Row>

        {stalled && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" variant="outline" className="rounded-xl" onClick={onCheckAgain}>
              Check again
            </Button>
            <span className="text-xs text-muted-foreground">
              Nothing is re-signed or re-sent. What the mirror node already confirmed is kept.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

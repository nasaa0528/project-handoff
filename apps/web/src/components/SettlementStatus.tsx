import type { ReactNode } from "react";
import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChainMode } from "../chain/config";
import { MIRROR_EXPECTED_LAG_MS, type SettlementState } from "../sign/settlement";
import type { OrderForSigning, SignedAttestation } from "../sign/sign";
import { HashscanLink } from "./HashscanLink";
import { Mono } from "./Mono";

type StepState = "done" | "active" | "pending" | "failed";

function Step({ state, title, children }: { state: StepState; title: string; children: ReactNode }) {
  const marker = {
    done: "bg-emerald-600 text-white",
    active: "bg-foreground text-background animate-pulse",
    pending: "border text-muted-foreground",
    failed: "bg-destructive text-white",
  }[state];
  return (
    <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
      <span
        className={`mt-0.5 flex size-6 items-center justify-center rounded-full text-xs font-semibold ${marker}`}
        aria-hidden
      >
        {state === "done" ? "✓" : state === "failed" ? "!" : ""}
      </span>
      <div className="grid gap-1 pb-5">
        <span className={`text-sm font-medium ${state === "pending" ? "text-muted-foreground" : ""}`}>{title}</span>
        <div className="grid gap-1 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function seconds(ms: number): string {
  return `${Math.floor(ms / 1000)} s`;
}

function TransactionLine({ id }: { id: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Mono>{id}</Mono>
      <HashscanLink kind="transaction" id={id} />
    </span>
  );
}

function ReadError({ error }: { error: string | null }) {
  if (error === null) return null;
  return <span className="text-xs">Last read failed: {error}. Reading again.</span>;
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Settlement</CardTitle>
          <Badge variant={settled ? "default" : failed ? "destructive" : "outline"}>
            {settled ? "SETTLED" : failed ? "FAILED" : "DELIVERED"}
          </Badge>
          {mode === "mock" && <Badge variant="destructive">MOCK</Badge>}
        </div>
        <CardDescription>Read from a mirror node, never assumed.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid">
          <Step state="done" title="Signed and published from your account">
            <span>
              Accepted by consensus at <Mono>{signed.consensusTimestamp}</Mono>, sequence {signed.sequenceNumber}.
            </span>
            <TransactionLine id={signed.transactionId} />
          </Step>

          <Step state={mirrorState} title="Visible on the mirror node">
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
                Reading the mirror node, usually about {expected} seconds. {seconds(settlement.elapsedMs)} so far.
              </span>
            )}
            {!attestationSeen && !attestationFailed && <ReadError error={settlement.lastReadError} />}
          </Step>

          <Step state={payoutState} title="Payment released">
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
          </Step>
        </ol>

        {stalled && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={onCheckAgain}>
              Check again
            </Button>
            <span className="text-xs text-muted-foreground">
              Nothing is re-signed or re-sent. What the mirror node already confirmed is kept.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

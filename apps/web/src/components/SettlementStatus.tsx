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

function Step({
  state,
  title,
  children,
}: {
  state: StepState;
  title: string;
  children: ReactNode;
}) {
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

/**
 * The three things the screen learns after the sign, in order: consensus
 * accepted the attestation, a mirror node shows it, and the mirror node shows
 * the payout. The first comes back with the submit; the other two are reads.
 */
export function SettlementStatus({
  mode,
  order,
  expertAccountId,
  signed,
  settlement,
  onCheckAgain,
}: {
  mode: ChainMode;
  order: OrderForSigning;
  expertAccountId: string;
  signed: SignedAttestation;
  settlement: SettlementState;
  onCheckAgain: () => void;
}) {
  const expected = Math.round(MIRROR_EXPECTED_LAG_MS / 1000);
  const attested = settlement.attestation !== null;
  const settled = settlement.phase === "settled";
  const failed = settlement.phase === "failed";
  const stalled = settlement.phase === "stalled";

  const mirrorState: StepState = attested ? "done" : failed ? "failed" : stalled ? "pending" : "active";
  const payoutState: StepState = settled
    ? "done"
    : failed && attested
      ? "failed"
      : attested && !stalled
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
            <span className="flex flex-wrap items-center gap-2">
              <Mono>{signed.transactionId}</Mono>
              <HashscanLink kind="transaction" id={signed.transactionId} />
            </span>
          </Step>

          <Step state={mirrorState} title="Visible on the mirror node">
            {attested && settlement.attestation !== null ? (
              <span>
                Seen at <Mono>{settlement.attestation.consensusTimestamp}</Mono>.
              </span>
            ) : failed ? (
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
          </Step>

          <Step state={payoutState} title="Payment released">
            {settled && settlement.payout !== null ? (
              <>
                <span>
                  {price} to <Mono>{expertAccountId}</Mono> at <Mono>{settlement.payout.consensusTimestamp}</Mono>.
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <Mono>{settlement.payout.transactionId}</Mono>
                  <HashscanLink kind="transaction" id={settlement.payout.transactionId} />
                </span>
              </>
            ) : failed && attested ? (
              <span className="text-destructive">{settlement.failure}</span>
            ) : (
              <span>
                The platform verifier and the schedule admin co-sign after validating your attestation. You do not
                do this step, and your key cannot.
                {mode === "mock" ? " In mock mode a stand-in platform does it here." : ""}
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
              Nothing is re-signed or re-sent. The payout is an idempotent retry on the platform's side.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

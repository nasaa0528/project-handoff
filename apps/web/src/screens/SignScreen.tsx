import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Verdict } from "@handoff/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { AttestationPreviewCard } from "../components/AttestationPreviewCard";
import { DefectsEditor } from "../components/DefectsEditor";
import { HashscanLink } from "../components/HashscanLink";
import { ModeBanner } from "../components/ModeBanner";
import { Mono } from "../components/Mono";
import { NotesEditor } from "../components/NotesEditor";
import { OrderCard } from "../components/OrderCard";
import { SettlementStatus } from "../components/SettlementStatus";
import { Stepper, type StepperStep } from "../components/Stepper";
import { VerdictPicker } from "../components/VerdictPicker";
import { hashNotes } from "../sign/notes";
import { previewAttestation } from "../sign/preview";
import { describeError } from "../sign/runSign";
import type { OrderForSigning } from "../sign/sign";
import type { SignFlow } from "../sign/useSignFlow";

const STEPS: readonly StepperStep[] = [
  { label: "Review order", hint: "What you are signing for" },
  { label: "Verdict", hint: "Defects and notes" },
  { label: "Sign & settle", hint: "From your own account" },
];

function Section({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4" aria-labelledby={`step-${number}`}>
      <h2 id={`step-${number}`} className="flex items-center gap-3 text-base font-semibold tracking-tight">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border/60 bg-card p-5 shadow-xs sm:p-6">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export function SignScreen({
  mode,
  expertAccountId,
  order,
  artifactText,
  flow,
  initialDefectDraft = "",
}: {
  mode: ChainMode;
  expertAccountId: string;
  order: OrderForSigning;
  artifactText: string | null;
  flow: SignFlow;
  /** For tests: a defect code typed but not yet added. */
  initialDefectDraft?: string;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [defects, setDefects] = useState<readonly string[]>([]);
  const [defectDraft, setDefectDraft] = useState(initialDefectDraft);
  const [notes, setNotes] = useState("");
  const [notesHash, setNotesHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);

  // The hash the screen shows is the hash that gets published: same function.
  useEffect(() => {
    let live = true;
    hashNotes(notes).then(
      ({ hash }) => {
        if (!live) return;
        setNotesHash(hash);
        setHashError(null);
      },
      (error: unknown) => {
        if (!live) return;
        setNotesHash(null);
        setHashError(describeError(error));
      },
    );
    return () => {
      live = false;
    };
  }, [notes]);

  const preview = useMemo(
    () =>
      verdict === null || notesHash === null
        ? null
        : previewAttestation(order.envelope, { verdict, defects, notesHash }),
    [order, verdict, defects, notesHash],
  );

  const signed = flow.status.kind === "signed";
  const locked = flow.status.kind !== "idle" && flow.status.kind !== "error";

  // Why the button is disabled, in the order the expert would fix things.
  const blockers: string[] = [];
  if (verdict === null) blockers.push("Pick a verdict.");
  if (notes.trim() === "") blockers.push("Write your notes. Only their hash is published, but a review without them is not a review.");
  if (defectDraft.trim() !== "") blockers.push("Add or clear the defect code you typed.");
  if (hashError !== null) blockers.push(hashError);
  if (preview !== null) blockers.push(...preview.problems);

  const ready = !locked && blockers.length === 0 && preview !== null && preview.body !== null;
  const touched = verdict !== null || defects.length > 0 || notes.trim() !== "" || defectDraft.trim() !== "";
  const current = signed || ready ? 3 : touched ? 2 : 1;

  return (
    <div className="min-h-dvh bg-background">
      <ModeBanner mode={mode} />

      <header className="mx-auto flex max-w-2xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">
          Handoff <span className="font-normal text-muted-foreground">expert</span>
        </h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Signing as</span>
          <Mono>{expertAccountId}</Mono>
          <HashscanLink kind="account" id={expertAccountId} />
        </div>
      </header>

      <main className="mx-auto grid max-w-2xl gap-10 px-4 pt-4 pb-40 sm:px-6">
        <Stepper steps={STEPS} current={current} />

        <Section number={1} title="Review the order">
          <OrderCard order={order} artifactText={artifactText} />
        </Section>

        <Section number={2} title="Choose a verdict">
          <VerdictPicker value={verdict} onChange={setVerdict} disabled={locked} />
          <Field title="Defects" hint="Short structured codes. The reasoning goes in the notes.">
            <DefectsEditor
              defects={defects}
              onChange={setDefects}
              draft={defectDraft}
              onDraftChange={setDefectDraft}
              disabled={locked}
            />
          </Field>
          <Field title="Notes" hint="Stored off-chain. Only the hash goes on the ledger.">
            <NotesEditor notes={notes} notesHash={notesHash} onChange={setNotes} disabled={locked} />
          </Field>
          {preview !== null && <AttestationPreviewCard preview={preview} />}
        </Section>

        <Section number={3} title="Sign and confirm settlement">
          {flow.status.kind === "error" && (
            <Alert variant="destructive">
              <AlertTitle>Not published</AlertTitle>
              <AlertDescription>{flow.status.message}</AlertDescription>
            </Alert>
          )}

          {signed && flow.settlement !== null ? (
            <SettlementStatus
              mode={mode}
              order={order}
              expertAccountId={expertAccountId}
              signed={flow.status.signed}
              settlement={flow.settlement}
              platformIssue={flow.platformIssue}
              onCheckAgain={flow.checkAgain}
            />
          ) : (
            <div className="grid gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-sm text-muted-foreground sm:p-6">
              <span>
                Signing publishes the attestation from your account. Settlement then shows here in three steps:
                published, seen by a mirror node, settled.
              </span>
              <span className="text-xs">
                The mirror node usually takes about 6 seconds to show a new message. Payment is released by the
                platform after it validates your attestation; you never touch that step.
              </span>
            </div>
          )}
        </Section>
      </main>

      {!signed && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              {!locked && blockers.length > 0 && (
                // On a phone only the first reason shows; the rest wait their turn.
                <ul className="grid gap-0.5 [&>li:nth-child(n+2)]:hidden sm:[&>li:nth-child(n+2)]:block">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              )}
              <span className="hidden text-[0.6875rem] sm:block">
                Your account signs this HCS message and nothing else. It is never a schedule key.
              </span>
            </div>
            <Button
              type="button"
              size="lg"
              className="h-11 w-full shrink-0 rounded-xl px-6 sm:w-auto"
              disabled={!ready}
              onClick={() => {
                if (ready && verdict !== null) void flow.sign({ order, verdict, defects, notes });
              }}
            >
              {flow.status.kind === "signing" ? "Publishing…" : `Sign and publish from ${expertAccountId}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

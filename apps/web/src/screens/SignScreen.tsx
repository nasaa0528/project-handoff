import { useEffect, useMemo, useState } from "react";
import type { Verdict } from "@handoff/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChainMode } from "../chain/config";
import { AttestationPreviewCard } from "../components/AttestationPreviewCard";
import { DefectsEditor } from "../components/DefectsEditor";
import { HashscanLink } from "../components/HashscanLink";
import { ModeBanner } from "../components/ModeBanner";
import { Mono } from "../components/Mono";
import { NotesEditor } from "../components/NotesEditor";
import { OrderCard } from "../components/OrderCard";
import { SettlementStatus } from "../components/SettlementStatus";
import { VerdictPicker } from "../components/VerdictPicker";
import { hashNotes } from "../sign/notes";
import { previewAttestation } from "../sign/preview";
import { describeError } from "../sign/runSign";
import type { OrderForSigning } from "../sign/sign";
import type { SignFlow } from "../sign/useSignFlow";

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

  const locked = flow.status.kind !== "idle" && flow.status.kind !== "error";

  // Why the button is disabled, in the order the expert would fix things.
  const blockers: string[] = [];
  if (verdict === null) blockers.push("Pick a verdict.");
  if (notes.trim() === "") blockers.push("Write your notes. Only their hash is published, but a review without them is not a review.");
  if (defectDraft.trim() !== "") blockers.push("Add or clear the defect code you typed.");
  if (hashError !== null) blockers.push(hashError);
  if (preview !== null) blockers.push(...preview.problems);

  const ready = !locked && blockers.length === 0 && preview !== null && preview.body !== null;

  return (
    <main className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Handoff <span className="font-normal text-muted-foreground">· expert</span>
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Signing as</span>
            <Mono>{expertAccountId}</Mono>
            <HashscanLink kind="account" id={expertAccountId} />
          </div>
        </div>
        <ModeBanner mode={mode} />
      </header>

      <OrderCard order={order} artifactText={artifactText} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verdict</CardTitle>
        </CardHeader>
        <CardContent>
          <VerdictPicker value={verdict} onChange={setVerdict} disabled={locked} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Defects</CardTitle>
          <CardDescription>Short structured codes. The reasoning goes in the notes.</CardDescription>
        </CardHeader>
        <CardContent>
          <DefectsEditor
            defects={defects}
            onChange={setDefects}
            draft={defectDraft}
            onDraftChange={setDefectDraft}
            disabled={locked}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <NotesEditor notes={notes} notesHash={notesHash} onChange={setNotes} disabled={locked} />
        </CardContent>
      </Card>

      {preview !== null && <AttestationPreviewCard preview={preview} />}

      {flow.status.kind === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Not published</AlertTitle>
          <AlertDescription>{flow.status.message}</AlertDescription>
        </Alert>
      )}

      {flow.status.kind !== "signed" && (
        <div className="grid gap-2">
          <Button
            type="button"
            size="lg"
            disabled={!ready}
            onClick={() => {
              if (ready && verdict !== null) void flow.sign({ order, verdict, defects, notes });
            }}
          >
            {flow.status.kind === "signing"
              ? "Publishing…"
              : `Sign and publish from ${expertAccountId}`}
          </Button>
          {!locked && blockers.length > 0 && (
            <ul className="text-center text-xs text-muted-foreground">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          <p className="text-center text-xs text-muted-foreground">
            Your account signs this HCS message and nothing else. It is never a schedule key.
          </p>
        </div>
      )}

      {flow.status.kind === "signed" && flow.settlement !== null && (
        <SettlementStatus
          mode={mode}
          order={order}
          expertAccountId={expertAccountId}
          signed={flow.status.signed}
          settlement={flow.settlement}
          platformIssue={flow.platformIssue}
          onCheckAgain={flow.checkAgain}
        />
      )}
    </main>
  );
}

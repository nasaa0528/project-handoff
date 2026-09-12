import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";
import { SCHEMA_VERSION, type Verdict } from "@handoff/schema";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../chain/config";
import { Copyable, shortHash } from "../components/Copyable";
import { HashscanLink } from "../components/HashscanLink";
import { IssuesEditor } from "../components/IssuesEditor";
import { Amount } from "../components/Money";
import { Mono } from "../components/Mono";
import { NotesEditor } from "../components/NotesEditor";
import { PublishedStatus } from "../components/PublishedStatus";
import { SignDialog } from "../components/SignDialog";
import type { ExpertIdentity } from "../components/Shell";
import { Skeleton } from "../components/Skeleton";
import { Stepper, type StepperStep } from "../components/Stepper";
import { VERDICT_WORDS, VerdictPicker } from "../components/VerdictPicker";
import { clockWords, isPast } from "../lib/clock";
import { EMPTY_DRAFT, type Draft, type DraftStore } from "../lib/draft";
import type { DeliveredState } from "../orders/delivery";
import { countWords, type ExpertOrder } from "../orders/order";
import { composeNotes, issueCode, issueCodes } from "../sign/defects";
import { hashNotes } from "../sign/notes";
import { previewAttestation } from "../sign/preview";
import { describeError } from "../sign/runSign";
import type { SignFlow } from "../sign/useSignFlow";

/** Ragged line lengths, so the placeholder reads as prose rather than a table. */
const DOCUMENT_SKELETON_LINES = ["w-[92%]", "w-[80%]", "w-[86%]", "w-[68%]", "w-[74%]"] as const;

const STEPS: readonly StepperStep[] = [
  { label: "Notes", hint: "What you found" },
  { label: "Verdict", hint: "One of three" },
  { label: "Sign", hint: "Your name on it" },
];

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>;
}

/**
 * The verdict this expert already published, read back off the topic.
 *
 * Deliberately not `PublishedStatus`. That panel is for the moment of signing
 * and needs the transaction id and a live settlement watch; a mirror read of the
 * topic has neither, and inventing them would put a link on screen that 404s.
 * What is certain is what it says: the verdict, where it is, and that it stands.
 */
function PublishedEarlier({
  mode,
  order,
  delivered,
  onBackToInbox,
}: {
  mode: ChainMode;
  order: ExpertOrder;
  delivered: DeliveredState;
  onBackToInbox: () => void;
}) {
  return (
    <Section title="Your verdict">
      <div className="grid gap-3 rounded-lg border border-paid/20 bg-paid/5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-4 text-paid" aria-hidden />
          <span className="text-sm font-medium text-paid">{VERDICT_WORDS[delivered.verdict]}</span>
          <Badge variant="outline" className="border-paid/20 bg-paid/5 text-paid">
            Published
          </Badge>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          You signed this order and the verdict is on the topic under your account. It cannot be
          changed, and signing again would publish a second message rather than replace this one.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-faint">Record</dt>
          <dd className="m-0 flex flex-wrap items-center gap-2">
            <Mono className="text-[11px]">{`${order.attestationsTopicId} · #${delivered.sequenceNumber}`}</Mono>
            <HashscanLink kind="topic" id={order.attestationsTopicId} label="View" />
          </dd>
          <dt className="text-faint">Signed by</dt>
          <dd className="m-0">
            <Mono className="text-[11px]">{delivered.signedBy}</Mono>
          </dd>
        </dl>
        {mode === "mock" && <p className="text-[11px] text-faint">Mock mode: nothing here is on a real network.</p>}
      </div>
      <button type="button" className="w-fit text-xs text-faint underline-offset-4 hover:underline" onClick={onBackToInbox}>
        Back to the inbox
      </button>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-1 text-xs">
      <span className="text-faint">{label}</span>
      <span className="min-w-0 justify-self-end text-right font-medium">{children}</span>
    </div>
  );
}

/**
 * "Judge this document." The document on the left never disappears; the
 * column on the right holds the whole verdict at once, in the order it is
 * made: verdict, issues, notes, then the summary of exactly what will be
 * published, with the one action at the foot of the column.
 *
 * Nothing is hidden behind a step, but the three-step mark stays at the top
 * and fills in as each part is done, so the remaining stretch still reads as
 * short. No verdict is preselected, and Sign asks once more before it
 * publishes.
 */
export function WorkspaceScreen({
  mode,
  identity,
  order,
  signBy,
  artifactText,
  flow,
  now,
  drafts,
  onBackToInbox,
  delivered = null,
  initialIssueDraft = "",
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  order: ExpertOrder;
  /** From the confirmed claim. Never past the order deadline. */
  signBy: string;
  /** Null while the document is still arriving. */
  artifactText: string | null;
  flow: SignFlow;
  now: Date;
  drafts: DraftStore;
  onBackToInbox: () => void;
  /**
   * The verdict already on the attestations topic, when there is one.
   *
   * A fresh sign is `flow.status`; this is the same fact read back off the
   * network on a later visit, when the component has no memory of publishing it.
   * Without it the screen offered the form again, and the form was used: two
   * attestations for one order on testnet, 2026-09-12, 107 seconds apart.
   */
  delivered?: DeliveredState | null;
  /** For tests: an issue typed but not yet added. */
  initialIssueDraft?: string;
}) {
  const orderId = order.envelope.order_id;
  const [draft, setDraft] = useState<Draft>(() => drafts.load(orderId));
  const [issueDraft, setIssueDraft] = useState(initialIssueDraft);
  const [notesHash, setNotesHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { notes, issues, verdict } = draft;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Published on an earlier visit: the topic says so and this component does
  // not. Kept separate from a sign that happened here, because far less is
  // known about it — a mirror read carries no transaction id — and nothing may
  // invent one.
  const publishedBefore = flow.status.kind !== "signed" && delivered?.yours === true;
  const signed = flow.status.kind === "signed" || publishedBefore;
  const locked = flow.status.kind !== "idle" && flow.status.kind !== "error";

  /** What is stored, hashed and delivered: the writing, then the issues under their codes. */
  const notesPayload = composeNotes(notes, issues);
  const defects = issueCodes(issues);

  // The draft is the order's, not the screen's. Kept until signed.
  useEffect(() => {
    if (signed) drafts.clear(orderId);
    else drafts.save(orderId, draft);
  }, [draft, drafts, orderId, signed]);

  // The fingerprint the screen shows is the fingerprint of the bytes that get
  // published: same function, same composed text.
  useEffect(() => {
    let live = true;
    hashNotes(notesPayload).then(
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
  }, [notesPayload]);

  const preview = useMemo(
    () => (verdict === null || notesHash === null ? null : previewAttestation(order.envelope, { verdict, defects, notesHash })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order, verdict, notesHash, defects.join(",")],
  );

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const documentWords = order.documentWords ?? (artifactText === null ? null : countWords(artifactText));
  const claimExpired = !signed && !locked && isPast(signBy, nowSeconds);

  const blockers: string[] = [];
  if (verdict === null) blockers.push("Pick a verdict.");
  if (notes.trim() === "" && issues.length === 0) blockers.push("Write your notes. They are what the requester paid for.");
  if (issueDraft.trim() !== "") blockers.push("Add or clear the issue you typed.");
  if (preview !== null) blockers.push(...preview.problems);
  if (hashError !== null) blockers.push(hashError);

  const ready = !locked && blockers.length === 0 && verdict !== null && preview !== null && preview.body !== null;

  // The step mark reads as progress, not as a gate: everything is on screen.
  const step = notes.trim() === "" && issues.length === 0 ? 1 : verdict === null ? 2 : 3;
  const statusWords = signed ? "Published" : claimExpired ? "Claim expired" : "In review";

  return (
    <div className="grid lg:h-[calc(100dvh-3.5rem)] lg:grid-rows-[auto_minmax(0,1fr)]">
      {/* The order's own bar: back, title, state, clock, money. The white runs edge to
          edge like the navbar's; the row inside shares the navbar's gutter and cap, so
          Inbox sits under the wordmark. */}
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex h-[52px] max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onBackToInbox}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            Inbox
          </Button>
          <span className="h-5 w-px shrink-0 bg-border" aria-hidden />
          <span className="hidden min-w-0 flex-1 truncate font-serif text-sm font-semibold sm:block">{order.title}</span>
          <span className="flex-1 sm:hidden" />
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant="outline" className={signed ? "border-paid/20 bg-paid/5 text-paid" : "border-urgent/20 bg-urgent/5 text-urgent"}>
              {statusWords}
            </Badge>
            <span className="text-xs font-semibold whitespace-nowrap">
              Sign by <span className="tabular-nums">{clockWords(signBy, now)}</span>
            </span>
            <Amount tinybars={order.envelope.price_tinybars} className="font-mono text-[13px] font-semibold text-paid" />
          </div>
        </div>
      </div>

      {/* Only the panes are inset, on the bar's gutter and cap, so the paper's edge sits
          under the wordmark too. Below lg they stack and carry their own padding, where
          an outer gutter would only double it. */}
      <div className="mx-auto grid w-full max-w-6xl lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden lg:px-6">
        {/* The paper. It stays. */}
        <section className="border-b border-border lg:overflow-y-auto lg:border-r lg:border-b-0">
          <div className="grid gap-6 px-5 py-7 sm:px-10 sm:py-8">
            <div className="grid gap-3">
              <h2 className="font-serif text-[28px] leading-[1.25] font-bold tracking-tight">{order.title}</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{order.ask}</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-faint">
                <span>
                  Credential <span className="font-medium text-muted-foreground">{order.envelope.cert_tag}</span>
                </span>
                <span className="flex items-center gap-1">
                  Order <Copyable value={orderId} display={orderId.length > 16 ? `${orderId.slice(0, 12)}…` : orderId} className="text-[11px]" />
                </span>
                <span className="ml-auto">
                  <HashscanLink kind="topic" id={order.ordersTopicId} label="View record" />
                </span>
              </div>
            </div>

            <div className="grid gap-2.5 border-t border-border pt-6">
              <SectionLabel>Document</SectionLabel>
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <FileText className="size-3.5" aria-hidden />
                    <Badge variant="destructive">FAKE</Badge>
                    demo document, not a real opinion
                  </span>
                  {documentWords !== null && <span className="text-[11px] text-faint tabular-nums">{documentWords} words</span>}
                </div>
                {artifactText === null ? (
                  // The paper, before it has words on it. Same primitive as the
                  // inbox rows, so one wait looks like the other.
                  <div className="grid gap-3 p-8" aria-busy role="status">
                    <span className="sr-only">Fetching the document.</span>
                    {DOCUMENT_SKELETON_LINES.map((width, i) => (
                      <Skeleton key={width} className={`h-3.5 ${width}`} delayMs={i * 110} />
                    ))}
                  </div>
                ) : (
                  <pre className="p-6 font-serif text-sm leading-[1.8] whitespace-pre-wrap sm:p-9">{artifactText}</pre>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* The verdict. All of it, at once. */}
        <aside className="flex flex-col bg-background lg:overflow-y-auto">
          <div className="grid flex-1 content-start gap-6 px-5 pt-6 pb-4 sm:px-6">
            {!signed && !claimExpired && <Stepper steps={STEPS} current={step} />}

            {claimExpired && (
              <div className="grid gap-2 rounded-xl border border-border bg-card p-5 text-sm">
                <p className="font-serif font-semibold">Claim expired · this order is back in the inbox.</p>
                <p className="text-muted-foreground">Your notes are kept — claim it again if nobody else does.</p>
                <Button type="button" variant="outline" className="w-fit rounded-lg" onClick={onBackToInbox}>
                  Back to the inbox
                </Button>
              </div>
            )}

            {signed && flow.status.kind === "signed" && flow.settlement !== null ? (
              <>
                <PublishedStatus
                  mode={mode}
                  order={order}
                  expertAccountId={identity.accountId}
                  signed={flow.status.signed}
                  settlement={flow.settlement}
                  platformIssue={flow.platformIssue}
                  onCheckAgain={flow.checkAgain}
                />
                {flow.settlement.phase === "settled" && (
                  <button type="button" className="w-fit text-xs text-faint underline-offset-4 hover:underline" onClick={onBackToInbox}>
                    Back to the inbox
                  </button>
                )}
              </>
            ) : publishedBefore && delivered !== null ? (
              <PublishedEarlier mode={mode} order={order} delivered={delivered} onBackToInbox={onBackToInbox} />
            ) : (
              !claimExpired && (
                <>
                  {flow.status.kind === "error" && (
                    <Alert variant="destructive">
                      <AlertTitle>Not published</AlertTitle>
                      <AlertDescription>{flow.status.message}</AlertDescription>
                    </Alert>
                  )}

                  <Section title="Your verdict">
                    <VerdictPicker
                      value={verdict}
                      onChange={(v) => update({ verdict: v })}
                      disabled={locked}
                    />
                  </Section>

                  <Section title="Issues">
                    <IssuesEditor
                      issues={issues}
                      onChange={(next) => update({ issues: next })}
                      draft={issueDraft}
                      onDraftChange={setIssueDraft}
                      disabled={locked}
                    />
                  </Section>

                  <Section title="Your notes">
                    <NotesEditor notes={notes} onChange={(n) => update({ notes: n })} disabled={locked} />
                  </Section>

                  <Section title="Summary">
                    <div className="grid gap-0.5 rounded-lg border border-border bg-card p-3.5">
                      <SummaryRow label="Verdict">
                        {verdict === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={verdict === "reject" ? "text-destructive" : verdict === "approve" ? "text-paid" : "text-urgent"}>
                            {VERDICT_WORDS[verdict]}
                          </span>
                        )}
                      </SummaryRow>
                      <SummaryRow label="Issues">
                        {issues.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          <span className="flex flex-wrap justify-end gap-1" aria-label="Issue codes to publish">
                            {issues.map((_, index) => (
                              <span key={index} className="rounded bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-destructive">
                                {issueCode(index)}
                              </span>
                            ))}
                          </span>
                        )}
                      </SummaryRow>
                      <SummaryRow label="Notes fingerprint">
                        {notesHash === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <Copyable value={notesHash} display={shortHash(notesHash)} className="text-[11px]" />
                        )}
                      </SummaryRow>
                      <SummaryRow label="Signed by">
                        <span className="flex flex-wrap items-center justify-end gap-1.5">
                          <Mono className="text-[11px]">{identity.accountId}</Mono>
                          {identity.credentials.map((tag) => (
                            <Badge key={tag} variant="outline" className="border-primary/20 bg-primary/5 text-[10px] text-primary uppercase">
                              {tag}
                            </Badge>
                          ))}
                        </span>
                      </SummaryRow>

                      <details className="group mt-1 border-t border-border pt-1.5">
                        <summary className="cursor-pointer list-none py-1 text-[11px] font-medium text-faint transition-colors hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
                          <span className="group-open:hidden">Show verification details</span>
                          <span className="hidden group-open:inline">Hide verification details</span>
                        </summary>
                        <p className="py-1 text-left text-[11px] text-faint">
                          Public forever, under your account: the verdict and the issue codes. Private, delivered to
                          the requester: your notes, the issue sentences, and the document.
                        </p>
                        <SummaryRow label="Notes">
                          {notesHash === null ? <span className="text-faint">—</span> : <Copyable value={notesHash} className="text-[11px]" />}
                        </SummaryRow>
                        <SummaryRow label="Document">
                          <Copyable value={order.envelope.artifact_hash_in} className="text-[11px]" />
                        </SummaryRow>
                        <p className="py-1 text-left text-[11px] text-faint">
                          This is the exact document the requester committed to. It cannot change after you sign.
                        </p>
                        <SummaryRow label="Format version">
                          <Mono className="text-[11px]">{String(SCHEMA_VERSION)}</Mono>
                        </SummaryRow>
                        <SummaryRow label="Credential">
                          <Mono className="text-[11px]">{order.envelope.cert_tag}</Mono>
                        </SummaryRow>
                        <SummaryRow label="Record">
                          <span className="flex items-center justify-end gap-2">
                            <Mono className="text-[11px]">{order.ordersTopicId}</Mono>
                            <HashscanLink kind="topic" id={order.ordersTopicId} label="View" />
                          </span>
                        </SummaryRow>
                      </details>
                    </div>
                  </Section>
                </>
              )
            )}
          </div>

          {/* The one action, always in reach. */}
          {!signed && !claimExpired && (
            <div className="sticky bottom-0 grid gap-2 border-t border-border bg-background px-5 pt-4 pb-6 sm:px-6">
              <Button
                type="button"
                size="lg"
                className="h-12 w-full rounded-[10px] bg-paid text-[14px] font-bold hover:bg-paid/90"
                disabled={!ready}
                onClick={() => setConfirming(true)}
              >
                Sign verdict
              </Button>
              {blockers.length > 0 && !locked ? (
                <ul className="grid gap-0.5 text-center text-[11px] text-muted-foreground">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center justify-center gap-1 text-center text-[11px] text-faint">
                  <ShieldCheck className="size-3 shrink-0" aria-hidden />
                  Your name is permanently linked to this verdict.
                </p>
              )}
            </div>
          )}

          <SignDialog
            open={confirming && !signed && !claimExpired}
            verdict={verdict}
            issueCount={issues.length}
            accountId={identity.accountId}
            credentials={identity.credentials}
            busy={flow.status.kind === "signing"}
            onBack={() => setConfirming(false)}
            onSign={() => {
              if (ready && verdict !== null) void flow.sign({ order, verdict, defects, notes: notesPayload });
            }}
          />
        </aside>
      </div>
    </div>
  );
}

export { EMPTY_DRAFT };

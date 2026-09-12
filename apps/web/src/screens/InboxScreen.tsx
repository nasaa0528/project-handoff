import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Clock, FileText } from "lucide-react";
import { parseTinybars, utcToEpochSeconds } from "@handoff/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copyable } from "../components/Copyable";
import { HashscanLink } from "../components/HashscanLink";
import { Escrow } from "../components/Money";
import { Mono } from "../components/Mono";
import { Skeleton } from "../components/Skeleton";
import { claimWindowWords, clockWords, isPast } from "../lib/clock";
import { askSummary, type ExpertOrder, type InboxEntry } from "../orders/order";

/** How the open list is ordered. Presentation only; the topic decides everything else. */
export type InboxSort = "expiring" | "newest" | "value";

const SORTS: ReadonlyArray<{ id: InboxSort; label: string }> = [
  { id: "expiring", label: "Expiring soon" },
  { id: "newest", label: "Newest" },
  { id: "value", label: "Highest value" },
];

/** Whether the expert has started on an order they hold. Local drafts only. */
export type ProgressFn = (orderId: string) => "not-started" | "in-review";

/**
 * "Here is paid work I am qualified for." Only work the expert can take:
 * orders claimed by someone else are hidden with a muted count, and orders
 * past their deadline are gone. A reviewer decides on three facts, what it
 * is, how big it is, how long they have, and the row gives all three before
 * Claim. The row expands to the full ask; Claim opens the order, where it is
 * confirmed, because the workspace opens only on a confirmed claim.
 */
export function InboxScreen({
  entries,
  now,
  onOpen,
  onResume,
  onClaim,
  progress,
}: {
  /** Null while the first read is in flight. */
  entries: readonly InboxEntry[] | null;
  now: Date;
  onOpen: (orderId: string) => void;
  /** Resumes an order the expert already holds: straight to the document. */
  onResume?: ((orderId: string) => void) | undefined;
  /** Starts the claim. The dialog above reports it; this screen does not decide. */
  onClaim?: ((order: ExpertOrder) => void) | undefined;
  progress?: ProgressFn | undefined;
}) {
  const [sort, setSort] = useState<InboxSort>("expiring");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (entries === null) return <InboxSkeleton />;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const live = entries.filter((e) => !isPast(e.order.envelope.deadline, nowSeconds));
  const mine = live.filter((e) => e.claim.kind === "yours");
  const open = sorted(live.filter((e) => e.claim.kind === "open"), sort);
  // Orders this expert claimed and lost. Not a queue: the holder's window
  // runs out and the order returns to the inbox for anyone, first come.
  const lost = live.filter((e) => e.claim.kind === "someone-else" && e.claim.youClaimed);
  const others = live.filter((e) => e.claim.kind === "someone-else" && !e.claim.youClaimed).length;

  const rowProps = {
    now,
    onOpen,
    onResume,
    onClaim,
    expanded,
    onToggle: (id: string) => setExpanded((current) => (current === id ? null : id)),
  };

  return (
    <div className="grid gap-7">
      {mine.length > 0 && (
        <section className="grid gap-2.5">
          <SectionLabel>In progress</SectionLabel>
          <List>
            {mine.map((entry) => (
              <Row key={entry.order.envelope.order_id} entry={entry} {...rowProps} progress={progress} />
            ))}
          </List>
        </section>
      )}

      <section className="grid gap-2.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>Open reviews</SectionLabel>
            <p className="mt-1 text-[13px] text-muted-foreground">Reviews matching your credential. Pick one to begin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {open.length > 1 &&
              SORTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={sort === option.id}
                  onClick={() => setSort(option.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    sort === option.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            {others > 0 && (
              <span className="text-xs text-faint">
                {others} claimed by {others === 1 ? "someone else" : "others"}
              </span>
            )}
          </div>
        </div>

        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">No work right now.</p>
        ) : (
          <List>
            {open.map((entry) => (
              <Row key={entry.order.envelope.order_id} entry={entry} {...rowProps} />
            ))}
          </List>
        )}
      </section>

      {lost.length > 0 && (
        <Watching entries={lost} now={now} />
      )}
    </div>
  );
}

/**
 * The first read, in the shape of the list it becomes. The heading and its
 * sentence are true before any order arrives, so they are printed rather
 * than greyed: only the rows are unknown, and only the rows are placeholder.
 * Three of them, because a list of one reads as a result.
 *
 * Rule 3, and rule 9: this is an ordinary wait, so it says so once for a
 * screen reader and otherwise stays quiet. No spinner, no message, no jump
 * when the real rows land — the row below is the same row, measured the same.
 */
function InboxSkeleton() {
  return (
    <div className="grid gap-7" aria-busy role="status">
      <span className="sr-only">Looking for reviews you can take.</span>
      <section className="grid gap-2.5">
        <div>
          <SectionLabel>Open reviews</SectionLabel>
          <p className="mt-1 text-[13px] text-muted-foreground">Reviews matching your credential. Pick one to begin.</p>
        </div>
        <List>
          {[0, 1, 2].map((i) => (
            <RowSkeleton key={i} delayMs={i * 140} />
          ))}
        </List>
      </section>
    </div>
  );
}

/**
 * One row of the inbox before it has a title: the same rail, the same dot,
 * the same three-fact meta line, the same amount and button on the right, at
 * the same height. What lands is this row with words in it, so nothing moves.
 * The rail is `border` rather than the row's azure, because a colour here
 * would claim a state that is not known yet.
 */
function RowSkeleton({ delayMs }: { delayMs: number }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-l-[3px] border-l-border pr-5">
        <div className="flex min-w-0 flex-1 items-start gap-4 py-4 pl-5">
          <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" delayMs={delayMs} />
          {/* Heights are the loaded row's own: the serif title line, then the
              meta line, whose height the credential pill sets. Same sum, so
              the list does not jump when the words arrive. */}
          <div className="grid min-w-0 flex-1 gap-2.5">
            <Skeleton className="h-[18px] w-[min(62%,340px)]" delayMs={delayMs} />
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-3.5 w-28" delayMs={delayMs + 60} />
              <Skeleton className="h-3.5 w-44" delayMs={delayMs + 80} />
              <Skeleton className="h-3.5 w-16" delayMs={delayMs + 100} />
              <Skeleton className="h-[22px] w-28 rounded-full" delayMs={delayMs + 120} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4 py-4">
          <div className="grid justify-items-end gap-1.5">
            <Skeleton className="h-[18px] w-20" delayMs={delayMs + 60} />
            <Skeleton className="h-2.5 w-24" delayMs={delayMs + 90} />
          </div>
          <Skeleton className="h-8 w-[68px] rounded-lg" delayMs={delayMs + 140} />
        </div>
      </div>
    </li>
  );
}

/**
 * What the expert tried for and did not get. The treaty's rule is that a
 * claim which lost stays lost, so this promises no position and no
 * priority: it says when the holder's window runs out, because at that
 * moment the order returns to the inbox and claiming again is first come.
 */
function Watching({ entries, now }: { entries: readonly InboxEntry[]; now: Date }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="grid gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 py-1 text-left text-xs font-semibold tracking-[0.03em] text-faint transition-colors hover:text-muted-foreground"
      >
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
        You claimed and lost
        <span className="font-medium">({entries.length})</span>
        <span className="ml-1 h-px flex-1 bg-border" aria-hidden />
      </button>

      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} inert={!open}>
        <div className="overflow-hidden">
          <List>
            {entries.map(({ order, claim }) => (
              <li key={order.envelope.order_id} className="border-b border-border last:border-b-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-[3px] border-l-urgent px-5 py-4">
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="truncate font-serif text-[15px] font-semibold">{order.title}</span>
                    <span className="text-xs text-muted-foreground">
                      Someone else holds this. It returns to the inbox at{" "}
                      <span className="font-medium text-foreground">
                        {claim.kind === "someone-else" ? clockWords(claim.holderSignBy, now) : ""}
                      </span>{" "}
                      if they do not deliver, and claiming it then is first come.
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <Escrow priceTinybars={order.envelope.price_tinybars} />
                    <span className="text-xs text-faint italic">No place is held</span>
                  </span>
                </div>
              </li>
            ))}
          </List>
        </div>
      </div>
    </section>
  );
}

/** Presentation order. Amounts compare as bigint; nothing here is a float. */
function sorted(entries: readonly InboxEntry[], sort: InboxSort): readonly InboxEntry[] {
  const copy = [...entries];
  switch (sort) {
    case "expiring":
      return copy.sort((a, b) => utcToEpochSeconds(a.order.envelope.deadline) - utcToEpochSeconds(b.order.envelope.deadline));
    case "newest":
      return copy.sort((a, b) => utcToEpochSeconds(b.order.envelope.deadline) - utcToEpochSeconds(a.order.envelope.deadline));
    case "value":
      return copy.sort((a, b) => {
        const left = parseTinybars(a.order.envelope.price_tinybars);
        const right = parseTinybars(b.order.envelope.price_tinybars);
        return left === right ? 0 : right > left ? 1 : -1;
      });
  }
}

function SectionLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold tracking-[0.06em] text-faint uppercase">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">{children}</ul>;
}

/**
 * How close the deadline is, as a tint on the time. The text stays a time;
 * only its colour hurries.
 */
function urgency(deadline: string, now: Date): string {
  const left = utcToEpochSeconds(deadline) - Math.floor(now.getTime() / 1000);
  if (left <= 2 * 3600) return "font-semibold text-destructive";
  if (left <= 8 * 3600) return "text-urgent";
  return "text-paid";
}

function Row({
  entry,
  now,
  onOpen,
  onResume,
  onClaim,
  expanded,
  onToggle,
  progress,
}: {
  entry: InboxEntry;
  now: Date;
  onOpen: (orderId: string) => void;
  onResume?: ((orderId: string) => void) | undefined;
  onClaim?: ((order: ExpertOrder) => void) | undefined;
  expanded: string | null;
  onToggle: (orderId: string) => void;
  progress?: ProgressFn | undefined;
}) {
  const { order, claim } = entry;
  const { envelope } = order;
  const id = envelope.order_id;
  const yours = claim.kind === "yours";
  const open = expanded === id;
  const started = yours && progress !== undefined ? progress(id) : null;

  return (
    <li className="border-b border-border last:border-b-0">
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2.5 border-l-[3px] pr-5 ${yours ? "border-l-paid" : "border-l-primary"}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`row-${id}`}
          onClick={() => onToggle(id)}
          className="flex min-w-0 flex-1 items-start gap-4 py-4 pl-5 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
        >
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${yours ? "bg-paid" : "bg-primary shadow-[0_0_0_2px_rgba(4,151,254,0.15)]"}`} aria-hidden />
          <span className="grid min-w-0 gap-1">
            <span className="truncate font-serif text-[15px] font-semibold text-foreground">{order.title}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {started !== null && (
                <>
                  <Badge
                    variant="outline"
                    className={started === "not-started" ? "border-urgent/20 bg-urgent/5 text-urgent" : "border-primary/20 bg-primary/5 text-primary"}
                  >
                    {started === "not-started" ? "Not started" : "In review"}
                  </Badge>
                  <Dot />
                </>
              )}
              <span className="flex items-center gap-1 whitespace-nowrap">
                <CalendarDays className="size-3" aria-hidden />
                Open until <span className={urgency(envelope.deadline, now)}>{clockWords(envelope.deadline, now)}</span>
              </span>
              <Dot />
              <span className="flex items-center gap-1 whitespace-nowrap">
                <Clock className="size-3" aria-hidden />
                {claimWindowWords(envelope.claim_timeout_seconds)}
              </span>
              {order.documentWords !== null && (
                <>
                  <Dot />
                  <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <FileText className="size-3" aria-hidden />
                    {order.documentWords} words
                  </span>
                </>
              )}
              <Dot />
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-[10px] tracking-[0.04em] text-primary uppercase">
                {envelope.cert_tag}
              </Badge>
              <ChevronDown className={`size-3 text-faint transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
            </span>
            {yours && (
              <span className={`text-xs font-medium ${urgency(claim.signBy, now)}`}>
                Claimed · yours to review · sign by {clockWords(claim.signBy, now)}
              </span>
            )}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-4 py-4">
          <Escrow priceTinybars={envelope.price_tinybars} />
          <Button
            type="button"
            size="sm"
            className={`h-8 rounded-lg px-4 text-[13px] font-semibold ${yours ? "bg-paid hover:bg-paid/90" : "hover:bg-azure-hover"}`}
            onClick={() => {
              // Continue resumes work: the expert already holds this order, so
              // it goes straight to the document rather than through the claim
              // screen again. Claim starts the claim here when the app wired
              // one; without it the order screen is where it is confirmed.
              if (yours) (onResume ?? onOpen)(id);
              else if (onClaim === undefined) onOpen(id);
              else onClaim(order);
            }}
          >
            {yours ? "Continue" : "Claim"}
          </Button>
        </span>
      </div>

      <div
        id={`row-${id}`}
        className={`grid border-t border-border bg-secondary transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] border-t-0 opacity-0"}`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="grid gap-3 px-5 py-4 pl-11">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{askSummary(order.ask)}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-faint">Order</dt>
              <dd className="m-0">
                <Copyable value={id} display={id.length > 20 ? `${id.slice(0, 14)}…` : id} className="text-[11px]" />
              </dd>
              <dt className="text-faint">Required</dt>
              <dd className="m-0">
                <Mono className="text-[11px]">{envelope.cert_tag}</Mono>
              </dd>
              <dt className="text-faint">Escrow</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2">
                <Mono className="text-[11px]">{order.escrowAccountId}</Mono>
                <HashscanLink kind="account" id={order.escrowAccountId} label="View" />
              </dd>
              <dt className="text-faint">Record</dt>
              <dd className="m-0">
                <HashscanLink kind="topic" id={order.ordersTopicId} label="View record" />
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </li>
  );
}

function Dot() {
  return (
    <span className="text-[10px] text-border" aria-hidden>
      ·
    </span>
  );
}

/** For the tests: the row's one-line ask. */
export const firstLine = askSummary;

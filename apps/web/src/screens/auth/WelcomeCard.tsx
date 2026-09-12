import type { ReactNode } from "react";
import { Check, ChevronRight, CircleDollarSign, Clock, Shield, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChainMode } from "../../chain/config";
import { AuthFrame } from "./AuthCards";

const PRIMARY = "h-[52px] w-full rounded-[10px] text-[15px] font-semibold hover:bg-azure-hover";

/* ----------------------------------------------------------------- welcome */

export type WelcomePage = 1 | 2 | 3;

/**
 * Three panes after the account exists. Every line here is something the
 * build actually does: pay on any verdict, a claim window that returns the
 * order, a public permanent record. Nothing about closed incentives, which
 * is a production thesis and stays out of the hook.
 */
export function WelcomeCard({
  mode,
  name,
  page,
  onNext,
  onBack,
  onSkip,
}: {
  mode: ChainMode;
  name: string;
  page: WelcomePage;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <AuthFrame mode={mode} welcome={name} wide title={<PaneTitle page={page} />}>
      <div className="grid gap-6">
        {page === 1 && (
          <>
            <p className="mt-2 text-center text-[15px] leading-relaxed text-muted-foreground">
              AI agents need human expertise they can trust. You review their work, sign your verdict, and get paid —
              on your schedule.
            </p>
            <ul className="flex flex-wrap justify-center gap-2.5" aria-label="What you get">
              <Pill Icon={Clock}>Your schedule</Pill>
              <Pill Icon={ShieldCheck}>Permanent record</Pill>
              <Pill Icon={CircleDollarSign}>Paid on every verdict</Pill>
            </ul>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4">
              <button type="button" onClick={onSkip} className="px-2 text-[15px] text-muted-foreground hover:text-foreground">
                Skip
              </button>
              <Button type="button" size="lg" className={PRIMARY} onClick={onNext}>
                How it works
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </>
        )}

        {page === 2 && (
          <>
            <p className="mt-2 text-center text-[15px] leading-relaxed text-muted-foreground">
              It works like an inbox. Browse available tasks, claim one, review the document, and sign your verdict.
            </p>
            <ol className="grid gap-4">
              <Step n="1" title="Browse">
                See paid tasks matching your credential. Each shows what it pays and when it's due.
              </Step>
              <Step n="2" title="Claim">
                Take the task. You'll have a set window to review — if it runs out, the task returns to the inbox.
              </Step>
              <Step n="3" title="Review & sign">
                Read the document, form your verdict, note any issues. Then sign — your name goes on it, permanently.
              </Step>
              <Step n={<Check className="size-3.5 text-paid" strokeWidth={3} />} title="Paid">
                Payment releases when you sign. No invoicing, no follow-up.
              </Step>
            </ol>
            <Nav onBack={onBack} onNext={onNext} next="One more thing" />
          </>
        )}

        {page === 3 && (
          <>
            <p className="mt-2 text-center text-[15px] leading-relaxed text-muted-foreground">
              A reject is a delivered judgment — the requester paid for your honest opinion, not for approval. Your
              verdict is the product.
            </p>
            <div className="grid gap-3">
              <VerdictExample stamp="Reject" tone="reject" summary="You found 2 issues in the report" />
              <VerdictExample stamp="Approve" tone="approve" summary="The report passes your review" />
            </div>
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary px-3.5 py-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden />
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Your reputation is permanent.</span> Every verdict you
                sign is a public, tamper-proof record tied to your credential. Your track record speaks for itself.
              </p>
            </div>
            <Nav onBack={onBack} onNext={onNext} next="Open inbox" />
          </>
        )}
      </div>
    </AuthFrame>
  );
}

function PaneTitle({ page }: { page: WelcomePage }) {
  return (
    <>
      <span className="mb-7 flex justify-center gap-2" aria-label={`Step ${String(page)} of 3`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1 w-10 rounded-full ${n <= page ? "bg-primary" : "bg-border"}`} aria-hidden />
        ))}
      </span>
      {page === 1 && (
        <span className="mb-6 flex justify-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary" aria-hidden>
            <Star className="size-8" />
          </span>
        </span>
      )}
      <span className="block">
        {page === 1 ? "Get paid for your professional judgment" : page === 2 ? "How a review works" : "You get paid. Every time."}
      </span>
    </>
  );
}

function Pill({ Icon, children }: { Icon: typeof Star; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[14px] font-medium">
      <Icon className="size-4 text-primary" aria-hidden />
      {children}
    </li>
  );
}

function Step({ n, title, children }: { n: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-3.5">
      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary" aria-hidden>
        {n}
      </span>
      <span className="grid gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[14px] leading-relaxed text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function VerdictExample({ stamp, tone, summary }: { stamp: string; tone: "reject" | "approve"; summary: string }) {
  return (
    <div className="grid gap-3 rounded-xl border border-border p-4">
      <p className="flex items-center gap-3">
        <span
          className={`rounded-md border px-3 py-1 text-[12px] font-bold tracking-[0.06em] uppercase ${
            tone === "reject" ? "border-urgent/30 bg-urgent/5 text-urgent" : "border-paid/30 bg-paid/5 text-paid"
          }`}
        >
          {stamp}
        </span>
        <span className="text-[14px] text-muted-foreground">{summary}</span>
      </p>
      <p className="flex items-center justify-between border-t border-border pt-3 text-[14px]">
        <span className="flex items-center gap-2 font-mono font-semibold text-paid">
          <Check className="size-4" strokeWidth={3} aria-hidden />
          The order value
        </span>
        <span className="text-muted-foreground">Paid to you</span>
      </p>
    </div>
  );
}

function Nav({ onBack, onNext, next }: { onBack: () => void; onNext: () => void; next: string }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
      <Button type="button" variant="outline" className="h-[52px] rounded-[10px] border-[1.5px] px-6 text-[15px] font-medium" onClick={onBack}>
        Back
      </Button>
      <Button type="button" size="lg" className={PRIMARY} onClick={onNext}>
        {next}
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

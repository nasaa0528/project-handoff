import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import { Badge } from "@/components/ui/badge";
import type { OrderForSigning } from "../sign/sign";
import { HashscanLink } from "./HashscanLink";
import { Mono, ShortHash } from "./Mono";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group border-t border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium sm:px-6 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <div className="px-5 pb-5 sm:px-6">{children}</div>
    </details>
  );
}

/**
 * The claimed order, as the envelope states it. The three facts an expert
 * decides on sit up front; the hashes and account ids that prove them are one
 * disclosure away, because they are for checking, not for reading.
 */
export function OrderCard({ order, artifactText }: { order: OrderForSigning; artifactText: string | null }) {
  const { envelope } = order;
  const price = tinybarsToDisplay(parseTinybars(envelope.price_tinybars));

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{envelope.class}</Badge>
          <Badge variant="outline">{envelope.cert_tag}</Badge>
          <Badge variant="outline">CLAIMED</Badge>
          <Mono className="ml-auto text-xs text-muted-foreground">{envelope.order_id}</Mono>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className="grid gap-1">
            <span className="text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">Order value</span>
            <span className="text-2xl font-semibold tracking-tight tabular-nums">{price}</span>
            <span className="text-xs text-muted-foreground">Locked in escrow, released on your signature</span>
          </div>
          <Fact label="Deadline">
            <Mono>{envelope.deadline}</Mono>
          </Fact>
          <Fact label="Deliverable">
            A signed verdict.
            <span className="block text-xs text-muted-foreground">Paid whatever the verdict is.</span>
          </Fact>
        </div>
      </div>

      {artifactText !== null && (
        <Disclosure
          summary={
            <>
              Artifact under review
              <Badge variant="destructive">FAKE</Badge>
            </>
          }
        >
          <pre className="max-h-72 overflow-auto rounded-xl bg-muted/50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {artifactText}
          </pre>
        </Disclosure>
      )}

      <Disclosure summary={<span className="text-muted-foreground">Technical details</span>}>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">Escrow</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Mono>{order.escrowAccountId}</Mono>
            <HashscanLink kind="account" id={order.escrowAccountId} />
          </dd>
          <dt className="text-muted-foreground">Artifact hash</dt>
          <dd>
            <ShortHash value={envelope.artifact_hash_in} />
          </dd>
          <dt className="text-muted-foreground">Spec hash</dt>
          <dd>
            <ShortHash value={envelope.spec_hash} />
          </dd>
          <dt className="text-muted-foreground">Topic</dt>
          <dd>
            <Mono>{order.topicId}</Mono>
          </dd>
        </dl>
      </Disclosure>
    </section>
  );
}

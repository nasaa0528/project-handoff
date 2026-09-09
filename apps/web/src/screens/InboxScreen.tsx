import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { claimWindowWords, clockWords, isPast } from "../lib/clock";
import { askSummary, type InboxEntry } from "../orders/order";
import { Escrow } from "../components/Money";

/**
 * "Here is paid work I am qualified for." Only work the expert can take:
 * orders claimed by someone else are hidden with a muted count, and orders
 * past their deadline are gone. A reviewer decides on three facts, what it
 * is, how big it is, how long they have, and the row gives all three before
 * Claim. Claim itself lives on the order, not here.
 */
export function InboxScreen({
  entries,
  now,
  onOpen,
}: {
  /** Null while the first read is in flight. */
  entries: readonly InboxEntry[] | null;
  now: Date;
  onOpen: (orderId: string) => void;
}) {
  if (entries === null) {
    return (
      <div className="grid gap-3" aria-busy>
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl border border-border/60 bg-muted/40" />
        ))}
      </div>
    );
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const live = entries.filter((e) => !isPast(e.order.envelope.deadline, nowSeconds));
  const takeable = live.filter((e) => e.claim.kind === "open" || e.claim.kind === "yours");
  const others = live.filter((e) => e.claim.kind === "someone-else").length;

  return (
    <div className="grid gap-4">
      {others > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          {others} claimed by {others === 1 ? "someone else" : "others"}
        </p>
      )}

      {takeable.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">No work right now.</p>
      ) : (
        <ul className="grid gap-3">
          {takeable.map(({ order, claim }) => {
            const { envelope } = order;
            return (
              <li key={envelope.order_id}>
                <button
                  type="button"
                  onClick={() => onOpen(envelope.order_id)}
                  className="grid w-full gap-3 rounded-2xl border border-border/60 bg-card p-5 text-left shadow-xs transition hover:border-foreground/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid min-w-0 gap-1">
                      <span className="text-base font-semibold tracking-tight">{order.title}</span>
                      <span className="line-clamp-1 text-sm text-muted-foreground">{askSummary(order.ask)}</span>
                    </div>
                    <Escrow priceTinybars={envelope.price_tinybars} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Open until <span className="text-foreground">{clockWords(envelope.deadline, now)}</span>
                    </span>
                    <span>{claimWindowWords(envelope.claim_timeout_seconds)}</span>
                    {order.documentWords !== null && <span className="tabular-nums">{order.documentWords} words</span>}
                    <Badge variant="outline">{envelope.cert_tag}</Badge>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className={claim.kind === "yours" ? "font-medium" : "text-muted-foreground"}>
                      {claim.kind === "yours" ? `Claimed · yours to review · sign by ${clockWords(claim.signBy, now)}` : "Posted"}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** For the tests: the row's one-line ask. */
export const firstLine = askSummary;

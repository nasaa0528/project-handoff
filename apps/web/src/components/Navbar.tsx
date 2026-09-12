import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChainMode } from "../chain/config";
import { lookupAccount, type AccountLookup } from "../session/mirrorAccount";
import { Copyable } from "./Copyable";
import { HashscanLink } from "./HashscanLink";
import { Logo } from "./Logo";
import { Amount } from "./Money";
import { Mono } from "./Mono";

/** The public docs. The one link out of the funnel, and it opens beside it. */
export const DOCS_URL = "https://docs.the-handoff.xyz";

/** Who is signing. On every screen, quietly; on the Sign step, in full. */
export interface ExpertIdentity {
  readonly accountId: string;
  /** Credential tags this expert holds. Plain pills. */
  readonly credentials: readonly string[];
}

/**
 * The navbar every screen shares: the mark and wordmark, the two sides of one
 * account, and the expert's identity on the right with the details one click
 * down.
 *
 * Two tabs, because a Hedera account is not only a reviewer. Inbox is work
 * this account can take; My requests is work this account paid for. The count
 * rides on Inbox alone — there is nothing to count on the other side that the
 * network can back.
 *
 * The dropdown says only what the network can back. There is no name and no
 * email in this product, because identity is the Hedera account; the balance
 * is a real mirror-node read of that account, taken when the menu first
 * opens rather than at boot, and absent if the read does not answer. No
 * review count, because nothing counts them yet.
 */
export function Navbar({
  mode,
  identity,
  openCount = null,
  active = "inbox",
  onInbox,
  onRequests,
  onDisconnect,
  disconnectHeld = false,
}: {
  mode: ChainMode;
  identity: ExpertIdentity;
  /** Orders the expert can take. Null while unknown. */
  openCount?: number | null | undefined;
  /** Which tab the current screen belongs to. */
  active?: "inbox" | "requests" | undefined;
  onInbox?: (() => void) | undefined;
  onRequests?: (() => void) | undefined;
  onDisconnect?: (() => void) | undefined;
  /** While something is in flight that a disconnect would strand. */
  disconnectHeld?: boolean | undefined;
}) {
  const verified = identity.credentials.length > 0;
  const [opens, setOpens] = useState(0);
  const [account, setAccount] = useState<AccountLookup | null>(null);

  // One read **every** time the menu opens, not once per session. It used to be
  // a boolean that latched true, so the balance was whatever it had been the
  // first time the expert looked — and this app's whole point is watching a
  // payout arrive, so it was stale exactly when it mattered. Opening the menu is
  // the expert asking "what is my balance now"; it gets answered now. The
  // account id is public and the read needs no key.
  useEffect(() => {
    if (opens === 0) return;
    const controller = new AbortController();
    void lookupAccount(identity.accountId, { fetch: (...args) => fetch(...args), signal: controller.signal }).then((found) => {
      if (!controller.signal.aborted) setAccount(found);
    });
    return () => controller.abort();
  }, [opens, identity.accountId]);

  const balance = account !== null && account.status === "found" ? account.balanceTinybars : null;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-card">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={onInbox}
          className="mr-6 flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Inbox"
        >
          <Logo />
        </button>

        <nav className="flex h-full items-center" aria-label="Primary">
          <Tab current={active === "inbox"} onClick={onInbox}>
            Inbox
            {openCount !== null && openCount > 0 && (
              <span className="min-w-[18px] rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold text-primary-foreground">
                {openCount}
              </span>
            )}
          </Tab>
          <Tab current={active === "requests"} onClick={onRequests}>
            My requests
          </Tab>
        </nav>

        <div className="flex-1" />

        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mr-1 flex items-center gap-0.5 rounded-md px-2 py-1 text-[13px] font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Docs
          <ArrowUpRight className="size-3.5 text-faint" aria-hidden />
        </a>

        <DropdownMenu onOpenChange={(open) => open && setOpens((n) => n + 1)}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Your account"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Mono className="text-[13px]">{identity.accountId}</Mono>
                {verified && <ShieldCheck className="size-3.5 text-primary" aria-label="Certified" />}
              </span>
              <ChevronDown className="size-3 text-faint" aria-hidden />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={8} className="w-[280px] overflow-hidden rounded-xl p-0">
            <div className="grid gap-0.5 p-4">
              <p className="text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">Signing as</p>
              <Copyable value={identity.accountId} className="text-sm font-semibold" />
            </div>

            <Section label="Certification">
              {verified ? (
                <span className="flex flex-wrap gap-1.5">
                  {identity.credentials.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-semibold text-primary"
                    >
                      <ShieldCheck className="size-3" aria-hidden />
                      {tag}
                    </span>
                  ))}
                </span>
              ) : (
                <p className="text-xs text-muted-foreground">None on record yet.</p>
              )}
            </Section>

            <Section label="Balance">
              <Row label="Available">
                {balance === null ? (
                  <span className="text-xs text-faint">{account === null ? "…" : "not read"}</span>
                ) : (
                  <Amount tinybars={balance} className="font-mono text-[11.5px] font-semibold text-paid" />
                )}
              </Row>
            </Section>

            <Section label="Account details">
              <Row label="Account">
                <Mono className="text-[11.5px]">{identity.accountId}</Mono>
              </Row>
              <Row label="Network">
                <span className="font-mono text-[11.5px]">{mode === "testnet" ? "Hedera testnet" : "Mock chain"}</span>
              </Row>
              <div className="pt-1">
                <HashscanLink kind="account" id={identity.accountId} label="View on Hashscan" />
              </div>
            </Section>

            {onDisconnect !== undefined && (
              <div className="border-t border-border p-2">
                <DropdownMenuItem disabled={disconnectHeld} onSelect={onDisconnect} className="text-[13px] text-muted-foreground">
                  Disconnect
                </DropdownMenuItem>
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

/**
 * One tab. The current one carries the rule and the ink; the other is quiet
 * until hovered. `aria-current` is on the page's own tab only, so a screen
 * reader is told where it is rather than that both are somewhere.
 */
function Tab({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(current ? { "aria-current": "page" as const } : {})}
      className={`flex h-full items-center gap-1.5 border-b-2 px-4 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
        current
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border px-4 py-3.5">
      <p className="text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </p>
  );
}

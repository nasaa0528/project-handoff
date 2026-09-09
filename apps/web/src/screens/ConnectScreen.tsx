import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChainMode } from "../chain/config";
import { HashscanLink } from "../components/HashscanLink";
import { ModeBanner } from "../components/ModeBanner";
import { parseAccountId } from "../session/accountId";
import {
  assessConnect,
  balanceWords,
  buildConnection,
  keyTypeWords,
  type ConnectAssessment,
  type ExpertConnection,
} from "../session/connect";
import { describeKeyShape, describePrivateKey, type KeyShape } from "../session/keyShape";
import { lookupAccount, type AccountLookup } from "../session/mirrorAccount";

export type ConnectOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export type LookupFn = (accountId: string, signal: AbortSignal) => Promise<AccountLookup>;

/**
 * How the key field hides what is typed. "masked" is a text field drawn as
 * dots through CSS, which no password manager recognises as a credential, so
 * nothing offers to save it. "password" is the fallback where that CSS is
 * not supported; the browser then treats it as a password, and the
 * recording profile has saving turned off.
 */
export type KeyFieldKind = "masked" | "password";

const LOOKUP_DEBOUNCE_MS = 500;

const PORTAL_URL = "https://portal.hedera.com";

const defaultLookup: LookupFn = (accountId, signal) => lookupAccount(accountId, { fetch: (...args) => fetch(...args), signal });

function keyFieldKind(): KeyFieldKind {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("-webkit-text-security", "disc")
    ? "masked"
    : "password";
}

/**
 * The first screen. The account comes from the person at the keyboard; on
 * testnet so does the key, into a field that never shows it, held in an
 * object that cannot print it, read once by the adapter and then gone from
 * this screen. On the mock there is no key field at all, because the mock
 * signs nothing.
 *
 * No `<form>`: a submitted form with a filled credential field is what asks
 * the browser to save the password, and that prompt must never appear on
 * camera. Enter connects through a key handler instead.
 */
export function ConnectScreen({
  mode,
  prefill,
  notice,
  onConnect,
  lookup = defaultLookup,
}: {
  mode: ChainMode;
  prefill: string | null;
  /** One line from the previous screen, for example after a disconnect. */
  notice: string | null;
  onConnect: (connection: ExpertConnection) => Promise<ConnectOutcome>;
  /** Testnet only. Injected so the screen is testable without a network. */
  lookup?: LookupFn;
}) {
  const [accountIdText, setAccountIdText] = useState(prefill ?? "");
  const [keyShape, setKeyShape] = useState<KeyShape | null>(null);
  const [lastLookup, setLastLookup] = useState<AccountLookup | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement | null>(null);
  const keyField = useMemo(keyFieldKind, []);

  const parsed = parseAccountId(accountIdText);
  const accountId = parsed.ok ? parsed.accountId : null;
  const currentLookup = lastLookup !== null && lastLookup.accountId === accountId ? lastLookup : null;

  // One read of the mirror node per account id, after the typing stops.
  useEffect(() => {
    if (mode !== "testnet" || accountId === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void lookup(accountId, controller.signal).then((result) => {
        if (!controller.signal.aborted) setLastLookup(result);
      });
    }, LOOKUP_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mode, accountId, attempt, lookup]);

  const assessment = useMemo(
    () => assessConnect({ mode, accountIdText, keyShape, lookup: currentLookup }),
    [mode, accountIdText, keyShape, currentLookup],
  );

  async function connect() {
    if (busy) return;
    setError(null);

    // Read the field once, blank it, and hand the text to the holder. From
    // here on the key exists only inside the holder, and after the call
    // below only inside the adapter, if one took it.
    const connection = buildConnection({ mode, assessment, lookup: currentLookup }, () => {
      const field = keyRef.current;
      const text = field?.value ?? "";
      if (field !== null) field.value = "";
      setKeyShape(null);
      return text;
    });
    if (connection === null) return;

    setBusy(true);
    try {
      const outcome = await onConnect(connection);
      if (!outcome.ok) setError(outcome.message);
    } finally {
      if (connection.mode === "testnet") connection.credential.key.dispose();
      setBusy(false);
    }
  }

  return (
    <ConnectCard
      mode={mode}
      accountIdText={accountIdText}
      assessment={assessment}
      lookup={currentLookup}
      lookupPending={mode === "testnet" && accountId !== null && currentLookup === null}
      keyShape={keyShape}
      keyField={keyField}
      error={error}
      notice={notice}
      busy={busy}
      keyRef={keyRef}
      onAccountIdChange={setAccountIdText}
      onKeyChange={(text) => setKeyShape(text === "" ? null : describePrivateKey(text))}
      onRetryLookup={() => {
        setLastLookup(null);
        setAttempt((n) => n + 1);
      }}
      onConnect={() => void connect()}
    />
  );
}

function Helper({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function LookupChip({
  lookup,
  pending,
  onRetry,
}: {
  lookup: AccountLookup | null;
  pending: boolean;
  onRetry: () => void;
}) {
  if (pending) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Checking testnet…
      </Badge>
    );
  }
  if (lookup === null) return null;
  switch (lookup.status) {
    case "found": {
      if (lookup.deleted) {
        return (
          <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">
            Deleted on testnet
          </Badge>
        );
      }
      const balance = balanceWords(lookup);
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-emerald-300 text-emerald-800 dark:text-emerald-200">
            Found on testnet
          </Badge>
          <span className="text-xs text-muted-foreground">
            {keyTypeWords(lookup.keyType)} key{balance === null ? "" : ` · ${balance}`}
          </span>
          <HashscanLink kind="account" id={lookup.accountId} />
        </span>
      );
    }
    case "not-found":
      return <Badge variant="outline">Not found on testnet</Badge>;
    case "unsupported-key":
      return <Badge variant="outline">Unsupported key</Badge>;
    case "unreachable":
      return (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">
            Testnet did not answer
          </Badge>
          <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
            Retry
          </Button>
        </span>
      );
  }
}

const MASKED: CSSProperties = { WebkitTextSecurity: "disc" } as CSSProperties;

/**
 * The screen with every state as a prop, so each state can be rendered to
 * markup and read back in a test. `ConnectScreen` above is the thin part
 * that owns the state.
 */
export function ConnectCard({
  mode,
  accountIdText,
  assessment,
  lookup,
  lookupPending,
  keyShape,
  keyField,
  error,
  notice,
  busy,
  keyRef,
  onAccountIdChange,
  onKeyChange,
  onRetryLookup,
  onConnect,
}: {
  mode: ChainMode;
  accountIdText: string;
  assessment: ConnectAssessment;
  lookup: AccountLookup | null;
  lookupPending: boolean;
  /** What the key looks like. Its words go on screen; the key never does. */
  keyShape: KeyShape | null;
  keyField: KeyFieldKind;
  error: string | null;
  notice: string | null;
  busy: boolean;
  keyRef?: RefObject<HTMLInputElement | null>;
  onAccountIdChange: (text: string) => void;
  onKeyChange: (text: string) => void;
  onRetryLookup: () => void;
  onConnect: () => void;
}) {
  const testnet = mode === "testnet";
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onConnect();
    }
  };
  const canConnect = assessment.ready && !busy;
  const keyRejected = keyShape !== null && !keyShape.ok;
  // A rejected shape is shown under the field, once, in red; not again below the button.
  const blockers = keyRejected ? assessment.blockers.filter((blocker) => blocker !== keyShape.reason) : assessment.blockers;

  return (
    <div className="min-h-dvh bg-background">
      <ModeBanner mode={mode} />

      <header className="mx-auto max-w-md px-4 pt-6 pb-2 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">
          Handoff <span className="font-normal text-muted-foreground">expert</span>
        </h1>
      </header>

      <main className="mx-auto grid max-w-md gap-4 px-4 pt-4 pb-12 sm:px-6">
        {notice !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        <section className="grid gap-5 rounded-2xl border border-border/60 bg-card p-5 shadow-xs sm:p-6" aria-labelledby="connect-title">
          <div className="grid gap-1.5">
            <h2 id="connect-title" className="text-base font-semibold tracking-tight">
              Connect your account
            </h2>
            <p className="text-sm text-muted-foreground">
              {testnet
                ? "Handoff pays you for signed verdicts. To sign, this app needs the Hedera testnet account you will be paid to, and the private key that proves it is yours."
                : "Handoff pays you for signed verdicts. Enter the account id the demo signs as. On the mock chain nothing is real."}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="connect-account-id">Account id</Label>
            <Input
              id="connect-account-id"
              value={accountIdText}
              onChange={(event) => onAccountIdChange(event.target.value)}
              onKeyDown={onEnter}
              disabled={busy}
              placeholder="0.0.12345"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={testnet ? "connect-account-help connect-account-status" : "connect-account-help"}
              className="h-10 rounded-xl font-mono"
            />
            <Helper id="connect-account-help">
              Like an account number. It is public: the Hedera portal and Hashscan both show it.
            </Helper>
            {testnet && (
              <div id="connect-account-status" role="status" className="min-h-5">
                <LookupChip lookup={lookup} pending={lookupPending} onRetry={onRetryLookup} />
              </div>
            )}
          </div>

          {testnet ? (
            <div className="grid gap-2">
              <Label htmlFor="connect-private-key">Private key</Label>
              <Input
                id="connect-private-key"
                ref={keyRef}
                type={keyField === "masked" ? "text" : "password"}
                style={keyField === "masked" ? MASKED : undefined}
                onChange={(event) => onKeyChange(event.target.value)}
                onKeyDown={onEnter}
                disabled={busy}
                placeholder="Paste the key. It shows as dots."
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                aria-invalid={keyRejected || undefined}
                aria-describedby="connect-key-help connect-key-shape"
                className="h-10 rounded-xl font-mono"
              />
              <p
                id="connect-key-shape"
                role="status"
                className={`min-h-4 text-xs ${keyRejected ? "text-destructive" : "text-muted-foreground"}`}
              >
                {keyShape === null ? "" : describeKeyShape(keyShape)}
              </p>
              <Helper id="connect-key-help">
                Your private key is your signature. It stays in this tab, in memory only: not saved, not sent
                anywhere, never shown, forgotten when you disconnect, reload or close the tab. Your account id is
                remembered; the key is asked for again. It signs your verdict and nothing else. It is never a
                schedule key, so it cannot touch the money in escrow.
              </Helper>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
              Mock chain. Nothing is signed here, so there is no key to enter. Every id you will see is fabricated,
              and this screen is never recorded.
            </div>
          )}

          {testnet && (
            <details className="group text-xs text-muted-foreground">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition group-open:rotate-90" aria-hidden />
                Where do I find these?
              </summary>
              <p className="mt-2 leading-relaxed">
                The{" "}
                <a
                  href={PORTAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-border underline-offset-4 hover:text-foreground"
                >
                  Hedera portal
                </a>{" "}
                lists your testnet account as a number like 0.0.12345 and, under it, a private key: a long
                hexadecimal string it tells you to keep secret. Both forms it offers work here, DER (starts with
                302e or 3030) and plain hex. Paste it rather than typing it. The same page gives out free test HBAR.
              </p>
            </details>
          )}

          {assessment.warnings.length > 0 && (
            <ul aria-live="polite" className="grid gap-1 text-xs text-amber-700 dark:text-amber-300">
              {assessment.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {error !== null && (
            <Alert variant="destructive">
              <AlertTitle>Not connected</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2">
            <Button type="button" size="lg" className="h-11 w-full rounded-xl" disabled={!canConnect} onClick={onConnect}>
              {busy
                ? "Connecting…"
                : assessment.accountId === null
                  ? "Connect"
                  : `Connect as ${assessment.accountId}`}
            </Button>
            {!busy && blockers.length > 0 && (
              <ul aria-live="polite" className="grid gap-0.5 text-xs text-muted-foreground">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>

          {testnet && (
            <p className="text-xs text-muted-foreground">
              In production a wallet app signs instead. Pasting a key is the testnet shortcut.
            </p>
          )}
        </section>

        <p className="px-1 text-xs text-muted-foreground">
          {testnet
            ? "Testnet only. The account holds test HBAR, not real money. Never paste a key that controls real funds."
            : "Mock chain. Nothing here reaches any network."}
        </p>
      </main>
    </div>
  );
}

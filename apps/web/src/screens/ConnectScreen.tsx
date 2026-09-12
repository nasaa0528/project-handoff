import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Lock, Mail, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChainMode } from "../chain/config";
import { HashscanLink } from "../components/HashscanLink";
import { Logo } from "../components/Logo";
import { ModeBanner } from "../components/ModeBanner";
import { TestnetBadge } from "../components/TestnetBadge";
import { parseAccountId } from "../session/accountId";
import { assessSignIn } from "../session/accounts";
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

/**
 * The email side of the card. Present only when an accounts API is
 * configured; the screen owns the two fields and hands the pair over once.
 * The outcome is `ok` when the app moved on, so the card has nothing left
 * to say; otherwise a sentence for under the button.
 */
export interface EmailSignIn {
  readonly onSubmit: (identifier: string, password: string) => Promise<ConnectOutcome>;
  readonly onCreateAccount: () => void;
}

/** The email form's state, for the card. */
export interface EmailFields {
  readonly identifier: string;
  readonly password: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly blockers: readonly string[];
  readonly onIdentifier: (text: string) => void;
  readonly onPassword: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onCreateAccount: () => void;
}

export type LookupFn = (accountId: string, signal: AbortSignal) => Promise<AccountLookup>;

/** What the preview card says once the account id checks out. Null when nothing is known. */
export interface CredentialPreview {
  readonly label: string;
  readonly tag: string;
}

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
  credential = null,
  email = null,
  locked = false,
  onBack,
}: {
  mode: ChainMode;
  prefill: string | null;
  /** One line from the previous screen, for example after a disconnect. */
  notice: string | null;
  onConnect: (connection: ExpertConnection) => Promise<ConnectOutcome>;
  /** Testnet only. Injected so the screen is testable without a network. */
  lookup?: LookupFn;
  /** The credential this build grants, shown once the id checks out. */
  credential?: CredentialPreview | null;
  /** Sign in with an email. Null when no accounts API is configured. */
  email?: EmailSignIn | null;
  /** The account is settled by an email session; only the key is asked for. */
  locked?: boolean;
  /** From the locked step, back to the connect screen. */
  onBack?: (() => void) | undefined;
}) {
  const [accountIdText, setAccountIdText] = useState(prefill ?? "");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
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

  async function signInWithEmail() {
    if (email === null || emailBusy) return;
    if (assessSignIn(identifier, password).length > 0) return;
    setEmailBusy(true);
    setEmailError(null);
    try {
      const outcome = await email.onSubmit(identifier.trim(), password);
      if (!outcome.ok) setEmailError(outcome.message);
      // On success the app has moved on; the password is dropped with this screen.
    } finally {
      setEmailBusy(false);
    }
  }

  const emailFields: EmailFields | null =
    email === null || locked
      ? null
      : {
          identifier,
          password,
          busy: emailBusy,
          error: emailError,
          blockers: assessSignIn(identifier, password),
          onIdentifier: setIdentifier,
          onPassword: setPassword,
          onSubmit: () => void signInWithEmail(),
          onCreateAccount: email.onCreateAccount,
        };

  return (
    <ConnectCard
      mode={mode}
      email={emailFields}
      locked={locked}
      onBack={onBack}
      accountIdText={accountIdText}
      assessment={assessment}
      lookup={currentLookup}
      lookupPending={mode === "testnet" && accountId !== null && currentLookup === null}
      keyShape={keyShape}
      keyField={keyField}
      error={error}
      notice={notice}
      busy={busy}
      credential={credential}
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
  credential = null,
  email = null,
  locked = false,
  onBack,
  keyRef,
  onAccountIdChange,
  onKeyChange,
  onRetryLookup,
  onConnect,
}: {
  mode: ChainMode;
  /** The email form. Null when there is no accounts API, or on the locked step. */
  email?: EmailFields | null;
  /** The account came from an email session; only the key is asked for. */
  locked?: boolean;
  onBack?: (() => void) | undefined;
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
  credential?: CredentialPreview | null;
  keyRef?: RefObject<HTMLInputElement | null>;
  onAccountIdChange: (text: string) => void;
  onKeyChange: (text: string) => void;
  onRetryLookup: () => void;
  onConnect: () => void;
}) {
  const testnet = mode === "testnet";
  // The Hedera panel opens by itself when an id is already there, from a
  // reload or a prefill; otherwise it waits behind its toggle.
  // Two panels, one open at a time. Without an email form the Hedera panel is
  // the only one, so it is simply open.
  const [open, setOpen] = useState(accountIdText !== "" || email === null || locked);
  const [emailOpen, setEmailOpen] = useState(email !== null && (email.identifier !== "" || email.error !== null));
  const showEmail = () => {
    setEmailOpen(true);
    setOpen(false);
  };
  const showHedera = () => {
    setOpen((o) => !o);
    setEmailOpen(false);
  };
  const emailEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && email !== null) {
      event.preventDefault();
      email.onSubmit();
    }
  };
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
  // The id checks out: on the mock when it parses, on testnet when the network found it.
  const idChecksOut = assessment.accountId !== null && (!testnet || (lookup?.status === "found" && !lookup.deleted));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ModeBanner mode={mode} />

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <section
          className="grid w-full max-w-[480px] gap-0 rounded-2xl bg-card px-6 pt-11 pb-9 shadow-[0_2px_12px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)] sm:px-10"
          aria-labelledby="connect-title"
        >
          <div className="mb-8 flex justify-center">
            <Logo size="lg" />
          </div>

          <h1 id="connect-title" className="text-center font-serif text-[22px] leading-tight font-semibold tracking-tight">
            {locked ? "One more thing: your key" : "Sign in as an expert"}
          </h1>
          <p className="mt-1.5 mb-7 text-center text-sm leading-relaxed text-muted-foreground">
            {locked
              ? "You are signed in. Signing a verdict needs the key of the account you registered, in this tab, in memory only."
              : "Review work, sign your verdict, get paid."}
          </p>

          {notice !== null && (
            <p role="status" className="mb-5 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {notice}
            </p>
          )}

          {email !== null && (
            <>
              {/* The button gives way to the fields: once open there is one Sign in on the card, not two. */}
              {!emailOpen && (
              <button
                type="button"
                aria-expanded={emailOpen}
                aria-controls="connect-email-panel"
                onClick={showEmail}
                className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-azure-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Mail className="size-[18px]" aria-hidden />
                Sign in with email
                <ChevronDown className="size-3.5" aria-hidden />
              </button>
              )}

              <div
                id="connect-email-panel"
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${emailOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                inert={!emailOpen}
              >
              <div className="overflow-hidden">
              {/* No <form>, for the same reason as the key field: a submitted form with a password asks the browser to save it. */}
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="connect-email" className="text-[13px] font-semibold">
                    Email
                  </Label>
                  <Input
                    id="connect-email"
                    value={email.identifier}
                    onChange={(event) => email.onIdentifier(event.target.value)}
                    onKeyDown={emailEnter}
                    disabled={email.busy}
                    placeholder="you@example.com"
                    autoComplete="username"
                    spellCheck={false}
                    className="h-11 rounded-[10px] bg-secondary text-[13px] focus-visible:ring-primary/20"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="connect-password" className="text-[13px] font-semibold">
                    Password
                  </Label>
                  <Input
                    id="connect-password"
                    type="password"
                    value={email.password}
                    onChange={(event) => email.onPassword(event.target.value)}
                    onKeyDown={emailEnter}
                    disabled={email.busy}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="h-11 rounded-[10px] bg-secondary text-[13px] focus-visible:ring-primary/20"
                  />
                </div>
                {email.error !== null && (
                  <Alert variant="destructive">
                    <AlertTitle>Not signed in</AlertTitle>
                    <AlertDescription>{email.error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  type="button"
                  size="lg"
                  className="h-[52px] w-full rounded-[10px] text-[15px] font-semibold hover:bg-azure-hover"
                  disabled={email.busy || email.blockers.length > 0}
                  onClick={email.onSubmit}
                >
                  {email.busy ? "Signing in…" : "Sign in"}
                  {!email.busy && <ChevronRight className="size-4" aria-hidden />}
                </Button>
              </div>
              </div>
              </div>

              <div className="my-6 flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-medium tracking-[0.05em] whitespace-nowrap text-faint uppercase">already have a Hedera account?</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                aria-expanded={open}
                aria-controls="connect-hedera-panel"
                onClick={showHedera}
                className="flex h-[52px] w-full items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-border text-[14px] font-semibold text-foreground transition-colors hover:border-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Lock className="size-3.5" aria-hidden />
                Sign in with Hedera
                <ChevronDown className={`size-3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </>
          )}

          <div
            id="connect-hedera-panel"
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
            inert={!open}
          >
            <div className="overflow-hidden">
              <div className="grid gap-4 pt-5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {testnet
                    ? "Handoff pays you for signed verdicts. To sign, this app needs the Hedera testnet account you will be paid to, and the private key that proves it is yours."
                    : "Handoff pays you for signed verdicts. Enter the account id the demo signs as. On the mock chain nothing is real."}
                </p>

                <div className="grid gap-1.5">
                  <Label htmlFor="connect-account-id" className="text-[13px] font-semibold">
                    Account id
                  </Label>
                  <Input
                    id="connect-account-id"
                    value={accountIdText}
                    onChange={(event) => onAccountIdChange(event.target.value)}
                    onKeyDown={onEnter}
                    disabled={busy || locked}
                    readOnly={locked}
                    placeholder="0.0.12345"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={testnet ? "connect-account-help connect-account-status" : "connect-account-help"}
                    className="h-11 rounded-[10px] bg-secondary font-mono text-[13px] focus-visible:ring-primary/20"
                  />
                  <Helper id="connect-account-help">
                    {locked
                      ? "The account you registered. To sign as a different one, go back and sign in with its key."
                      : "Like an account number. It is public: the Hedera portal and Hashscan both show it."}
                  </Helper>
                  {testnet && (
                    <div id="connect-account-status" role="status" className="min-h-5">
                      <LookupChip lookup={lookup} pending={lookupPending} onRetry={onRetryLookup} />
                    </div>
                  )}
                </div>

                {testnet ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor="connect-private-key" className="text-[13px] font-semibold">
                      Private key
                    </Label>
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
                      className="h-11 rounded-[10px] bg-secondary font-mono text-xs tracking-[0.02em] focus-visible:ring-primary/20"
                    />
                    <p
                      id="connect-key-shape"
                      role="status"
                      className={`min-h-4 text-xs ${keyRejected ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {keyShape === null ? "Paste once. Held in memory, never stored." : describeKeyShape(keyShape)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-secondary p-4 text-xs leading-relaxed text-muted-foreground">
                    Mock chain. Nothing is signed here, so there is no key to enter. Every id you will see is fabricated,
                    and this screen is never recorded.
                  </div>
                )}

                {/* The credential, once the id checks out. Grows in; never a modal. */}
                <div
                  className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${idChecksOut && credential !== null ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                  aria-hidden={!(idChecksOut && credential !== null)}
                >
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2.5 rounded-[10px] border-[1.5px] border-border bg-secondary px-3.5 py-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                        <ShieldCheck className="size-4" />
                      </span>
                      <span className="grid min-w-0">
                        <span className="text-[13px] font-semibold">{credential?.label ?? ""}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{credential?.tag ?? ""}</span>
                      </span>
                    </div>
                  </div>
                </div>

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
                  <ul aria-live="polite" className="grid gap-1 text-xs text-urgent">
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
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="h-12 w-full rounded-[10px] border-[1.5px] bg-secondary text-[14px] font-semibold hover:border-primary hover:bg-primary/5"
                    disabled={!canConnect}
                    onClick={onConnect}
                  >
                    {busy ? "Connecting…" : assessment.accountId === null ? "Continue" : `Continue as ${assessment.accountId}`}
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
                  <div className="flex items-start gap-2 rounded-lg border border-paid/10 bg-paid/5 px-3 py-2.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden />
                    <Helper id="connect-key-help">
                      Your private key is your signature. It stays in this tab, in memory only: not saved, not sent
                      anywhere, never shown, forgotten when you disconnect, reload or close the tab. Your account id is
                      remembered; the key is asked for again. It signs your verdict and nothing else. It is never a
                      schedule key, so it cannot touch the money in escrow.
                    </Helper>
                  </div>
                )}

                {testnet && (
                  <p className="text-center text-xs text-faint">
                    In production a wallet app signs instead. Pasting a key is the testnet shortcut.
                  </p>
                )}
              </div>
            </div>
          </div>
          {email !== null && (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              New here?{" "}
              <button type="button" onClick={email.onCreateAccount} className="font-semibold text-primary underline-offset-4 hover:underline">
                Create an account
              </button>
            </p>
          )}
          {locked && onBack !== undefined && (
            <button type="button" onClick={onBack} className="mx-auto mt-6 flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" aria-hidden />
              Back
            </button>
          )}
        </section>

        <p className="mt-4 max-w-[480px] text-center text-xs text-faint">
          {testnet
            ? "Testnet only. The account holds test HBAR, not real money. Never paste a key that controls real funds."
            : "Mock chain. Nothing here reaches any network."}
        </p>
      </main>

      <TestnetBadge mode={mode} />
    </div>
  );
}

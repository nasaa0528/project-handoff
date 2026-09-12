import type { KeyboardEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleDollarSign,
  CirclePlus,
  Layers,
  Lock,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChainMode } from "../../chain/config";
import { Logo } from "../../components/Logo";
import { ModeBanner } from "../../components/ModeBanner";
import { TestnetBadge } from "../../components/TestnetBadge";
import { PASSWORD_MIN_LENGTH, type RegistrationDraft } from "../../session/accounts";

/**
 * The cards of the email flow, every state a prop, so each renders to
 * markup and reads back in a test. `AuthFlow` owns the state and the calls.
 *
 * None of these holds a key, and none says a credential was verified: the
 * credential card is a static form that stores nothing, and it says so.
 */

const PRIMARY = "h-[52px] w-full rounded-[10px] text-[15px] font-semibold hover:bg-azure-hover";
const FIELD = "h-11 rounded-[10px] bg-secondary text-[13px] focus-visible:ring-primary/20";

export function AuthFrame({
  mode,
  title,
  lead,
  welcome,
  children,
  wide = false,
}: {
  mode: ChainMode;
  title: ReactNode;
  lead?: ReactNode;
  /** "Welcome, name" above the card, on the onboarding panes only. */
  welcome?: string | undefined;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ModeBanner mode={mode} />
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6">
        {welcome !== undefined && (
          <p className="mb-4 text-sm text-muted-foreground">
            Welcome, <span className="font-semibold text-foreground">{welcome}</span>
          </p>
        )}
        <section
          className={`grid w-full gap-0 rounded-2xl bg-card px-6 pt-11 pb-9 shadow-[0_2px_12px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.03)] sm:px-10 ${wide ? "max-w-[560px]" : "max-w-[480px]"}`}
          aria-labelledby="auth-title"
        >
          {welcome === undefined && (
            <div className="mb-8 flex justify-center">
              <Logo size="lg" />
            </div>
          )}
          <h1 id="auth-title" className="text-center font-serif text-[22px] leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          {lead !== undefined && <p className="mt-1.5 mb-7 text-center text-sm leading-relaxed text-muted-foreground">{lead}</p>}
          {children}
        </section>
      </main>
      <TestnetBadge mode={mode} />
    </div>
  );
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </Label>
      {children}
      {help !== undefined && (
        <p id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

function Failure({ title, message }: { title: string; message: string | null }) {
  if (message === null) return null;
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function Blockers({ blockers, busy }: { blockers: readonly string[]; busy: boolean }) {
  if (busy || blockers.length === 0) return null;
  return (
    <ul aria-live="polite" className="grid gap-0.5 text-xs text-muted-foreground">
      {blockers.map((blocker) => (
        <li key={blocker}>{blocker}</li>
      ))}
    </ul>
  );
}

function onEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      action();
    }
  };
}

/* ---------------------------------------------------------------- register */

export function RegisterCard({
  mode,
  draft,
  onDraft,
  blockers,
  error,
  busy,
  onSubmit,
  onSignIn,
  onBringKey,
  askForAccount = false,
}: {
  mode: ChainMode;
  draft: RegistrationDraft;
  onDraft: (draft: RegistrationDraft) => void;
  blockers: readonly string[];
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onSignIn: () => void;
  onBringKey: () => void;
  /**
   * Show the Hedera account field. Hidden by default: the account is the
   * service's to create. It appears only when the service answered that it
   * needs one, with the service's own sentence above it.
   */
  askForAccount?: boolean;
}) {
  const ready = blockers.length === 0 && !busy;
  const submit = () => {
    if (ready) onSubmit();
  };
  return (
    <AuthFrame mode={mode} title="Create your account" lead="We'll set up everything you need to start reviewing.">
      {/* No <form>: a submitted form with a password field asks the browser to save it, and that prompt must never appear on camera. */}
      <div className="grid gap-4">
        <Field id="register-name" label="Full name">
          <Input
            id="register-name"
            value={draft.fullName}
            onChange={(e) => onDraft({ ...draft, fullName: e.target.value })}
            onKeyDown={onEnter(submit)}
            disabled={busy}
            placeholder="Dr. Sarah Chen"
            autoComplete="name"
            className={FIELD}
          />
        </Field>
        <Field id="register-email" label="Email">
          <Input
            id="register-email"
            type="email"
            value={draft.email}
            onChange={(e) => onDraft({ ...draft, email: e.target.value })}
            onKeyDown={onEnter(submit)}
            disabled={busy}
            placeholder="sarah@example.com"
            autoComplete="email"
            spellCheck={false}
            className={FIELD}
          />
        </Field>
        <Field id="register-password" label="Password" help="This secures your account. Choose a strong one.">
          <Input
            id="register-password"
            type="password"
            value={draft.password}
            onChange={(e) => onDraft({ ...draft, password: e.target.value })}
            onKeyDown={onEnter(submit)}
            disabled={busy}
            placeholder={`At least ${String(PASSWORD_MIN_LENGTH)} characters`}
            autoComplete="new-password"
            aria-describedby="register-password-help"
            className={FIELD}
          />
        </Field>
        {askForAccount && (
        <Field
          id="register-account"
          label="Hedera testnet account"
          help="The service asked for the account you already have. The Hedera portal shows the id, like 0.0.12345, and gives out free test HBAR."
        >
          <Input
            id="register-account"
            value={draft.hederaAccountId}
            onChange={(e) => onDraft({ ...draft, hederaAccountId: e.target.value })}
            onKeyDown={onEnter(submit)}
            disabled={busy}
            placeholder="0.0.12345"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="register-account-help"
            className={`${FIELD} font-mono`}
          />
        </Field>
        )}

        <Divider>already have a Hedera account?</Divider>

        <Button type="button" variant="outline" className="h-[52px] w-full rounded-[10px] border-[1.5px] text-[14px] font-semibold" onClick={onBringKey} disabled={busy}>
          <Lock className="size-3.5" aria-hidden />
          Bring your own key
        </Button>

        <Failure title="Not created" message={error} />

        <div className="grid gap-2">
          <Button type="button" size="lg" className={PRIMARY} disabled={!ready} onClick={submit}>
            {busy ? "Creating…" : "Create account"}
            {!busy && <ChevronRight className="size-4" aria-hidden />}
          </Button>
          <Blockers blockers={blockers} busy={busy} />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <button type="button" onClick={onSignIn} className="font-semibold text-primary underline-offset-4 hover:underline">
            Sign in
          </button>
        </p>
      </div>
    </AuthFrame>
  );
}

function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="my-1 flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium tracking-[0.05em] whitespace-nowrap text-faint uppercase">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/* -------------------------------------------------------------- credential */

export type CredentialDomain = "finance" | "legal" | "engineering" | "medical";

export const DOMAINS: ReadonlyArray<{ readonly id: CredentialDomain; readonly label: string; readonly Icon: typeof CircleDollarSign }> = [
  { id: "finance", label: "Finance", Icon: CircleDollarSign },
  { id: "legal", label: "Legal", Icon: Layers },
  { id: "engineering", label: "Engineering", Icon: Wrench },
  { id: "medical", label: "Medical", Icon: CirclePlus },
];

/**
 * A static screen. Nothing typed here is stored or sent: certification is an
 * allowlist row set by the platform this week, and the honesty rules say so
 * out loud. The caption says it on screen so the demo never implies a
 * license number was checked.
 */
export function CredentialCard({
  mode,
  domain,
  onDomain,
  license,
  onLicense,
  onContinue,
  onBack,
}: {
  mode: ChainMode;
  domain: CredentialDomain;
  onDomain: (domain: CredentialDomain) => void;
  license: string;
  onLicense: (text: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <AuthFrame mode={mode} title="Your credential" lead="Every verdict you sign is published with the credential the platform lists for you.">
      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">Domain</span>
          <div role="radiogroup" aria-label="Domain" className="grid grid-cols-2 gap-2.5">
            {DOMAINS.map(({ id, label, Icon }) => {
              const checked = id === domain;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onDomain(id)}
                  className={`flex h-[52px] items-center gap-2.5 rounded-[10px] border-[1.5px] px-4 text-[14px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    checked ? "border-primary bg-primary/5 text-foreground" : "border-border bg-secondary text-foreground hover:border-muted-foreground"
                  }`}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <Field id="credential-license" label="CPA license number" help="Issued by your state board of accountancy.">
          <Input
            id="credential-license"
            value={license}
            onChange={(e) => onLicense(e.target.value)}
            onKeyDown={onEnter(onContinue)}
            placeholder="e.g. AC-0482716"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="credential-license-help"
            className={`${FIELD} font-mono`}
          />
        </Field>

        <Button type="button" size="lg" className={PRIMARY} onClick={onContinue}>
          Continue
          <ChevronRight className="size-4" aria-hidden />
        </Button>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-paid" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Not checked in this build. What you type here is not stored or sent anywhere; your credential is an
            allowlist entry set by the platform, and it is published with every verdict you sign.
          </p>
        </div>

        <button type="button" onClick={onBack} className="mx-auto flex items-center gap-1 text-[13px] font-medium text-primary underline-offset-4 hover:underline">
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
      </div>
    </AuthFrame>
  );
}

/* ------------------------------------------------------------------- setup */

export type SetupState = "todo" | "current" | "done" | "failed";

export interface SetupStep {
  readonly label: string;
  readonly state: SetupState;
}

/**
 * Real steps only. Each line lights up when the call behind it returns;
 * nothing here waits on a timer to look busy.
 */
export function SetupCard({ mode, steps, error, onBack }: { mode: ChainMode; steps: readonly SetupStep[]; error: string | null; onBack: () => void }) {
  return (
    <AuthFrame mode={mode} title="Setting up your account" lead="This takes a few seconds.">
      <ol className="grid gap-4" aria-label="Setup progress">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3.5" aria-current={step.state === "current" ? "step" : undefined}>
            <StepMark state={step.state} />
            <span
              className={`text-[15px] ${
                step.state === "done" ? "text-paid" : step.state === "failed" ? "text-destructive" : step.state === "current" ? "text-foreground" : "text-faint"
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
      {error !== null && (
        <div className="mt-6 grid gap-3">
          <Failure title="Setup stopped" message={error} />
          <Button type="button" variant="outline" className="h-10 rounded-[10px] text-[13px] font-semibold" onClick={onBack}>
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Button>
        </div>
      )}
    </AuthFrame>
  );
}

function StepMark({ state }: { state: SetupState }) {
  const ring =
    state === "done"
      ? "border-paid text-paid"
      : state === "failed"
        ? "border-destructive text-destructive"
        : state === "current"
          ? "border-primary/40 text-primary"
          : "border-border text-faint";
  return (
    <span className={`relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 ${ring}`} aria-hidden>
      {state === "current" && <span className="absolute inset-[-2px] animate-spin rounded-full border-2 border-transparent border-t-primary" />}
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : <span className="size-2 rounded-full border-2 border-current" />}
    </span>
  );
}

/* -------------------------------------------------------------------- code */

export function CodeCard({
  mode,
  email,
  hederaAccountId,
  onHederaAccountId,
  code,
  onCode,
  error,
  busy,
  resent,
  onConfirm,
  onResend,
  onBack,
}: {
  mode: ChainMode;
  /** Where the code went. Null when unknown, after a sign-in that was refused for an unconfirmed mailbox. */
  email: string | null;
  /** Null when the flow does not know it and has to ask, since a resend is addressed by account id. */
  hederaAccountId: string | null;
  onHederaAccountId?: ((text: string) => void) | undefined;
  code: string;
  onCode: (code: string) => void;
  error: string | null;
  busy: boolean;
  /** One line after a resend. */
  resent: string | null;
  onConfirm: () => void;
  onResend: () => void;
  onBack: () => void;
}) {
  const asksForAccount = onHederaAccountId !== undefined;
  const ready = code.trim().length === 6 && !busy && (!asksForAccount || (hederaAccountId ?? "") !== "");
  const confirm = () => {
    if (ready) onConfirm();
  };
  return (
    <AuthFrame
      mode={mode}
      title="Check your email"
      lead={email === null ? "Enter the six-digit code we sent you." : `We sent a six-digit code to ${email}.`}
    >
      <div className="grid gap-4">
        {asksForAccount && (
          <Field id="code-account" label="Hedera testnet account" help="The account you registered with. A new code is addressed to it.">
            <Input
              id="code-account"
              value={hederaAccountId ?? ""}
              onChange={(e) => onHederaAccountId(e.target.value)}
              disabled={busy}
              placeholder="0.0.12345"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="code-account-help"
              className={`${FIELD} font-mono`}
            />
          </Field>
        )}
        <Field id="code-digits" label="Code" help="It works for ten minutes.">
          <Input
            id="code-digits"
            value={code}
            onChange={(e) => onCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={onEnter(confirm)}
            disabled={busy}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            aria-describedby="code-digits-help"
            className={`${FIELD} font-mono text-[18px] tracking-[0.3em]`}
          />
        </Field>

        {resent !== null && (
          <p role="status" className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {resent}
          </p>
        )}
        <Failure title="Not confirmed" message={error} />

        <Button type="button" size="lg" className={PRIMARY} disabled={!ready} onClick={confirm}>
          {busy ? "Checking…" : "Confirm"}
          {!busy && <ChevronRight className="size-4" aria-hidden />}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Nothing arrived?{" "}
          <button type="button" onClick={onResend} disabled={busy} className="font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50">
            Send a new code
          </button>
        </p>

        <button type="button" onClick={onBack} className="mx-auto flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          Back
        </button>
      </div>
    </AuthFrame>
  );
}

/* ----------------------------------------------------------------- all set */

export function AllSetCard({ mode, next, onGo }: { mode: ChainMode; next: "inbox" | "key"; onGo: () => void }) {
  return (
    <AuthFrame
      mode={mode}
      title={
        <>
          <span className="mb-6 flex justify-center">
            <span className="flex size-20 items-center justify-center rounded-full bg-secondary text-paid" aria-hidden>
              <Check className="size-9" strokeWidth={2.5} />
            </span>
          </span>
          <span className="block text-paid">You're all set</span>
        </>
      }
      lead={next === "inbox" ? "Your inbox is ready. Pick a task and start reviewing." : "One more thing: signing needs your key. It stays in this tab, in memory only."}
    >
      <Button type="button" size="lg" className="h-[52px] w-full rounded-[10px] bg-paid text-[15px] font-semibold text-white hover:bg-paid/90" onClick={onGo}>
        {next === "inbox" ? "Go to inbox" : "Add your key"}
        <ChevronRight className="size-4" aria-hidden />
      </Button>
    </AuthFrame>
  );
}

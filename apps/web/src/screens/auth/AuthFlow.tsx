import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountsClient, RegistrationInput } from "@handoff/accounts-client";
import type { ChainMode } from "../../chain/config";
import {
  assessRegistration,
  describeAccountsError,
  EMPTY_REGISTRATION,
  splitFullName,
  usernameFrom,
  type AccountsSession,
  type RegistrationDraft,
} from "../../session/accounts";
import { lookupAccount, type AccountLookup } from "../../session/mirrorAccount";
import {
  AllSetCard,
  CodeCard,
  CredentialCard,
  RegisterCard,
  SetupCard,
  type CredentialDomain,
  type SetupState,
  type SetupStep,
} from "./AuthCards";
import { WelcomeCard, type WelcomePage } from "./WelcomeCard";

export type LookupFn = (accountId: string, signal: AbortSignal) => Promise<AccountLookup>;

/**
 * Where the flow starts. A new person registers; a person whose sign-in was
 * refused for an unconfirmed mailbox lands on the code screen with what is
 * known, and the flow asks for the account id if the sign-in did not say it.
 */
export type AuthStart =
  | { readonly kind: "register" }
  | {
      readonly kind: "verify";
      readonly identifier: string;
      readonly password: string;
      readonly hederaAccountId: string | null;
      readonly email: string | null;
    };

type Stage =
  | { kind: "register" }
  | { kind: "credential" }
  | { kind: "setup"; steps: readonly SetupStep[]; error: string | null }
  | { kind: "code"; hederaAccountId: string | null; email: string | null; identifier: string; password: string }
  | { kind: "welcome"; page: WelcomePage; session: AccountsSession }
  | { kind: "allset"; session: AccountsSession };

const CHECK_STEP = "Checking your Hedera account on testnet";
const SETUP_LABELS = [CHECK_STEP, "Creating your account", "Sending your email code", "All set"] as const;

/** With no account typed there is nothing to check, so that step is not listed. */
function stepsAt(current: number, failed = false, withCheck = true): readonly SetupStep[] {
  const labels = withCheck ? SETUP_LABELS : SETUP_LABELS.filter((label) => label !== CHECK_STEP);
  return labels.map((label, index) => {
    const state: SetupState = index < current ? "done" : index === current ? (failed ? "failed" : "current") : "todo";
    return { label, state };
  });
}

const defaultLookup: LookupFn = (accountId, signal) => lookupAccount(accountId, { fetch: (...args) => fetch(...args), signal });

/**
 * The email flow, from Create account to a session. Every call is real and
 * every step lights up when its call returns; the only thing here that is
 * not sent anywhere is the credential card, which says so on its face.
 *
 * The password lives in this component's state for the length of the flow so
 * the person is signed in the moment their mailbox is confirmed, rather than
 * typing it twice. It goes nowhere else and dies with the component.
 */
export function AuthFlow({
  mode,
  accounts,
  start,
  lookup = defaultLookup,
  onSignedIn,
  onCancel,
  onBringKey,
}: {
  mode: ChainMode;
  accounts: AccountsClient;
  start: AuthStart;
  lookup?: LookupFn;
  onSignedIn: (session: AccountsSession) => void;
  /** Back to the connect screen. */
  onCancel: () => void;
  /** Straight to the key path. */
  onBringKey: () => void;
}) {
  const [stage, setStage] = useState<Stage>(() =>
    start.kind === "register"
      ? { kind: "register" }
      : { kind: "code", hederaAccountId: start.hederaAccountId, email: start.email, identifier: start.identifier, password: start.password },
  );
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY_REGISTRATION);
  const [registerError, setRegisterError] = useState<string | null>(null);
  // The account field appears only once the service said it needs one.
  const [askForAccount, setAskForAccount] = useState(false);
  const [domain, setDomain] = useState<CredentialDomain>("finance");
  const [license, setLicense] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resent, setResent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether this component is still mounted, so a call that returns after
  // a Back or a cancel does not set state on nothing. Set in the effect body
  // as well as cleared in its cleanup, because StrictMode runs the cleanup
  // once on a simulated unmount and then mounts again.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const blockers = assessRegistration(draft);

  // The setup sequence. Each step is a real call, marked done as it returns.
  const runSetup = useCallback(async () => {
    const typedId = draft.hederaAccountId.trim();
    const withCheck = typedId !== "";
    const email = draft.email.trim();
    // Step numbers are of the full list; without a check every later step sits one earlier.
    const at = (n: number) => (withCheck ? n : n - 1);
    const advance = (n: number) => alive.current && setStage({ kind: "setup", steps: stepsAt(at(n), false, withCheck), error: null });
    const fail = (n: number, error: unknown) => {
      if (!alive.current) return;
      const failure = describeAccountsError(error);
      // The service needs the account after all: the form comes back with the field, and its sentence.
      if (failure.field === "hederaAccountId") setAskForAccount(true);
      setStage({ kind: "setup", steps: stepsAt(at(n), true, withCheck), error: failure.message });
    };

    if (withCheck) {
      advance(0);
      const found = await lookup(typedId, new AbortController().signal);
      if (found.status === "not-found") {
        return fail(0, new Error(`Account ${typedId} is not on testnet. Check the id, or create one at the Hedera portal first.`));
      }
      if (found.status === "found" && found.deleted) return fail(0, new Error(`Account ${typedId} has been deleted on testnet.`));
      // Unreachable is allowed through, as the server allows it: the server checks again.
    }

    advance(1);
    let sent: boolean;
    let accountId: string;
    try {
      const { firstName, lastName } = splitFullName(draft.fullName);
      // The wire type still names the account as required; the service is what
      // decides, and it answers `field: hederaAccountId` when it needs one
      // (docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md).
      const input = {
        email,
        username: usernameFrom(email, draft.fullName),
        firstName,
        ...(lastName === undefined ? {} : { lastName }),
        password: draft.password,
        ...(withCheck ? { hederaAccountId: typedId } : {}),
      } as RegistrationInput;
      const registered = await accounts.register(input);
      sent = registered.verification.sent;
      // The account the service settled on: the one typed, or the one it made.
      accountId = registered.account.hederaAccountId;
    } catch (error) {
      return fail(1, error);
    }

    advance(2);
    if (!sent) {
      // The account exists; only the code did not go. Ask for it again rather than calling registration failed.
      try {
        await accounts.requestVerification(accountId);
      } catch (error) {
        return fail(2, error);
      }
    }

    advance(3);
    if (!alive.current) return;
    setStage({ kind: "setup", steps: stepsAt(at(4), false, withCheck), error: null });
    // A beat so the last tick is seen, then the code screen. The only timer in the flow.
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (!alive.current) return;
    setCode("");
    setCodeError(null);
    setResent(null);
    setStage({ kind: "code", hederaAccountId: accountId, email, identifier: email, password: draft.password });
  }, [accounts, draft, lookup]);

  async function confirm(current: Extract<Stage, { kind: "code" }>) {
    const accountId = current.hederaAccountId?.trim() ?? "";
    if (accountId === "") return;
    setBusy(true);
    setCodeError(null);
    try {
      await accounts.confirmVerification(accountId, code.trim());
      const signedIn = await accounts.signIn(current.identifier, current.password);
      if (!alive.current) return;
      setStage({ kind: "welcome", page: 1, session: signedIn });
    } catch (error) {
      if (alive.current) setCodeError(describeAccountsError(error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function resend(current: Extract<Stage, { kind: "code" }>) {
    const accountId = current.hederaAccountId?.trim() ?? "";
    if (accountId === "") {
      setCodeError("Enter the Hedera account you registered with, so the new code can be addressed to it.");
      return;
    }
    setBusy(true);
    setCodeError(null);
    try {
      await accounts.requestVerification(accountId);
      if (alive.current) setResent("A new code is on its way. The old one no longer works.");
    } catch (error) {
      if (alive.current) setCodeError(describeAccountsError(error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  switch (stage.kind) {
    case "register":
      return (
        <RegisterCard
          mode={mode}
          draft={draft}
          onDraft={setDraft}
          blockers={blockers}
          error={registerError}
          busy={false}
          onSubmit={() => {
            setRegisterError(null);
            setStage({ kind: "credential" });
          }}
          onSignIn={onCancel}
          onBringKey={onBringKey}
          askForAccount={askForAccount}
        />
      );
    case "credential":
      return (
        <CredentialCard
          mode={mode}
          domain={domain}
          onDomain={setDomain}
          license={license}
          onLicense={setLicense}
          onContinue={() => void runSetup()}
          onBack={() => setStage({ kind: "register" })}
        />
      );
    case "setup":
      return (
        <SetupCard
          mode={mode}
          steps={stage.steps}
          error={stage.error}
          onBack={() => {
            // Back to the form with the failure beside it, so the fix is one edit away.
            setRegisterError(stage.error);
            setStage({ kind: "register" });
          }}
        />
      );
    case "code":
      return (
        <CodeCard
          mode={mode}
          email={stage.email}
          hederaAccountId={stage.hederaAccountId}
          onHederaAccountId={
            start.kind === "verify" && start.hederaAccountId === null
              ? (text) => setStage({ ...stage, hederaAccountId: text })
              : undefined
          }
          code={code}
          onCode={setCode}
          error={codeError}
          busy={busy}
          resent={resent}
          onConfirm={() => void confirm(stage)}
          onResend={() => void resend(stage)}
          onBack={onCancel}
        />
      );
    case "welcome":
      return (
        <WelcomeCard
          mode={mode}
          name={stage.session.account.firstName}
          page={stage.page}
          onNext={() =>
            stage.page === 3
              ? setStage({ kind: "allset", session: stage.session })
              : setStage({ ...stage, page: (stage.page + 1) as WelcomePage })
          }
          onBack={() => stage.page > 1 && setStage({ ...stage, page: (stage.page - 1) as WelcomePage })}
          onSkip={() => setStage({ kind: "allset", session: stage.session })}
        />
      );
    case "allset":
      return <AllSetCard mode={mode} next={mode === "testnet" ? "key" : "inbox"} onGo={() => onSignedIn(stage.session)} />;
  }
}

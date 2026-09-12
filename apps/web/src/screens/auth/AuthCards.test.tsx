import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_REGISTRATION } from "../../session/accounts";
import { expectNoBannedWords } from "../fixtures";
import { AllSetCard, CodeCard, CredentialCard, RegisterCard, SetupCard } from "./AuthCards";
import { WelcomeCard } from "./WelcomeCard";

const noop = () => {};

describe("Create account", () => {
  it("asks for a name, an email, a password and the Hedera account, and says the app never makes one", () => {
    const html = renderToStaticMarkup(
      <RegisterCard mode="testnet" draft={EMPTY_REGISTRATION} onDraft={noop} blockers={["Enter your name."]} error={null} busy={false} onSubmit={noop} onSignIn={noop} onBringKey={noop} />,
    );
    expect(html).toContain("Create your account");
    for (const label of ["Full name", "Email", "Password"]) expect(html).toContain(label);
    // The account is the service's to create; the field is not offered unless the service asks.
    expect(html).not.toContain("Hedera testnet account");
    expect(html).not.toContain("register-account");
    expect(html).toContain("Bring your own key");
    expect(html).toContain("Enter your name.");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Create account/);
    // No <form>: a submitted form with a password field is what asks the browser to save it.
    expect(html).not.toContain("<form");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("asks for the Hedera account only once the service said it needs one", () => {
    const html = renderToStaticMarkup(
      <RegisterCard mode="testnet" draft={EMPTY_REGISTRATION} onDraft={noop} blockers={[]} error="hederaAccountId is required" busy={false} onSubmit={noop} onSignIn={noop} onBringKey={noop} askForAccount />,
    );
    expect(html).toContain("Hedera testnet account");
    expect(html).toContain("register-account");
    expect(html).toContain("The service asked for the account you already have.");
  });

  it("shows the service's refusal under the form", () => {
    const html = renderToStaticMarkup(
      <RegisterCard mode="testnet" draft={EMPTY_REGISTRATION} onDraft={noop} blockers={[]} error="That Hedera account is already registered. Sign in instead." busy={false} onSubmit={noop} onSignIn={noop} onBringKey={noop} />,
    );
    expect(html).toContain("already registered");
  });
});

describe("Your credential", () => {
  it("is a static form that says so: nothing checked, nothing stored, an allowlist entry", () => {
    const html = renderToStaticMarkup(
      <CredentialCard mode="testnet" domain="finance" onDomain={noop} license="" onLicense={noop} onContinue={noop} onBack={noop} />,
    );
    expect(html).toContain("Your credential");
    for (const domain of ["Finance", "Legal", "Engineering", "Medical"]) expect(html).toContain(domain);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("CPA license number");
    expect(html).toContain("Not checked in this build.");
    expect(html).toContain("not stored or sent anywhere");
    expect(html).toContain("allowlist entry set by the platform");
    // Never a claim that a credential was verified. The honesty rules ban it.
    expect(html).not.toMatch(/verified professional/i);
    expect(expectNoBannedWords(html)).toEqual([]);
  });
});

describe("Setting up your account", () => {
  it("lists real steps only, lit as their calls return, and never a signing setup", () => {
    const html = renderToStaticMarkup(
      <SetupCard
        mode="testnet"
        steps={[
          { label: "Checking your Hedera account on testnet", state: "done" },
          { label: "Creating your account", state: "current" },
          { label: "Sending your email code", state: "todo" },
        ]}
        error={null}
        onBack={noop}
      />,
    );
    expect(html).toContain("Checking your Hedera account on testnet");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("animate-spin");
    expect(html).not.toMatch(/secure signing|registering your credential/i);
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("stops with the failure and a way back", () => {
    const html = renderToStaticMarkup(
      <SetupCard mode="testnet" steps={[{ label: "Creating your account", state: "failed" }]} error="That account is not on testnet." onBack={noop} />,
    );
    expect(html).toContain("Setup stopped");
    expect(html).toContain("not on testnet");
    expect(html).toContain("Back");
  });
});

describe("Check your email", () => {
  it("names the mailbox, takes six digits, and offers a new code", () => {
    const html = renderToStaticMarkup(
      <CodeCard mode="testnet" email="sarah@example.com" hederaAccountId="0.0.12345" code="12" onCode={noop} error={null} busy={false} resent={null} onConfirm={noop} onResend={noop} onBack={noop} />,
    );
    expect(html).toContain("sarah@example.com");
    expect(html).toMatch(/autocomplete="one-time-code"/i);
    expect(html).toContain("Send a new code");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Confirm/);
    expect(html).not.toContain("code-account");
  });

  it("asks for the account when a sign-in by email was refused for an unconfirmed mailbox", () => {
    const html = renderToStaticMarkup(
      <CodeCard mode="testnet" email={null} hederaAccountId="" onHederaAccountId={noop} code="" onCode={noop} error={null} busy={false} resent={null} onConfirm={noop} onResend={noop} onBack={noop} />,
    );
    expect(html).toContain("code-account");
    expect(html).toContain("Enter the six-digit code we sent you.");
  });
});

describe("the welcome panes", () => {
  it("say what the build does and nothing it does not", () => {
    for (const page of [1, 2, 3] as const) {
      const html = renderToStaticMarkup(<WelcomeCard mode="testnet" name="Sarah" page={page} onNext={noop} onBack={noop} onSkip={noop} />);
      expect(html).toContain("Welcome");
      expect(html).toContain("Sarah");
      expect(html).toContain(`Step ${String(page)} of 3`);
      expect(expectNoBannedWords(html)).toEqual([]);
      // Pay on any verdict ships. Closed incentives do not, and are not claimed.
      expect(html).not.toMatch(/incentive|symmetry|scarce/i);
    }
    const last = renderToStaticMarkup(<WelcomeCard mode="testnet" name="Sarah" page={3} onNext={noop} onBack={noop} onSkip={noop} />);
    expect(last).toContain("Reject");
    expect(last).toContain("Approve");
    expect(last).toContain("Paid to you");
    expect(last).toContain("Open inbox");
  });
});

describe("You're all set", () => {
  it("goes to the inbox on the mock, and to the key on testnet, saying why", () => {
    expect(renderToStaticMarkup(<AllSetCard mode="mock" next="inbox" onGo={noop} />)).toContain("Go to inbox");
    const testnet = renderToStaticMarkup(<AllSetCard mode="testnet" next="key" onGo={noop} />);
    expect(testnet).toContain("Add your key");
    expect(testnet).toContain("in memory only");
  });
});

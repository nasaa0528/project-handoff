import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectCard } from "./ConnectScreen";
import { expectNoBannedWords } from "./fixtures";

const base = {
  lookupPending: false,
  keyShape: null,
  keyField: "masked" as const,
  error: null,
  notice: null,
  busy: false,
  onAccountIdChange: () => {},
  onKeyChange: () => {},
  onRetryLookup: () => {},
  onConnect: () => {},
};
const assessment = (accountId: string | null, ready: boolean) => ({
  accountId,
  blockers: ready ? [] : ["Enter your account id, like 0.0.12345."],
  warnings: [],
  keyType: null,
  ready,
});
const found = {
  status: "found" as const,
  accountId: "0.0.12345",
  keyType: "ECDSA_SECP256K1" as const,
  publicKey: "02ab",
  balanceTinybars: "100000000000",
  deleted: false,
};
const credential = { label: "Certified Accountant", tag: "cert:accounting-cpa" };

const email = {
  identifier: "",
  password: "",
  busy: false,
  error: null,
  blockers: ["Enter your email.", "Enter your password."],
  onIdentifier: () => {},
  onPassword: () => {},
  onSubmit: () => {},
  onCreateAccount: () => {},
};

describe("the sign-in card", () => {
  it("leads with the email form, then the divider, then the collapsed Hedera panel, when an accounts API is configured", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} email={email} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} credential={credential} />,
    );
    expect(html).toContain("Sign in as an expert");
    expect(html).toContain("Review work, sign your verdict, get paid.");
    // Two collapsed panels behind two buttons; the fields exist but are inert until asked for.
    expect(html).toContain("Sign in with email");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="connect-email-panel"/);
    expect(html).toContain("connect-email");
    expect(html).toContain("connect-password");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Sign in/);
    expect(html).toContain("already have a Hedera account?");
    expect(html).toContain("Sign in with Hedera");
    expect(html).toContain("Create an account");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("grid-rows-[0fr]");
    expect(html).toContain('inert=""');
    // No <form> anywhere: a submitted form with a password field asks the browser to save it.
    expect(html).not.toContain("<form");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("opens the email panel by itself when something is already typed or a refusal is showing", () => {
    const typed = renderToStaticMarkup(
      <ConnectCard {...base} email={{ ...email, identifier: "me@example.com" }} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} />,
    );
    // Open means the button has given way to the fields: one Sign in on the card, not two.
    expect(typed).not.toContain("Sign in with email");
    expect(typed).toMatch(/id="connect-email-panel"[^>]*grid-rows-\[1fr\]/);
    const refused = renderToStaticMarkup(
      <ConnectCard {...base} email={{ ...email, error: "Those credentials are not right." }} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} />,
    );
    expect(refused).not.toContain("Sign in with email");
    expect(refused).toMatch(/id="connect-email-panel"[^>]*grid-rows-\[1fr\]/);
  });

  it("offers the key path only, already open, when there is no accounts API", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} credential={credential} />,
    );
    expect(html).not.toContain("connect-email");
    expect(html).not.toContain("Create an account");
    // The panel is open and live; only the credential slot below it is collapsed.
    expect(html).toContain("grid-rows-[1fr]");
    expect(html).not.toContain('inert=""');
    expect(html).toContain("connect-private-key");
  });

  it("shows the refusal under the email button, in the app's words", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} email={{ ...email, error: "Those credentials are not right." }} mode="testnet" accountIdText="" assessment={assessment(null, false)} lookup={null} />,
    );
    expect(html).toContain("Not signed in");
    expect(html).toContain("Those credentials are not right.");
  });

  it("locks the account and asks only for the key once an email session settled who is signing", () => {
    const html = renderToStaticMarkup(
      // lookup null: the chip's own "ECDSA key" wording is the existing card's, and not under test here.
      <ConnectCard {...base} locked onBack={() => {}} mode="testnet" accountIdText="0.0.12345" assessment={assessment("0.0.12345", false)} lookup={null} />,
    );
    expect(html).toContain("One more thing: your key");
    const account = /<input[^>]*id="connect-account-id"[^>]*>/.exec(html)?.[0] ?? "";
    expect(account).toMatch(/readonly=""/i);
    expect(account).toContain('value="0.0.12345"');
    expect(html).toContain("The account you registered.");
    expect(html).not.toContain("connect-email");
    expect(html).toContain("connect-private-key");
    expect(html).toContain("Back");
    expect(expectNoBannedWords(html)).toEqual([]);
  });

  it("opens the panel when an id is already there, and hides the credential until the network found it", () => {
    const typing = renderToStaticMarkup(
      <ConnectCard {...base} email={email} mode="testnet" accountIdText="0.0.123" assessment={assessment(null, false)} lookup={null} credential={credential} />,
    );
    expect(typing).toContain('aria-expanded="true"');
    // The panel is open; the credential slot is the collapsed one.
    expect(typing).toContain("grid-rows-[1fr]");
    expect(typing).toContain("grid-rows-[0fr]");
    // The card's markup is present so it can grow in; the slot is collapsed
    // and aria-hidden, so nothing reads it out.

    const confirmed = renderToStaticMarkup(
      <ConnectCard {...base} email={email} mode="testnet" accountIdText="0.0.12345" assessment={assessment("0.0.12345", false)} lookup={found} credential={credential} />,
    );
    expect(confirmed).toContain("Certified Accountant");
    expect(confirmed).toContain("cert:accounting-cpa");
    expect(confirmed).toContain("grid-rows-[1fr]");
    // The only collapsed thing left is the email panel; the credential slot has grown in.
    expect(confirmed.match(/grid-rows-\[0fr\]/g)).toHaveLength(1);
  });

  it("shows the credential on the mock as soon as the id parses, and no key field", () => {
    const html = renderToStaticMarkup(
      <ConnectCard {...base} mode="mock" accountIdText="0.0.12345" assessment={assessment("0.0.12345", true)} lookup={null} credential={credential} />,
    );
    expect(html).toContain("Certified Accountant");
    expect(html).not.toContain("connect-private-key");
    expect(html).toContain("Continue as 0.0.12345");
  });

  it("still says the key rules, and still names a rejected key without printing it", () => {
    const html = renderToStaticMarkup(
      <ConnectCard
        {...base}
        mode="testnet"
        accountIdText="0.0.12345"
        assessment={assessment("0.0.12345", false)}
        lookup={found}
        keyShape={{ ok: false, reason: "invalid private key: [withheld]" }}
        credential={credential}
      />,
    );
    expect(html).toContain("in memory only");
    expect(html).toContain("cannot touch the money in escrow");
    expect(html).toContain("invalid private key: [withheld]");
  });
});

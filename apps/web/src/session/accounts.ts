/**
 * The email side of signing in, as pure rules.
 *
 * Identity in this product is the Hedera account; an email account is a
 * profile hanging off it, keyed on the account id, and it holds no key
 * (docs/decisions/2026-09-10-registration-keyed-on-the-hedera-account.md).
 * So a session here proves who is at the keyboard and nothing about signing:
 * on testnet the key is still pasted, once, into the holder, after this.
 *
 * Every rule below is a table test. The server is the authority on all of
 * them — its own refusal, in its own words, is what the form shows when it
 * disagrees — and the client-side checks exist so the obvious cases never
 * make a round trip.
 */

import { AccountsApiError, type AccountProfile } from "@handoff/accounts-client";
import { parseAccountId } from "./accountId";

/** Mirrors packages/accounts/src/password.ts. The server's message wins on refusal. */
export const PASSWORD_MIN_LENGTH = 10;
/** Mirrors packages/accounts/src/account.ts. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/** A signed-in person. The token is opaque and lives in memory only, like the key. */
export interface AccountsSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly account: AccountProfile;
}

export interface RegistrationDraft {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly hederaAccountId: string;
}

export const EMPTY_REGISTRATION: RegistrationDraft = { fullName: "", email: "", password: "", hederaAccountId: "" };

/** "Dr. Sarah Chen" → first "Dr. Sarah", last "Chen". One word is a first name with no surname. */
export function splitFullName(fullName: string): { firstName: string; lastName?: string } {
  const words = fullName.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length <= 1) return { firstName: words[0] ?? "" };
  const lastName = words[words.length - 1] ?? "";
  return { firstName: words.slice(0, -1).join(" "), lastName };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A username the server will take, derived rather than asked for: the form
 * has no username field because nobody signs a verdict with one. The email's
 * local part, kept to the server's alphabet, starting with a letter, padded
 * to the minimum. The server still has the last word (a reserved name is
 * refused there), and the profile shows whatever it settled on.
 */
export function usernameFrom(email: string, fullName: string): string {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const fromEmail = local.replace(/[^a-z0-9_]/g, "");
  const fromName = fullName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  let candidate = fromEmail !== "" ? fromEmail : fromName;
  candidate = candidate.replace(/^[^a-z]+/, "");
  if (candidate === "") candidate = "expert";
  while (candidate.length < USERNAME_MIN_LENGTH) candidate += "_";
  return candidate.slice(0, USERNAME_MAX_LENGTH);
}

/** Why Create account is disabled, in the order the person would fix things. Empty means ready. */
export function assessRegistration(draft: RegistrationDraft): readonly string[] {
  const blockers: string[] = [];
  if (draft.fullName.trim() === "") blockers.push("Enter your name.");
  if (!EMAIL.test(draft.email.trim())) blockers.push("Enter an email address, like you@example.com.");
  if (draft.password.length < PASSWORD_MIN_LENGTH) {
    blockers.push(`Choose a password of at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  // Blank is allowed: the account is the service's to create when it can
  // (docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md), and
  // until then the service says so and the form asks. Typed, it has to parse.
  if (draft.hederaAccountId.trim() !== "") {
    const id = parseAccountId(draft.hederaAccountId);
    if (!id.ok) blockers.push(id.reason);
  }
  return blockers;
}

/** Why Sign in is disabled. The identifier may be an email, a username or an account id; the server decides. */
export function assessSignIn(identifier: string, password: string): readonly string[] {
  const blockers: string[] = [];
  if (identifier.trim() === "") blockers.push("Enter your email.");
  if (password === "") blockers.push("Enter your password.");
  return blockers;
}

const CODE = /^\d{6}$/;

export function isCodeShape(code: string): boolean {
  return CODE.test(code.trim());
}

export interface AccountsFailure {
  readonly message: string;
  /** Which input to point at, when the server named exactly one. */
  readonly field?: string;
  /** The session is gone; go back to sign-in. */
  readonly needsSignIn: boolean;
  /** The password was right and the mailbox is not confirmed. A route, not an error. */
  readonly needsVerification: boolean;
  /** The code is dead; a new one has to be requested. */
  readonly codeDead: boolean;
}

/**
 * What the screen says when the accounts service refused or did not answer.
 * Branches on the code, never the message, as the client's own doc insists;
 * the server's sentence is kept where it is the more useful one.
 */
export function describeAccountsError(error: unknown): AccountsFailure {
  const base = { needsSignIn: false, needsVerification: false, codeDead: false };
  if (!(error instanceof AccountsApiError)) {
    return { ...base, message: error instanceof Error ? error.message : String(error) };
  }
  const field = error.field === undefined ? {} : { field: error.field };
  switch (error.code) {
    case "invalid_credentials":
      // Deliberately covers a wrong password and an account that does not
      // exist, so sign-in is not a "is this a registered expert" oracle.
      return { ...base, message: "Those credentials are not right." };
    case "email_not_verified":
      return { ...base, needsVerification: true, message: "Confirm your email address first." };
    case "unauthenticated":
      return { ...base, needsSignIn: true, message: "Your session has ended. Sign in again." };
    case "code_invalid":
      return { ...base, ...field, message: "That code is not right. Check the six digits and try again." };
    case "code_expired":
    case "too_many_attempts":
      return { ...base, codeDead: true, message: "That code no longer works. Send a new one." };
    case "rate_limited": {
      const wait = error.retryAfterSeconds;
      return {
        ...base,
        message: wait === undefined ? "Too many attempts. Wait a moment and try again." : `Too many attempts. Try again in ${String(wait)} seconds.`,
      };
    }
    case "account_exists":
      return { ...base, ...field, message: "That Hedera account is already registered. Sign in instead." };
    case "unknown_hedera_account":
      return {
        ...base,
        ...field,
        message: "That account is not on testnet. Check the id, or create one at the Hedera portal first.",
      };
    case "validation_failed":
      // The one refusal the form does not pre-empt: it does not ask for the
      // account, because the service is meant to create one. Until it does,
      // this is how it says it needs the one the person already has.
      if (error.field === "hederaAccountId") {
        return { ...base, ...field, message: "The service needs the Hedera testnet account you already have. Enter it below." };
      }
      return { ...base, ...field, message: error.message };
    default:
      if (error.status === 0) {
        return {
          ...base,
          message:
            "The accounts service did not answer. It is either not running or refused this page's origin. Nothing was sent.",
        };
      }
      return { ...base, ...field, message: error.message };
  }
}

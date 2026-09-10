/**
 * A typed client for `apps/accounts-api`. Zero dependencies, `fetch` only.
 *
 * Nothing here holds state. The token is passed in on every authenticated call
 * rather than stashed on the instance, because where a session token lives is
 * `apps/web`'s decision and not this package's — and a client that quietly held
 * one would make "am I signed in" two answers instead of one.
 */

import {
  AccountsApiError,
  type AccountProfile,
  type AccountsErrorBody,
  type AccountsErrorCode,
  type ConfirmationResponse,
  type ProfilePatchInput,
  type ProfileResponse,
  type RegistrationInput,
  type RegistrationResponse,
  type SignInResponse,
  type VerificationResponse,
} from "./types.js";

/** Every code the server can send, so an unknown one is not silently trusted. */
const KNOWN_CODES: ReadonlySet<string> = new Set<AccountsErrorCode>([
  "validation_failed",
  "weak_password",
  "reserved_username",
  "unknown_hedera_account",
  "code_invalid",
  "malformed_json",
  "unauthenticated",
  "invalid_credentials",
  "email_not_verified",
  "account_not_found",
  "not_found",
  "method_not_allowed",
  "account_exists",
  "code_expired",
  "body_too_large",
  "too_many_attempts",
  "rate_limited",
  "internal",
]);

export interface AccountsClientOptions {
  /** e.g. `http://localhost:8788`. A trailing slash is fine. */
  readonly baseUrl: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

export class AccountsClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: AccountsClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    // Bound to globalThis: an unbound `fetch` reference throws "Illegal
    // invocation" in a browser when called as a method of something else.
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  async health(): Promise<{ status: string }> {
    return this.#request<{ status: string }>("GET", "/health");
  }

  /** 201. The verification code is mailed, never returned here. */
  async register(input: RegistrationInput): Promise<RegistrationResponse> {
    return this.#request<RegistrationResponse>("POST", "/v1/accounts", input);
  }

  /** 202. Sends a fresh code and invalidates whatever was pending. */
  async requestVerification(hederaAccountId: string): Promise<VerificationResponse> {
    return this.#request<VerificationResponse>("POST", "/v1/accounts/verification/request", {
      hederaAccountId,
    });
  }

  /**
   * Confirms the six-digit code.
   *
   * `code_invalid` is worth another try; `code_expired` and `too_many_attempts`
   * both mean the code is dead and the user needs `requestVerification`.
   */
  async confirmVerification(hederaAccountId: string, code: string): Promise<ConfirmationResponse> {
    return this.#request<ConfirmationResponse>("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId,
      code,
    });
  }

  /**
   * `identifier` may be the Hedera account id, the email or the username.
   *
   * Two failures to expect: `invalid_credentials` covers both a wrong password
   * and an account that does not exist — deliberately indistinguishable, so do
   * not try to tell the user which — and `email_not_verified` means the password
   * was right and the mailbox is not confirmed, which is a route to the verify
   * screen rather than an error on the form.
   */
  async signIn(identifier: string, password: string): Promise<SignInResponse> {
    return this.#request<SignInResponse>("POST", "/v1/sessions", { identifier, password });
  }

  /** 204, and idempotent. Safe to call with a token already discarded. */
  async signOut(token: string): Promise<void> {
    await this.#request<null>("DELETE", "/v1/sessions/current", undefined, token);
  }

  async getProfile(token: string): Promise<AccountProfile> {
    const body = await this.#request<ProfileResponse>("GET", "/v1/accounts/me", undefined, token);
    return body.account;
  }

  /** At least one field must be present, or the server answers `validation_failed`. */
  async updateProfile(token: string, patch: ProfilePatchInput): Promise<AccountProfile> {
    const body = await this.#request<ProfileResponse>("PATCH", "/v1/accounts/me", patch, token);
    return body.account;
  }

  async #request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token !== undefined) headers["Authorization"] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      // Status 0 for "never reached the server", so a caller can tell a network
      // problem from a refusal. A CORS rejection also lands here, and the fix
      // for that is HANDOFF_ACCOUNTS_CORS_ORIGINS on the server, not this code.
      throw new AccountsApiError(
        "internal",
        `could not reach the accounts API at ${this.#baseUrl}: ${(error as Error).message}`,
        0,
      );
    }

    if (response.status === 204) return null as T;

    if (!response.ok) throw await this.#toError(response);

    try {
      return (await response.json()) as T;
    } catch {
      throw new AccountsApiError("internal", "the accounts API returned a body that is not JSON", response.status);
    }
  }

  async #toError(response: Response): Promise<AccountsApiError> {
    // A body that is not the documented shape must still produce a usable error
    // rather than a TypeError from reading `.error.code` of undefined — this path
    // runs exactly when something is already wrong.
    let parsed: AccountsErrorBody | undefined;
    try {
      parsed = (await response.json()) as AccountsErrorBody;
    } catch {
      parsed = undefined;
    }

    const raw = parsed?.error?.code;
    const code: AccountsErrorCode =
      typeof raw === "string" && KNOWN_CODES.has(raw) ? (raw as AccountsErrorCode) : "internal";

    const message =
      parsed?.error?.message ?? `the accounts API answered ${String(response.status)}`;

    const retryAfter = Number(response.headers.get("Retry-After"));

    return new AccountsApiError(
      code,
      message,
      response.status,
      parsed?.error?.field,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
}

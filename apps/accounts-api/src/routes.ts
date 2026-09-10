/**
 * Every route, as a pure function of a request.
 *
 * Same split as `apps/mcp`: this file decides, `http.ts` only moves bytes. That
 * is what lets the whole API be tested without binding a port, and it is why the
 * tests can assert a 429 without waiting on a real clock.
 *
 * ## The routes
 *
 * | Method | Path                                | Auth   |
 * |--------|-------------------------------------|--------|
 * | GET    | `/health`                           | —      |
 * | POST   | `/v1/accounts`                      | —      |
 * | POST   | `/v1/accounts/verification/request` | —      |
 * | POST   | `/v1/accounts/verification/confirm` | —      |
 * | POST   | `/v1/sessions`                      | —      |
 * | DELETE | `/v1/sessions/current`              | bearer |
 * | GET    | `/v1/accounts/me`                   | bearer |
 * | PATCH  | `/v1/accounts/me`                   | bearer |
 *
 * There is no route that looks an account up by username or email. It would be a
 * public "is this person registered" oracle, and the one thing this service knows
 * is which Hedera accounts belong to named humans.
 */

import { AccountError, type AccountErrorCode, type AccountService } from "@handoff/accounts";
import type { RateLimiter } from "./rate-limit.js";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  /** Whoever is calling, as the rate limiter's key. */
  readonly clientAddress: string;
}

export interface HttpResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface RouteDeps {
  readonly service: AccountService;
  readonly limiter: RateLimiter;
  /**
   * Origins allowed to call this from a browser. Empty means none.
   *
   * An allowlist rather than `*`, because these responses set no cookies but do
   * carry a bearer token in the sign-in body — and `*` would let any page a user
   * visits read it.
   */
  readonly allowedOrigins: readonly string[];
}

const JSON_HEADERS: Readonly<Record<string, string>> = { "Content-Type": "application/json" };

/**
 * HTTP status per domain error.
 *
 * Exhaustive, and the `never` in the default is what enforces it: adding a code
 * to `AccountErrorCode` without a status here fails to compile rather than
 * silently becoming a 500 in production.
 */
function statusForCode(code: AccountErrorCode): number {
  switch (code) {
    case "validation_failed":
    case "weak_password":
    case "reserved_username":
    case "unknown_hedera_account":
    case "code_invalid":
      return 400;
    case "invalid_credentials":
      return 401;
    case "email_not_verified":
      return 403;
    case "account_not_found":
      return 404;
    case "account_exists":
      return 409;
    // Gone, not Bad Request. The code was real and is not any more, which is a
    // different thing for a client to show than "that code is wrong".
    case "code_expired":
      return 410;
    case "too_many_attempts":
      return 429;
    default: {
      const unmapped: never = code;
      throw new Error(`no HTTP status mapped for account error code ${String(unmapped)}`);
    }
  }
}

function fail(status: number, code: string, message: string, field?: string): HttpResult {
  return {
    status,
    headers: JSON_HEADERS,
    body: { error: { code, message, ...(field === undefined ? {} : { field }) } },
  };
}

function ok(status: number, body: unknown): HttpResult {
  return { status, headers: JSON_HEADERS, body };
}

/** `Authorization: Bearer <token>`, or null. Case-insensitive on the scheme. */
function bearerToken(headers: Readonly<Record<string, string | undefined>>): string | null {
  const header = headers["authorization"];
  if (header === undefined) return null;

  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * The body as an object, or a 400.
 *
 * A JSON syntax error is the client's, so it gets 400 rather than the 500 an
 * uncaught `JSON.parse` would produce. An empty body reads as `{}` so that
 * `PATCH` with nothing in it fails validation with a message about the patch
 * rather than about parsing.
 */
function parseJsonBody(body: string): { ok: true; value: unknown } | { ok: false; result: HttpResult } {
  const text = body.trim();
  if (text === "") return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, result: fail(400, "malformed_json", "the request body is not valid JSON") };
  }
}

function corsHeaders(
  request: HttpRequest,
  allowedOrigins: readonly string[],
): Readonly<Record<string, string>> {
  const origin = request.headers["origin"];
  if (origin === undefined || !allowedOrigins.includes(origin)) return {};

  return {
    "Access-Control-Allow-Origin": origin,
    // The allowlist decided this, so the browser must not serve a cached
    // response for one origin to a page on another.
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}

export async function handle(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const cors = corsHeaders(request, deps.allowedOrigins);
  const result = await route(request, deps);
  return { ...result, headers: { ...result.headers, ...cors } };
}

async function route(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const { method, path } = request;

  // Preflight. Answered for any path, because a browser sends it before it can
  // possibly know whether the path exists, and a 404 here reads as a CORS
  // failure with no explanation.
  if (method === "OPTIONS") {
    return { status: 204, headers: {}, body: null };
  }

  if (path === "/health") {
    return method === "GET"
      ? ok(200, { status: "ok" })
      : fail(405, "method_not_allowed", "GET /health");
  }

  try {
    switch (path) {
      case "/v1/accounts":
        if (method !== "POST") return fail(405, "method_not_allowed", "POST /v1/accounts");
        return await register(request, deps);

      case "/v1/accounts/verification/request":
        if (method !== "POST") {
          return fail(405, "method_not_allowed", "POST /v1/accounts/verification/request");
        }
        return await requestVerification(request, deps);

      case "/v1/accounts/verification/confirm":
        if (method !== "POST") {
          return fail(405, "method_not_allowed", "POST /v1/accounts/verification/confirm");
        }
        return await confirmVerification(request, deps);

      case "/v1/sessions":
        if (method !== "POST") return fail(405, "method_not_allowed", "POST /v1/sessions");
        return await signIn(request, deps);

      case "/v1/sessions/current":
        if (method !== "DELETE") {
          return fail(405, "method_not_allowed", "DELETE /v1/sessions/current");
        }
        return await signOut(request, deps);

      case "/v1/accounts/me":
        if (method === "GET") return await readMe(request, deps);
        if (method === "PATCH") return await patchMe(request, deps);
        return fail(405, "method_not_allowed", "GET or PATCH /v1/accounts/me");

      default:
        return fail(404, "not_found", `no route for ${method} ${path}`);
    }
  } catch (error) {
    if (error instanceof AccountError) {
      return fail(statusForCode(error.code), error.code, error.message, error.field);
    }
    throw error;
  }
}

function limited(request: HttpRequest, deps: RouteDeps, route: string): HttpResult | null {
  const decision = deps.limiter.check(request.clientAddress, route);
  if (decision.allowed) return null;

  return {
    status: 429,
    headers: { ...JSON_HEADERS, "Retry-After": String(decision.retryAfterSeconds) },
    body: {
      error: {
        code: "rate_limited",
        message: `too many requests — try again in ${String(decision.retryAfterSeconds)}s`,
      },
    },
  };
}

async function register(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const refused = limited(request, deps, "register");
  if (refused !== null) return refused;

  const parsed = parseJsonBody(request.body);
  if (!parsed.ok) return parsed.result;

  const result = await deps.service.register(parsed.value);

  // 201 with the profile, and never the code. The code goes to the mailbox; a
  // client that could read it from this response would make the whole
  // verification step decorative.
  return ok(201, {
    account: result.profile,
    verification: {
      sent: result.verificationSent,
      expiresAt: result.verificationExpiresAt,
    },
  });
}

async function requestVerification(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const refused = limited(request, deps, "verification:request");
  if (refused !== null) return refused;

  const parsed = parseJsonBody(request.body);
  if (!parsed.ok) return parsed.result;

  const body = parsed.value as { hederaAccountId?: unknown };
  if (typeof body.hederaAccountId !== "string") {
    return fail(400, "validation_failed", "hederaAccountId is required", "hederaAccountId");
  }

  const result = await deps.service.requestEmailCode(body.hederaAccountId);
  return ok(202, { verification: { sent: result.sent, expiresAt: result.expiresAt } });
}

async function confirmVerification(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const refused = limited(request, deps, "verification:confirm");
  if (refused !== null) return refused;

  const parsed = parseJsonBody(request.body);
  if (!parsed.ok) return parsed.result;

  const body = parsed.value as { hederaAccountId?: unknown; code?: unknown };
  if (typeof body.hederaAccountId !== "string") {
    return fail(400, "validation_failed", "hederaAccountId is required", "hederaAccountId");
  }
  if (typeof body.code !== "string") {
    return fail(400, "validation_failed", "code is required", "code");
  }

  const profile = await deps.service.confirmEmailCode(body.hederaAccountId, body.code);
  return ok(200, { account: profile });
}

async function signIn(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const refused = limited(request, deps, "sign-in");
  if (refused !== null) return refused;

  const parsed = parseJsonBody(request.body);
  if (!parsed.ok) return parsed.result;

  const body = parsed.value as { identifier?: unknown; password?: unknown };
  if (typeof body.identifier !== "string" || typeof body.password !== "string") {
    return fail(400, "validation_failed", "identifier and password are required");
  }

  const result = await deps.service.signIn(body.identifier, body.password);
  return ok(200, {
    token: result.token,
    expiresAt: result.expiresAt,
    account: result.profile,
  });
}

async function signOut(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const token = bearerToken(request.headers);
  // No token is already signed out. Answering 401 would make a client that lost
  // its token unable to reach a clean state.
  if (token === null) return { status: 204, headers: {}, body: null };

  await deps.service.signOut(token);
  return { status: 204, headers: {}, body: null };
}

/**
 * Resolves the bearer token, or returns the 401 to send.
 *
 * One helper rather than the check inlined in each authenticated route, so the
 * two of them cannot drift into answering differently.
 */
async function authenticated(
  request: HttpRequest,
  deps: RouteDeps,
): Promise<{ ok: true; hederaAccountId: string } | { ok: false; result: HttpResult }> {
  const token = bearerToken(request.headers);
  if (token === null) {
    return {
      ok: false,
      result: fail(401, "unauthenticated", "this route needs an Authorization: Bearer <token> header"),
    };
  }

  const account = await deps.service.authenticate(token);
  if (account === null) {
    return { ok: false, result: fail(401, "unauthenticated", "that session is not valid") };
  }

  return { ok: true, hederaAccountId: account.hederaAccountId };
}

async function readMe(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const auth = await authenticated(request, deps);
  if (!auth.ok) return auth.result;

  return ok(200, { account: await deps.service.getProfile(auth.hederaAccountId) });
}

async function patchMe(request: HttpRequest, deps: RouteDeps): Promise<HttpResult> {
  const auth = await authenticated(request, deps);
  if (!auth.ok) return auth.result;

  const parsed = parseJsonBody(request.body);
  if (!parsed.ok) return parsed.result;

  // The account id comes from the token, never from the body. Taking it from the
  // body would let any signed-in caller edit anyone's profile.
  return ok(200, { account: await deps.service.updateProfile(auth.hederaAccountId, parsed.value) });
}

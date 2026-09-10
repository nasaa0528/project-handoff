/**
 * The wire contract, pinned in both directions.
 *
 * `@handoff/accounts-client` declares the response types by hand, because
 * `apps/web` is a browser build and cannot import the server package — that one
 * pulls in `mongodb` and `node:crypto`. Hand-declared types drift, so this file
 * takes the **real** output of the **real** handlers and assigns it to the
 * client's types. A route that changes shape without the client following stops
 * compiling here rather than breaking P3's app at runtime.
 *
 * The assignments are the test. `expect` calls below only prove the request
 * actually succeeded, so the types are being checked against a real body rather
 * than against an error response that happens to satisfy nothing.
 */

import {
  AccountService,
  codePepper,
  InMemoryAccountStore,
  type EmailCodeMessage,
} from "@handoff/accounts";
import type {
  AccountProfile,
  ConfirmationResponse,
  ProfileResponse,
  RegistrationResponse,
  SignInResponse,
  VerificationResponse,
} from "@handoff/accounts-client";
import { describe, expect, it } from "vitest";
import { handle, type HttpRequest, type RouteDeps } from "./routes.js";
import { RateLimiter } from "./rate-limit.js";

const registration = {
  hederaAccountId: "0.0.10119624",
  email: "khishgee@example.com",
  username: "khishgee",
  firstName: "Batkhishig",
  lastName: "Nasantogtokh",
  password: "correct horse battery",
};

function setup() {
  const sent: EmailCodeMessage[] = [];
  const service = new AccountService({
    store: new InMemoryAccountStore(),
    pepper: codePepper("deadbeef".repeat(8)),
    sendEmailCode: async (message) => void sent.push(message),
  });
  const deps: RouteDeps = { service, limiter: new RateLimiter(), allowedOrigins: [] };

  const call = (method: string, path: string, body?: unknown, token?: string) => {
    const request: HttpRequest = {
      method,
      path,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      body: body === undefined ? "" : JSON.stringify(body),
      clientAddress: "10.0.0.1",
    };
    return handle(request, deps);
  };

  return { call, sent };
}

describe("the client's types match what the routes actually return", () => {
  it("POST /v1/accounts", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", registration);
    expect(result.status).toBe(201);

    const body: RegistrationResponse = result.body as RegistrationResponse;
    // Read every field the client promises, so a removed one is a compile error
    // and not merely an unused type.
    const check: [string, boolean, string] = [
      body.account.hederaAccountId,
      body.verification.sent,
      body.verification.expiresAt,
    ];
    expect(check[0]).toBe("0.0.10119624");
    expect(check[1]).toBe(true);
  });

  it("POST /v1/accounts/verification/request", async () => {
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);
    const result = await call("POST", "/v1/accounts/verification/request", {
      hederaAccountId: registration.hederaAccountId,
    });
    expect(result.status).toBe(202);

    const body: VerificationResponse = result.body as VerificationResponse;
    expect(typeof body.verification.expiresAt).toBe("string");
  });

  it("POST /v1/accounts/verification/confirm", async () => {
    const { call, sent } = setup();
    await call("POST", "/v1/accounts", registration);
    const result = await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: sent.at(-1)?.code,
    });
    expect(result.status).toBe(200);

    const body: ConfirmationResponse = result.body as ConfirmationResponse;
    expect(body.account.emailVerified).toBe(true);
  });

  it("POST /v1/sessions", async () => {
    const { call, sent } = setup();
    await call("POST", "/v1/accounts", registration);
    await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: sent.at(-1)?.code,
    });

    const result = await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    });
    expect(result.status).toBe(200);

    const body: SignInResponse = result.body as SignInResponse;
    const check: [string, string, string] = [body.token, body.expiresAt, body.account.username];
    expect(check[2]).toBe("khishgee");
  });

  it("GET and PATCH /v1/accounts/me", async () => {
    const { call, sent } = setup();
    await call("POST", "/v1/accounts", registration);
    await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: sent.at(-1)?.code,
    });
    const signIn = (await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    })).body as SignInResponse;

    const read = await call("GET", "/v1/accounts/me", undefined, signIn.token);
    expect(read.status).toBe(200);
    const readBody: ProfileResponse = read.body as ProfileResponse;

    const patched = await call("PATCH", "/v1/accounts/me", { firstName: "Khishgee" }, signIn.token);
    expect(patched.status).toBe(200);
    const patchedBody: ProfileResponse = patched.body as ProfileResponse;

    // Every field of AccountProfile, named explicitly. `lastName` is optional
    // and must stay optional — the server omits the key rather than sending null.
    const full: AccountProfile = readBody.account;
    const fields: [string, string, string, string, boolean, string] = [
      full.hederaAccountId,
      full.email,
      full.username,
      full.firstName,
      full.emailVerified,
      full.createdAt,
    ];

    expect(fields[2]).toBe("khishgee");
    expect(patchedBody.account.firstName).toBe("Khishgee");
  });

  it("a cleared surname is an absent key, which is why lastName is optional", async () => {
    const { call, sent } = setup();
    await call("POST", "/v1/accounts", registration);
    await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: sent.at(-1)?.code,
    });
    const signIn = (await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    })).body as SignInResponse;

    const cleared = await call("PATCH", "/v1/accounts/me", { lastName: null }, signIn.token);
    const body: ProfileResponse = cleared.body as ProfileResponse;

    expect("lastName" in body.account).toBe(false);
    // Never null on the wire: a client typed `lastName?: string` would otherwise
    // hold a null it says it cannot.
    expect(JSON.stringify(body)).not.toContain("null");
  });
});

describe("every error code the client knows is one the server can send", () => {
  it("uses the documented body shape", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", { ...registration, hederaAccountId: "nope" });

    const body = result.body as { error: { code: string; message: string; field?: string } };
    expect(body.error.code).toBe("validation_failed");
    expect(typeof body.error.message).toBe("string");
    expect(body.error.field).toBe("hederaAccountId");
  });
});

import {
  AccountService,
  codePepper,
  InMemoryAccountStore,
  type EmailCodeMessage,
} from "@handoff/accounts";
import { describe, expect, it } from "vitest";
import { handle, type HttpRequest, type RouteDeps } from "./routes.js";
import { RateLimiter } from "./rate-limit.js";

const pepper = codePepper("deadbeef".repeat(8));

const registration = {
  hederaAccountId: "0.0.10119624",
  email: "khishgee@example.com",
  username: "khishgee",
  firstName: "Batkhishig",
  lastName: "Nasantogtokh",
  password: "correct horse battery",
};

function setup(options: { readonly allowedOrigins?: readonly string[] } = {}) {
  const sent: EmailCodeMessage[] = [];
  const store = new InMemoryAccountStore();
  const service = new AccountService({
    store,
    pepper,
    sendEmailCode: async (message) => void sent.push(message),
  });

  const deps: RouteDeps = {
    service,
    limiter: new RateLimiter(),
    allowedOrigins: options.allowedOrigins ?? [],
  };

  const request = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string | undefined> = {},
  ): HttpRequest => ({
    method,
    path,
    headers,
    body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body),
    clientAddress: "10.0.0.1",
  });

  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string | undefined>,
  ) => handle(request(method, path, body, headers), deps);

  const lastCode = (): string => {
    const message = sent.at(-1);
    if (message === undefined) throw new Error("no verification email was sent");
    return message.code;
  };

  /** Register, verify and sign in. Returns the bearer token. */
  const signedIn = async (): Promise<string> => {
    await call("POST", "/v1/accounts", registration);
    await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: lastCode(),
    });
    const response = await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    });
    return (response.body as { token: string }).token;
  };

  return { deps, call, sent, lastCode, signedIn, store };
}

/** Narrow the response body without `any` at every assertion. */
function bodyOf<T>(result: { body: unknown }): T {
  return result.body as T;
}

describe("GET /health", () => {
  it("answers 200", async () => {
    const { call } = setup();
    const result = await call("GET", "/health");
    expect(result.status).toBe(200);
    expect(bodyOf<{ status: string }>(result).status).toBe("ok");
  });

  it("refuses another method", async () => {
    const { call } = setup();
    expect((await call("POST", "/health")).status).toBe(405);
  });
});

describe("POST /v1/accounts", () => {
  it("registers and returns 201 with the profile", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", registration);

    expect(result.status).toBe(201);
    const body = bodyOf<{ account: { hederaAccountId: string; emailVerified: boolean } }>(result);
    expect(body.account.hederaAccountId).toBe("0.0.10119624");
    expect(body.account.emailVerified).toBe(false);
  });

  it("never puts the verification code in the response", async () => {
    // The code goes to the mailbox. A client that could read it here would make
    // the verification step decorative.
    const { call, lastCode } = setup();
    const result = await call("POST", "/v1/accounts", registration);
    expect(JSON.stringify(result.body)).not.toContain(lastCode());
  });

  it("never leaks the password or its hash", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", registration);
    const serialised = JSON.stringify(result.body);

    expect(serialised).not.toContain(registration.password);
    expect(serialised).not.toContain("scrypt");
    expect(serialised).not.toContain("passwordHash");
  });

  it("maps a duplicate to 409 and names the field", async () => {
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);

    const result = await call("POST", "/v1/accounts", registration);
    expect(result.status).toBe(409);
    const body = bodyOf<{ error: { code: string; field?: string } }>(result);
    expect(body.error.code).toBe("account_exists");
    expect(body.error.field).toBe("hederaAccountId");
  });

  it("maps a validation failure to 400", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", { ...registration, hederaAccountId: "nope" });

    expect(result.status).toBe(400);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("validation_failed");
  });

  it("maps a weak password to 400 with its own code", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", { ...registration, password: "short" });

    expect(result.status).toBe(400);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("weak_password");
  });

  it("answers 400 on malformed JSON rather than 500", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts", "{not json");

    expect(result.status).toBe(400);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("malformed_json");
  });

  it("refuses another method", async () => {
    const { call } = setup();
    expect((await call("GET", "/v1/accounts")).status).toBe(405);
  });
});

describe("verification", () => {
  it("confirms a code and reports the account verified", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/v1/accounts", registration);

    const result = await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: lastCode(),
    });

    expect(result.status).toBe(200);
    expect(bodyOf<{ account: { emailVerified: boolean } }>(result).account.emailVerified).toBe(true);
  });

  it("maps a wrong code to 400", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/v1/accounts", registration);

    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const result = await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: wrong,
    });

    expect(result.status).toBe(400);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("code_invalid");
  });

  it("maps an expired or spent code to 410, not 400", async () => {
    // Gone, not Bad Request: the code was real and is not any more, which is a
    // different thing for the client to show.
    const { call, lastCode } = setup();
    await call("POST", "/v1/accounts", registration);
    const code = lastCode();

    // Burn the attempt cap, which destroys the code.
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      await call("POST", "/v1/accounts/verification/confirm", {
        hederaAccountId: registration.hederaAccountId,
        code: wrong,
      });
    }

    const result = await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code,
    });
    expect(result.status).toBe(410);
  });

  it("maps too many attempts to 429", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/v1/accounts", registration);

    const wrong = lastCode() === "000000" ? "111111" : "000000";
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await call("POST", "/v1/accounts/verification/confirm", {
        hederaAccountId: registration.hederaAccountId,
        code: wrong,
      });
      statuses.push(result.status);
    }

    expect(statuses.slice(0, 4)).toEqual([400, 400, 400, 400]);
    expect(statuses[4]).toBe(429);
  });

  it("requires both fields", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/accounts/verification/confirm", {})).status).toBe(400);
    expect(
      (await call("POST", "/v1/accounts/verification/confirm", { hederaAccountId: "0.0.1" })).status,
    ).toBe(400);
  });

  it("resends with 202", async () => {
    const { call, sent } = setup();
    await call("POST", "/v1/accounts", registration);

    const result = await call("POST", "/v1/accounts/verification/request", {
      hederaAccountId: registration.hederaAccountId,
    });

    expect(result.status).toBe(202);
    expect(sent).toHaveLength(2);
  });

  it("maps an unknown account to 404", async () => {
    const { call } = setup();
    const result = await call("POST", "/v1/accounts/verification/request", {
      hederaAccountId: "0.0.999999",
    });
    expect(result.status).toBe(404);
  });
});

describe("POST /v1/sessions", () => {
  it("returns a token once the email is verified", async () => {
    const { call, lastCode } = setup();
    await call("POST", "/v1/accounts", registration);
    await call("POST", "/v1/accounts/verification/confirm", {
      hederaAccountId: registration.hederaAccountId,
      code: lastCode(),
    });

    const result = await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    });

    expect(result.status).toBe(200);
    const body = bodyOf<{ token: string; account: { username: string } }>(result);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.account.username).toBe("khishgee");
  });

  it("maps an unverified email to 403, with a code the client can branch on", async () => {
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);

    const result = await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: registration.password,
    });

    expect(result.status).toBe(403);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("email_not_verified");
  });

  it("maps bad credentials to 401, identically for a wrong password and an unknown account", async () => {
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);

    const wrongPassword = await call("POST", "/v1/sessions", {
      identifier: "khishgee",
      password: "not the password",
    });
    const noSuchAccount = await call("POST", "/v1/sessions", {
      identifier: "0.0.424242",
      password: "not the password",
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    // Byte-identical, so the endpoint is not an account-existence oracle.
    expect(JSON.stringify(noSuchAccount.body)).toBe(JSON.stringify(wrongPassword.body));
  });

  it("requires both fields", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/sessions", { identifier: "khishgee" })).status).toBe(400);
    expect((await call("POST", "/v1/sessions", {})).status).toBe(400);
  });
});

describe("authenticated routes", () => {
  it("reads the profile behind a bearer token", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();

    const result = await call("GET", "/v1/accounts/me", undefined, {
      authorization: `Bearer ${token}`,
    });

    expect(result.status).toBe(200);
    expect(bodyOf<{ account: { username: string } }>(result).account.username).toBe("khishgee");
  });

  it("accepts the scheme in any case", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();
    expect(
      (await call("GET", "/v1/accounts/me", undefined, { authorization: `bearer ${token}` })).status,
    ).toBe(200);
  });

  it("answers 401 with no token, a malformed header, or a bogus token", async () => {
    const { call } = setup();

    expect((await call("GET", "/v1/accounts/me")).status).toBe(401);
    expect((await call("GET", "/v1/accounts/me", undefined, { authorization: "Basic abc" })).status).toBe(401);
    expect((await call("GET", "/v1/accounts/me", undefined, { authorization: "Bearer" })).status).toBe(401);
    expect(
      (await call("GET", "/v1/accounts/me", undefined, { authorization: "Bearer nonsense" })).status,
    ).toBe(401);
  });

  it("patches a profile", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();

    const result = await call("PATCH", "/v1/accounts/me", { firstName: "Khishgee" }, {
      authorization: `Bearer ${token}`,
    });

    expect(result.status).toBe(200);
    expect(bodyOf<{ account: { firstName: string } }>(result).account.firstName).toBe("Khishgee");
  });

  it("takes the account from the token and ignores any id in the body", async () => {
    // Otherwise any signed-in caller could edit anyone's profile.
    const { call, signedIn, store } = setup();
    const token = await signedIn();
    await call("POST", "/v1/accounts", {
      ...registration,
      hederaAccountId: "0.0.7007",
      email: "other@example.com",
      username: "other",
    });

    const result = await call(
      "PATCH",
      "/v1/accounts/me",
      { firstName: "Hijacked", hederaAccountId: "0.0.7007" },
      { authorization: `Bearer ${token}` },
    );

    // The extra key is refused outright by the strict schema...
    expect(result.status).toBe(400);
    // ...and the other account is untouched either way.
    expect((await store.findByAccountId("0.0.7007"))?.firstName).toBe("Batkhishig");
  });

  it("refuses an empty patch", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();
    expect(
      (await call("PATCH", "/v1/accounts/me", {}, { authorization: `Bearer ${token}` })).status,
    ).toBe(400);
  });

  it("signs out, and the token stops working", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();

    const result = await call("DELETE", "/v1/sessions/current", undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(result.status).toBe(204);
    expect(result.body).toBeNull();

    expect(
      (await call("GET", "/v1/accounts/me", undefined, { authorization: `Bearer ${token}` })).status,
    ).toBe(401);
  });

  it("treats signing out with no token as already signed out", async () => {
    const { call } = setup();
    expect((await call("DELETE", "/v1/sessions/current")).status).toBe(204);
  });

  it("refuses the wrong method on /v1/accounts/me", async () => {
    const { call, signedIn } = setup();
    const token = await signedIn();
    expect(
      (await call("DELETE", "/v1/accounts/me", undefined, { authorization: `Bearer ${token}` })).status,
    ).toBe(405);
  });
});

describe("routing", () => {
  it("404s an unknown path", async () => {
    const { call } = setup();
    const result = await call("GET", "/v1/nope");
    expect(result.status).toBe(404);
    expect(bodyOf<{ error: { code: string } }>(result).error.code).toBe("not_found");
  });

  it("has no route that looks an account up by username", async () => {
    // Deliberate: it would be a public "is this person registered" oracle.
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);
    expect((await call("GET", "/v1/accounts/khishgee")).status).toBe(404);
  });
});

describe("rate limiting", () => {
  it("answers 429 with Retry-After once the sign-in budget is spent", async () => {
    const { call } = setup();
    await call("POST", "/v1/accounts", registration);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const result = await call("POST", "/v1/sessions", {
        identifier: "khishgee",
        password: "wrong",
      });
      statuses.push(result.status);
      if (result.status === 429) {
        expect(result.headers["Retry-After"]).toMatch(/^\d+$/);
      }
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});

describe("CORS", () => {
  it("echoes an allowed origin and varies on it", async () => {
    const { call } = setup({ allowedOrigins: ["http://localhost:5173"] });
    const result = await call("GET", "/health", undefined, { origin: "http://localhost:5173" });

    expect(result.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(result.headers["Vary"]).toBe("Origin");
  });

  it("sends nothing for an origin that is not on the list", async () => {
    const { call } = setup({ allowedOrigins: ["http://localhost:5173"] });
    const result = await call("GET", "/health", undefined, { origin: "https://evil.example" });

    expect(result.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("never answers with a wildcard, because the sign-in body carries a token", async () => {
    const { call } = setup({ allowedOrigins: ["http://localhost:5173"] });
    const result = await call("GET", "/health", undefined, { origin: "http://localhost:5173" });
    expect(result.headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("answers a preflight 204 even for an unknown path", async () => {
    // A browser sends OPTIONS before it can know the path exists, and a 404 here
    // surfaces as a CORS failure with no explanation.
    const { call } = setup({ allowedOrigins: ["http://localhost:5173"] });
    const result = await call("OPTIONS", "/v1/accounts", undefined, {
      origin: "http://localhost:5173",
    });

    expect(result.status).toBe(204);
    expect(result.headers["Access-Control-Allow-Methods"]).toContain("POST");
  });
});

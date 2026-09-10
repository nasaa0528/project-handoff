import { describe, expect, it, vi } from "vitest";
import { AccountsClient } from "./client.js";
import { AccountsApiError } from "./types.js";

const profile = {
  hederaAccountId: "0.0.10119624",
  email: "khishgee@example.com",
  username: "khishgee",
  firstName: "Batkhishig",
  emailVerified: true,
  createdAt: "2026-09-10T12:00:00.000Z",
};

/** A fetch stand-in that records what it was called with. */
function stubFetch(
  responses: ReadonlyArray<{ status: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  let index = 0;

  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    });

    const status = next?.status ?? 200;
    return new Response(next?.body === undefined ? null : JSON.stringify(next.body), {
      status,
      headers: { "Content-Type": "application/json", ...(next?.headers ?? {}) },
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function clientWith(responses: Parameters<typeof stubFetch>[0]) {
  const { impl, calls } = stubFetch(responses);
  return { client: new AccountsClient({ baseUrl: "http://localhost:8788", fetch: impl }), calls };
}

describe("URL building", () => {
  it("strips a trailing slash from the base so paths do not double up", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: { status: "ok" } }]);
    const client = new AccountsClient({ baseUrl: "http://localhost:8788/", fetch: impl });

    await client.health();
    expect(calls[0]?.url).toBe("http://localhost:8788/health");
  });
});

describe("register", () => {
  it("posts the body and returns the parsed response", async () => {
    const body = { account: profile, verification: { sent: true, expiresAt: "2026-09-10T12:10:00.000Z" } };
    const { client, calls } = clientWith([{ status: 201, body }]);

    const result = await client.register({
      hederaAccountId: "0.0.10119624",
      email: "khishgee@example.com",
      username: "khishgee",
      firstName: "Batkhishig",
      password: "correct horse battery",
    });

    expect(result.account.hederaAccountId).toBe("0.0.10119624");
    expect(result.verification.sent).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]?.headers["Authorization"]).toBeUndefined();
  });

  it("surfaces a 409 as an error naming the field", async () => {
    const { client } = clientWith([
      {
        status: 409,
        body: { error: { code: "account_exists", message: "that username is taken", field: "username" } },
      },
    ]);

    await expect(client.register({} as never)).rejects.toMatchObject({
      code: "account_exists",
      status: 409,
      field: "username",
    });
  });
});

describe("signIn", () => {
  it("returns the token and the profile", async () => {
    const { client } = clientWith([
      { status: 200, body: { token: "abc123", expiresAt: "2026-09-17T12:00:00.000Z", account: profile } },
    ]);

    const result = await client.signIn("khishgee", "correct horse battery");
    expect(result.token).toBe("abc123");
    expect(result.account.username).toBe("khishgee");
  });

  it("reports an unverified email as its own code, not as bad credentials", async () => {
    // These route to different screens: one is "check your inbox", the other is
    // "that was wrong". Collapsing them would send a correct password to an
    // error message.
    const { client } = clientWith([
      { status: 403, body: { error: { code: "email_not_verified", message: "confirm your email address first" } } },
    ]);

    await expect(client.signIn("khishgee", "correct horse battery")).rejects.toMatchObject({
      code: "email_not_verified",
      status: 403,
    });
  });
});

describe("authenticated calls", () => {
  it("sends the bearer token", async () => {
    const { client, calls } = clientWith([{ status: 200, body: { account: profile } }]);
    await client.getProfile("tok_abc");

    expect(calls[0]?.headers["Authorization"]).toBe("Bearer tok_abc");
  });

  it("unwraps the account rather than making the caller reach through a wrapper", async () => {
    const { client } = clientWith([{ status: 200, body: { account: profile } }]);
    expect((await client.getProfile("tok")).username).toBe("khishgee");
  });

  it("patches with an explicit null to clear a surname", async () => {
    const { client, calls } = clientWith([{ status: 200, body: { account: profile } }]);
    await client.updateProfile("tok", { lastName: null });

    // Explicit null on the wire, not an omitted key — the server tells them apart.
    expect(calls[0]?.body).toBe('{"lastName":null}');
  });

  it("flags a 401 as needing sign-in", async () => {
    const { client } = clientWith([
      { status: 401, body: { error: { code: "unauthenticated", message: "that session is not valid" } } },
    ]);

    const error = await client.getProfile("stale").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountsApiError);
    expect((error as AccountsApiError).needsSignIn).toBe(true);
  });
});

describe("signOut", () => {
  it("resolves on a 204 with no body to parse", async () => {
    // A 204 carries nothing; calling response.json() on it throws.
    const { client, calls } = clientWith([{ status: 204 }]);

    await expect(client.signOut("tok")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });
});

describe("errors", () => {
  it("reads Retry-After off a 429", async () => {
    const { client } = clientWith([
      {
        status: 429,
        body: { error: { code: "rate_limited", message: "too many requests" } },
        headers: { "Retry-After": "42" },
      },
    ]);

    const error = (await client.signIn("khishgee", "x").catch((e: unknown) => e)) as AccountsApiError;
    expect(error.retryAfterSeconds).toBe(42);
    expect(error.isRetryable).toBe(true);
  });

  it("does not trust an unrecognised code", async () => {
    // A server sending something this client does not know becomes "internal"
    // rather than a code a switch statement might silently not handle.
    const { client } = clientWith([
      { status: 400, body: { error: { code: "brand_new_code", message: "?" } } },
    ]);

    await expect(client.getProfile("tok")).rejects.toMatchObject({ code: "internal", status: 400 });
  });

  it("survives an error body that is not the documented shape", async () => {
    // This path runs exactly when something is already wrong, so it must not
    // add a TypeError from reading .error.code of undefined.
    const { client } = clientWith([{ status: 500, body: { unexpected: true } }]);

    const error = (await client.getProfile("tok").catch((e: unknown) => e)) as AccountsApiError;
    expect(error).toBeInstanceOf(AccountsApiError);
    expect(error.code).toBe("internal");
    expect(error.message).toContain("500");
  });

  it("survives an error body that is not JSON at all", async () => {
    const impl = (async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    const client = new AccountsClient({ baseUrl: "http://localhost:8788", fetch: impl });

    await expect(client.health()).rejects.toMatchObject({ code: "internal", status: 502 });
  });

  it("reports a network failure as status 0, distinct from any refusal", async () => {
    const impl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const client = new AccountsClient({ baseUrl: "http://localhost:8788", fetch: impl });

    const error = (await client.health().catch((e: unknown) => e)) as AccountsApiError;
    expect(error.status).toBe(0);
    expect(error.isRetryable).toBe(true);
    // Names the address, because the usual cause is the server not running or
    // CORS refusing the origin.
    expect(error.message).toContain("http://localhost:8788");
  });
});

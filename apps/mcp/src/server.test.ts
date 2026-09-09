import { describe, expect, it } from "vitest";
import { MockChainAdapter, sha256Hex, type LockFundsParams } from "@handoff/schema";
import { InMemoryContentStore } from "./content.js";
import { ContentHashMismatchError } from "@handoff/content";
import { handle, CONTENT_PUT_MAX_BYTES, type HttpRequest, type ServerDeps } from "./server.js";
import { Facilitator, type FetchLike } from "./x402/facilitator.js";
import {
  buildRequirements,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type GateConfig,
} from "./x402/gate.js";
import type { PaymentPayload } from "./x402/types.js";

const GATE_CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
  serviceUrl: "http://localhost:4021",
};

const SETTLE_TX = "0.0.7162784@1757000000.000000000";

function harness(options: { verify?: unknown; settle?: unknown } = {}) {
  const paths: string[] = [];
  const impl: FetchLike = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const bodies: Record<string, unknown> = {
      "/supported": {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: "hedera:testnet",
            extra: { feePayer: "0.0.7162784" },
          },
        ],
      },
      "/verify": options.verify ?? { isValid: true, payer: PAYER },
      "/settle": options.settle ?? {
        success: true,
        transaction: SETTLE_TX,
        network: "hedera:testnet",
      },
    };
    return new Response(JSON.stringify(bodies[path] ?? {}), { status: 200 });
  };

  const content = new InMemoryContentStore();
  const deps: ServerDeps = {
    facilitator: new Facilitator({ baseUrl: "https://api.testnet.blocky402.com", fetch: impl }),
    gateConfig: GATE_CONFIG,
    chain: new MockChainAdapter(),
    content,
    ordersTopicId: "0.0.orders",
    attestationsTopicId: "0.0.9002",
    certTags: [{ code: "cpa-us", label: "Licensed reviewer" }],
  };
  return { deps, paths, content };
}

function paidHeader(): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: { url: "http://localhost:4021/orders" },
    accepted: buildRequirements(GATE_CONFIG, "0.0.7162784"),
    payload: { transaction: "AAAA" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/** Whoever the facilitator double says paid. The order body has to name the same one. */
const PAYER = "0.0.10376659";

function orderBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    // The account the facilitator double reports as the payer. The two have to
    // agree or the order is refused, which is the point of the field.
    requester_account_id: PAYER,
    spec: "Review the attached report for arithmetic defects.",
    artifact_base64: Buffer.from("FAKE report. Total 11,900.").toString("base64"),
    cert_tag: "cpa-us",
    price_hbar: "200",
    // Far enough out that a one-hour claim timeout is inside the allowed third.
    deadline: futureUtc(60 * 60 * 24 * 7),
    claim_timeout_seconds: 3600,
    ...overrides,
  });
}

function futureUtc(seconds: number): string {
  return `${new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19)}Z`;
}

function post(headers: Record<string, string | undefined>, body: string): HttpRequest {
  return { method: "POST", path: "/orders", headers, body: Buffer.from(body, "utf8") };
}

describe("POST /orders", () => {
  it("charges before it does anything else", async () => {
    const { deps, paths, content } = harness();

    const response = await handle(post({}, orderBody()), deps);

    expect(response.status).toBe(402);
    expect(response.headers[PAYMENT_REQUIRED_HEADER]).toBeTruthy();
    // No order was posted and no content was stored for an unpaid call.
    expect(content.size).toBe(0);
    expect(paths).not.toContain("/settle");
  });

  it("posts the order and settles the fee once the payment verifies", async () => {
    const { deps, paths } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(200);
    expect(paths).toEqual(["/supported", "/verify", "/settle"]);

    const body = response.body as Record<string, Record<string, string>>;
    expect(body["order_id"]).toMatch(/^ord_/);
    expect(body["transaction_ids"]?.["lock_funds"]).toBeTruthy();
    expect(body["transaction_ids"]?.["submit_envelope"]).toBeTruthy();
    expect(body["transaction_ids"]?.["service_fee"]).toBe(SETTLE_TX);
    expect(response.headers[PAYMENT_RESPONSE_HEADER]).toBeTruthy();
  });

  it("settles only after the order is posted, so a bad order costs the caller nothing", async () => {
    const { deps, paths } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ price_hbar: "not-a-price" })),
      deps,
    );

    expect(response.status).toBe(400);
    // Verified, never settled: the payment was proven, not submitted.
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("does not settle when the order fails to post", async () => {
    const { deps, paths } = harness();
    const chain = {
      ...deps.chain,
      network: "testnet" as const,
      lockFunds: async () => {
        throw new Error("escrow unreachable");
      },
    };

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      { ...deps, chain },
    );

    expect(response.status).toBe(502);
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("refuses to sell an execution order", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ class: "execution" })),
      deps,
    );

    expect(response.status).toBe(400);
  });

  it("keeps the two money flows apart in what it reports", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    const body = response.body as Record<string, Record<string, unknown>>;
    // The service fee is the facilitator's transaction; the order value went
    // to an escrow. Different rails, and the response says which is which.
    expect(body["service_fee"]?.["settled"]).toBe(true);
    expect(body["escrow_account_id"]).toBeTruthy();
    expect(body["transaction_ids"]?.["service_fee"]).not.toBe(
      body["transaction_ids"]?.["lock_funds"],
    );
  });

  it("reports a failed settlement instead of pretending the fee moved", async () => {
    const { deps } = harness({
      settle: {
        success: false,
        transaction: "",
        network: "hedera:testnet",
        errorReason: "transaction_failed",
      },
    });

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(200);
    const body = response.body as Record<string, Record<string, unknown>>;
    expect(body["service_fee"]?.["settled"]).toBe(false);
    expect(body["service_fee"]?.["error"]).toBe("transaction_failed");
  });

  it("answers 503 when the facilitator is unreachable, rather than crashing", async () => {
    const failing: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const { deps, content } = harness();
    const facilitator = new Facilitator({
      baseUrl: "https://api.testnet.blocky402.com",
      fetch: failing,
    });

    const response = await handle(post({}, orderBody()), { ...deps, facilitator });

    expect(response.status).toBe(503);
    expect(content.size).toBe(0);
  });

  it("still returns the order when the settlement call itself fails", async () => {
    const { deps } = harness();
    const impl: FetchLike = async (url) => {
      const path = new URL(url).pathname;
      if (path === "/settle") {
        return new Response("upstream exploded", { status: 500 });
      }
      if (path === "/verify") {
        return new Response(JSON.stringify({ isValid: true, payer: PAYER }));
      }
      return new Response(
        JSON.stringify({
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: "hedera:testnet",
              extra: { feePayer: "0.0.7162784" },
            },
          ],
        }),
      );
    };
    const facilitator = new Facilitator({
      baseUrl: "https://api.testnet.blocky402.com",
      fetch: impl,
    });

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      { ...deps, facilitator },
    );

    // The funds are locked and the envelope is published by now. Hiding that
    // behind a failed fee call would lose the caller their order.
    expect(response.status).toBe(200);
    const body = response.body as Record<string, Record<string, unknown>>;
    expect(body["order_id"]).toMatch(/^ord_/);
    expect(body["service_fee"]?.["settled"]).toBe(false);
    expect(String(body["service_fee"]?.["error"])).toMatch(/500/);
  });

  it("answers anything else without touching the facilitator", async () => {
    const { deps, paths } = harness();

    expect((await handle({ ...post({}, ""), path: "/nope" }, deps)).status).toBe(404);
    expect((await handle({ ...post({}, ""), method: "GET" }, deps)).status).toBe(405);
    expect(paths).toEqual([]);
  });

  it("serves health for free, and it says nothing worth paying for", async () => {
    const { deps, paths } = harness();

    const response = await handle({ ...post({}, ""), method: "GET", path: "/health" }, deps);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", network: "hedera:testnet" });
    // A free endpoint that reached the chain or the facilitator would be a way
    // around the gate. This one only says the process is up.
    expect(paths).toEqual([]);
  });
});

describe("free read paths", () => {
  it("lists the credential tags without asking for payment", async () => {
    const { deps, paths } = harness();

    const response = await handle({ method: "GET", path: "/tags", headers: {}, body: Buffer.alloc(0) }, deps);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tags: [{ code: "cpa-us", label: "Licensed reviewer" }] });
    // Reads are ungated, so nothing about a payment happened.
    expect(paths).not.toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("reads an order back after it posts, still without payment", async () => {
    const { deps } = harness();

    const posted = await handle(post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()), deps);
    const orderId = (posted.body as { order_id: string }).order_id;

    const read = await handle(
      { method: "GET", path: `/orders/${orderId}`, headers: {}, body: Buffer.alloc(0) },
      deps,
    );

    expect(read.status).toBe(200);
    const status = read.body as { state: string; claimReadable: boolean; envelope?: unknown };
    expect(status.state).toBe("POSTED");
    expect(status.envelope).toBeDefined();
    // No claim message shape exists yet, and the reader says so rather than
    // letting "POSTED" be read as "nobody has taken it".
    expect(status.claimReadable).toBe(false);
  });

  it("answers UNKNOWN for an id nothing on the topics matches", async () => {
    const { deps } = harness();

    const read = await handle(
      { method: "GET", path: "/orders/ord_nothing", headers: {}, body: Buffer.alloc(0) },
      deps,
    );

    expect(read.status).toBe(200);
    expect((read.body as { state: string }).state).toBe("UNKNOWN");
  });

  it("returns nothing the topics do not already make public", async () => {
    const { deps } = harness();
    const spec = "Review the attached report for arithmetic defects.";
    const artifact = "FAKE report. Total 11,900.";

    const posted = await handle(post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()), deps);
    const orderId = (posted.body as { order_id: string }).order_id;
    const read = await handle(
      { method: "GET", path: `/orders/${orderId}`, headers: {}, body: Buffer.alloc(0) },
      deps,
    );

    // Hard rule 1, on a path that is deliberately unauthenticated.
    const serialized = JSON.stringify(read.body);
    expect(serialized).not.toContain(spec);
    expect(serialized).not.toContain(artifact);
  });
});

describe("who pays is who the order is for", () => {
  it("locks the escrow against the account the facilitator verified", async () => {
    const { deps } = harness();
    const locked: string[] = [];
    // Wrapped on the instance rather than spread into a new object: the mock
    // keeps its state in private fields, which a spread would leave behind.
    const chain = deps.chain;
    const lock = chain.lockFunds.bind(chain);
    chain.lockFunds = async (params: LockFundsParams) => {
      locked.push(params.requesterAccountId);
      return lock(params);
    };

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(200);
    // Not the server's configuration, which no longer has an account, and not
    // the body's word for it either — the account the facilitator named.
    expect(locked).toEqual([PAYER]);
  });

  it("refuses an order that names a requester other than the payer, before it settles", async () => {
    const { deps, paths, content } = harness();

    const response = await handle(
      post(
        { [PAYMENT_SIGNATURE_HEADER]: paidHeader() },
        orderBody({ requester_account_id: "0.0.9999" }),
      ),
      deps,
    );

    expect(response.status).toBe(400);
    const body = response.body as { message: string };
    expect(body.message).toContain("0.0.9999");
    expect(body.message).toContain(PAYER);
    expect(body.message).toContain("Nothing was charged.");

    // The security property, not the message: verified, never settled, and
    // nothing published or stored for an order somebody else would fund.
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
    expect(content.size).toBe(0);
  });

  it("refuses when the facilitator verifies but does not name the payer", async () => {
    const { deps, paths } = harness({ verify: { isValid: true } });

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()),
      deps,
    );

    expect(response.status).toBe(502);
    expect(paths).not.toContain("/settle");
  });

  it("refuses a body with no requester at all, rather than falling back to a configured one", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ requester_account_id: undefined })),
      deps,
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("requester_account_id");
  });

  it("refuses something that is not an account id", async () => {
    const { deps } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ requester_account_id: "alice" })),
      deps,
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("Hedera account id");
  });
});

describe("credential tag routing", () => {
  it("refuses an unknown tag before the fee settles", async () => {
    const { deps, paths } = harness();

    const response = await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ cert_tag: "not-a-tag" })),
      deps,
    );

    expect(response.status).toBe(400);
    const body = response.body as { message: string };
    expect(body.message).toContain('No reviewer holds the credential "not-a-tag"');
    expect(body.message).toContain("Available: Licensed reviewer");
    // The promise the copy makes has to be true: verify ran, settle did not.
    expect(body.message).toContain("Nothing was charged.");
    expect(paths).toContain("/verify");
    expect(paths).not.toContain("/settle");
  });

  it("does not publish an envelope for an unknown tag", async () => {
    const { deps, content } = harness();

    await handle(
      post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody({ cert_tag: "not-a-tag" })),
      deps,
    );

    expect(content.size).toBe(0);
  });

  it("states what it charged, so the reply need not send anyone back for it", async () => {
    const { deps } = harness();

    const response = await handle(post({ [PAYMENT_SIGNATURE_HEADER]: paidHeader() }, orderBody()), deps);

    expect((response.body as { service_fee: { amount_tinybars: string } }).service_fee.amount_tinybars).toBe(
      GATE_CONFIG.feeTinybars,
    );
  });
});

describe("content, addressed by hash", () => {
  const BYTES = Buffer.from("FAKE report. Total 11,900.", "utf8");
  const HASH = sha256Hex(BYTES);

  function content(method: string, hash: string, body: Buffer = Buffer.alloc(0)): HttpRequest {
    return { method, path: `/content/${hash}`, headers: {}, body };
  }

  it("serves the stored bytes back exactly, not as JSON", async () => {
    const { deps } = harness();
    await handle(content("PUT", HASH, BYTES), deps);

    const read = await handle(content("GET", HASH), deps);

    expect(read.status).toBe(200);
    // The expert app hashes what it receives and refuses a mismatch, so the
    // bytes have to survive the trip unchanged. A JSON-encoded body would not.
    expect(Buffer.from(read.bytes ?? new Uint8Array())).toEqual(BYTES);
    expect(sha256Hex(read.bytes ?? new Uint8Array())).toBe(HASH);
    expect(read.headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("refuses a body that does not hash to the path", async () => {
    const { deps, content: store } = harness();

    const written = await handle(content("PUT", HASH, Buffer.from("something else", "utf8")), deps);

    expect(written.status).toBe(400);
    // The whole of the authorization story: content cannot be replaced with
    // different content, because the bytes must be what the path says.
    expect(store.size).toBe(0);
  });

  it("takes the same bytes twice without complaint", async () => {
    const { deps, content: store } = harness();

    expect((await handle(content("PUT", HASH, BYTES), deps)).status).toBe(200);
    expect((await handle(content("PUT", HASH, BYTES), deps)).status).toBe(200);

    expect(store.size).toBe(1);
  });

  it("refuses more than the cap, before storing any of it", async () => {
    const { deps, content: store } = harness();
    const big = Buffer.alloc(CONTENT_PUT_MAX_BYTES + 1, 0x61);

    const written = await handle(content("PUT", sha256Hex(big), big), deps);

    expect(written.status).toBe(413);
    expect(store.size).toBe(0);
  });

  it("says not found rather than serving nothing as something", async () => {
    const { deps } = harness();

    const read = await handle(content("GET", sha256Hex(Buffer.from("never stored"))), deps);

    expect(read.status).toBe(404);
    expect(read.bytes).toBeUndefined();
  });

  it("answers the browser's preflight, because the expert app is another origin", async () => {
    const { deps } = harness();

    const preflight = await handle(content("OPTIONS", HASH), deps);

    expect(preflight.status).toBe(204);
    expect(preflight.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(preflight.headers["Access-Control-Allow-Methods"]).toContain("PUT");
    expect(preflight.headers["Access-Control-Allow-Headers"]).toContain("content-type");
  });

  it("does not treat a path that is not a hash as content", async () => {
    const { deps } = harness();

    const read = await handle({ method: "GET", path: "/content/nope", headers: {}, body: Buffer.alloc(0) }, deps);

    expect(read.status).toBe(404);
  });

  it("does not hand the store's own error text to an anonymous caller", async () => {
    const { deps } = harness();
    const store = {
      put: async () => {
        throw new Error("Supabase upload failed for handoff-content: bucket not found");
      },
      get: async () => null,
    };

    const written = await handle(content("PUT", HASH, BYTES), { ...deps, content: store });

    expect(written.status).toBe(502);
    expect(JSON.stringify(written.body)).not.toContain("Supabase");
  });

  it("reports corrupted bytes as a broken commitment, never as a miss", async () => {
    const { deps } = harness();
    const store = {
      put: async () => "memory://x",
      get: async () => {
        throw new ContentHashMismatchError(HASH, sha256Hex(Buffer.from("other")));
      },
    };

    const read = await handle(content("GET", HASH), { ...deps, content: store });

    expect(read.status).toBe(502);
  });
});

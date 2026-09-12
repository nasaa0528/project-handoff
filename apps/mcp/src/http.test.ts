import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { MOCK_ESCROW_ACCOUNT_ID, MockChainAdapter } from "@handoff/schema";
import { InMemoryContentStore } from "./content.js";
import { createHttpServer, MAX_BODY_BYTES } from "./http.js";
import { Facilitator, type FetchLike } from "./x402/facilitator.js";
import { PAYMENT_REQUIRED_HEADER, type GateConfig } from "./x402/gate.js";
import type { ServerDeps } from "./server.js";

const GATE_CONFIG: GateConfig = {
  network: "hedera:testnet",
  receiverAccountId: "0.0.10376656",
  feeTinybars: "100000",
  serviceUrl: "http://localhost:4021",
};

const fetchStub: FetchLike = async (url) =>
  new Response(
    JSON.stringify(
      new URL(url).pathname === "/supported"
        ? {
            kinds: [
              {
                x402Version: 2,
                scheme: "exact",
                network: "hedera:testnet",
                extra: { feePayer: "0.0.7162784" },
              },
            ],
          }
        : {},
    ),
  );

const deps: ServerDeps = {
  facilitator: new Facilitator({ baseUrl: "https://api.testnet.blocky402.com", fetch: fetchStub }),
  gateConfig: GATE_CONFIG,
  chain: new MockChainAdapter(),
  content: new InMemoryContentStore(),
  ordersTopicId: "0.0.orders",
  attestationsTopicId: "0.0.attestations",
  escrowAccountId: MOCK_ESCROW_ACCOUNT_ID,
  certTags: [{ code: "cpa-us", label: "Licensed reviewer" }],
};

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createHttpServer(deps);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Enough of an order that the 402 can price it and build a lock for it. */
function orderBody(): string {
  return JSON.stringify({
    requester_account_id: "0.0.10376659",
    spec: "Review the attached report.",
    artifact_base64: Buffer.from("FAKE report.").toString("base64"),
    cert_tag: "cpa-us",
    price_hbar: "200",
    deadline: `${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 19)}Z`,
    claim_timeout_seconds: 3600,
  });
}

describe("the socket layer", () => {
  it("serves a real 402 over HTTP, header and body agreeing", async () => {
    // A real order body, because the 402 now has to build a fund lock and
    // cannot do that without a price, a requester and an order id. An empty
    // body is a 400 — see the next test.
    const response = await fetch(`${origin}/orders`, { method: "POST", body: orderBody() });

    expect(response.status).toBe(402);
    const header = response.headers.get(PAYMENT_REQUIRED_HEADER.toLowerCase());
    expect(header).toBeTruthy();

    // The header is the x402 challenge and the body is its v1 fallback plus
    // the fund lock, which is ours and not @x402/core's. Everything the two
    // share still agrees; `accepts` is what a client reads.
    const { fund_lock: fundLock, ...challenge } = (await response.json()) as Record<string, unknown>;
    expect(JSON.parse(Buffer.from(header ?? "", "base64").toString("utf8"))).toEqual(challenge);
    expect(fundLock).toMatchObject({ order_id: expect.stringMatching(/^ord_/) });
  });

  it("refuses a body it cannot price, rather than quoting for it", async () => {
    const response = await fetch(`${origin}/orders`, { method: "POST", body: "{}" });

    expect(response.status).toBe(400);
  });

  it("serves health", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", network: "hedera:testnet" });
  });

  it("refuses a body that would hold the process's memory", async () => {
    const response = await fetch(`${origin}/orders`, {
      method: "POST",
      body: "x".repeat(MAX_BODY_BYTES + 1024),
    });

    expect(response.status).toBe(413);
  });
});

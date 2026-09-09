/**
 * The wiring between the tool surface and the client half.
 *
 * `main.ts` reads the payer account and hands it to `createMcpServer`, and the
 * resource server refuses an order body without `requester_account_id`. Both
 * halves were right and the middle was not: the tool handler built its
 * `postOrder` deps by hand and left the account out, so every order came back
 * 400 and no unit test saw it — the two sides were each tested alone.
 *
 * So this drives the real tool over a real transport and reads the body that
 * would have gone on the wire.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryTransport, type Transport } from "@modelcontextprotocol/server";
import { createMcpServer } from "./server.js";
import { UnwiredSigner, type PaymentSigner } from "./client.js";

const ARGUMENTS = {
  spec: "Review the attached report.",
  artifact: "FAKE report. Total 11,900.",
  cert_tag: "cpa-us",
  price_hbar: "200",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 3600,
};

/** Serves the order without ever quoting a price, so nothing has to be signed. */
function servedWithoutPayment(): { posted: () => string[]; fetch: typeof globalThis.fetch } {
  const bodies: string[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ order_id: "ord_test", service_fee: { settled: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { posted: () => bodies, fetch };
}

/** Speak JSON-RPC at the server the way a client would, and collect what comes back. */
async function connected(signer: PaymentSigner, requesterAccountId?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const received: Record<string, unknown>[] = [];
  (clientTransport as Transport).onmessage = (message) => {
    received.push(message as Record<string, unknown>);
  };

  const server = createMcpServer({
    baseUrl: "http://localhost:4021",
    signer,
    certTags: [{ code: "cpa-us", label: "Licensed reviewer" }],
    ...(requesterAccountId === undefined ? {} : { requesterAccountId }),
  });
  await server.connect(serverTransport);
  await clientTransport.start();

  const send = async (message: Record<string, unknown>): Promise<void> => {
    await (clientTransport as Transport).send(message as never);
  };

  await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  });
  await send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const call = async (id: number): Promise<Record<string, unknown>> => {
    await send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "handoff_verify", arguments: ARGUMENTS },
    });
    for (let tick = 0; tick < 200; tick += 1) {
      const answer = received.find((message) => message["id"] === id);
      if (answer !== undefined) return answer;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("the server never answered the tool call");
  };

  return { call, close: async () => clientTransport.close() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handoff_verify, over the transport", () => {
  it("names the payer as the requester in the order body", async () => {
    const served = servedWithoutPayment();
    vi.stubGlobal("fetch", served.fetch);

    const { call, close } = await connected(new UnwiredSigner(), "0.0.10376659");
    await call(2);
    await close();

    expect(served.posted()).toHaveLength(1);
    const body = JSON.parse(served.posted()[0] ?? "{}") as Record<string, unknown>;
    // The field the resource server rejects an order without. It was missing
    // here while both sides of it were tested and green.
    expect(body["requester_account_id"]).toBe("0.0.10376659");
    expect(body["class"]).toBe("review");
  });

  it("leaves the field out when no payer is configured, rather than inventing one", async () => {
    const served = servedWithoutPayment();
    vi.stubGlobal("fetch", served.fetch);

    const { call, close } = await connected(new UnwiredSigner());
    await call(2);
    await close();

    const body = JSON.parse(served.posted()[0] ?? "{}") as Record<string, unknown>;
    expect(body["requester_account_id"]).toBeUndefined();
  });
});

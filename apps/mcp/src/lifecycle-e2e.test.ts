/**
 * The whole lifecycle through the HTTP handler, in one test.
 *
 * Every other suite covers one beat. This one plays the exchange end to end —
 * 402, the requester's signed fund lock, the paid retry, the expert's claim,
 * the expert's attestation, the settle — against the same `handle()` a real
 * client talks to, so a beat that works alone but does not wire to the next
 * one fails here.
 *
 * `MockChainAdapter` and a facilitator double stand in for the network. What
 * this proves is the wiring and the rules; what it cannot prove is Hedera's
 * behaviour, which is `packages/chain/scripts/live-happy-path.ts`'s job.
 */

import { describe, expect, it } from "vitest";
import {
  encodeAttestation,
  encodeClaim,
  MOCK_ESCROW_ACCOUNT_ID,
  MockChainAdapter,
  SCHEMA_VERSION,
  sha256Hex,
  signFundLock,
} from "@handoff/schema";
import { Facilitator, type FetchLike } from "./x402/facilitator.js";
import { PAYMENT_SIGNATURE_HEADER, buildRequirements } from "./x402/gate.js";
import type { PaymentPayload } from "./x402/types.js";
import { InMemoryContentStore } from "./content.js";
import { handle, type HttpRequest, type ServerDeps } from "./server.js";

const ORDERS = "0.0.orders";
const ATTESTATIONS = "0.0.attestations";
const REQUESTER = "0.0.1001";
const EXPERT = "0.0.2002";
const FEE_PAYER = "0.0.3003";

const GATE_CONFIG = {
  network: "hedera:testnet" as const,
  receiverAccountId: "0.0.4004",
  feeTinybars: "50000000",
  serviceUrl: "http://localhost:4021",
};

const ARTIFACT = Buffer.from("FAKE quarterly report. Total 11,900. Labelled FAKE.");
const ARTIFACT_HASH = sha256Hex(ARTIFACT);
const NOTES_HASH = sha256Hex("FAKE review notes, stored off-chain.");

function futureUtc(seconds: number): string {
  return `${new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19)}Z`;
}

function harness() {
  const impl: FetchLike = async (url) => {
    const bodies: Record<string, unknown> = {
      "/supported": {
        kinds: [
          { x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: FEE_PAYER } },
        ],
      },
      "/verify": { isValid: true, payer: REQUESTER },
      "/settle": { success: true, transaction: `${FEE_PAYER}@1757000000.000000000`, network: "hedera:testnet" },
    };
    return new Response(JSON.stringify(bodies[new URL(url).pathname] ?? {}), { status: 200 });
  };

  const chain = new MockChainAdapter();
  const deps: ServerDeps = {
    facilitator: new Facilitator({ baseUrl: "https://api.testnet.blocky402.com", fetch: impl }),
    gateConfig: GATE_CONFIG,
    chain,
    content: new InMemoryContentStore(),
    ordersTopicId: ORDERS,
    attestationsTopicId: ATTESTATIONS,
    escrowAccountId: MOCK_ESCROW_ACCOUNT_ID,
    certTags: [{ code: "cpa-us", label: "Licensed reviewer" }],
  };
  return { deps, chain };
}

function paidHeader(): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: { url: `${GATE_CONFIG.serviceUrl}/orders` },
    accepted: buildRequirements(GATE_CONFIG, FEE_PAYER),
    payload: { transaction: "AAAA" },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

function orderBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requester_account_id: REQUESTER,
    spec: "Review the attached report for arithmetic defects.",
    artifact_base64: ARTIFACT.toString("base64"),
    cert_tag: "cpa-us",
    price_hbar: "200",
    deadline: futureUtc(60 * 60 * 24 * 7),
    claim_timeout_seconds: 3600,
    ...overrides,
  });
}

function post(path: string, headers: Record<string, string>, body: string): HttpRequest {
  return { method: "POST", path, headers, body: Buffer.from(body, "utf8") };
}

describe("POSTED → CLAIMED → DELIVERED → SETTLED, through the handler", () => {
  it("carries one order from an unpaid call to the expert being paid", async () => {
    const { deps, chain } = harness();

    // ── Beat 1. The unpaid call is answered 402 with the fund lock to sign.
    const challenged = await handle(post("/orders", {}, orderBody()), deps);
    expect(challenged.status).toBe(402);
    const fundLock = (
      challenged.body as { fund_lock: { order_id: string; transaction_bytes: string } }
    ).fund_lock;
    const orderId = fundLock.order_id;

    // ── Beat 2. The requester signs on their own machine and retries paid.
    const posted = await handle(
      post(
        "/orders",
        { [PAYMENT_SIGNATURE_HEADER]: paidHeader() },
        orderBody({
          order_id: orderId,
          signed_fund_lock: signFundLock(fundLock.transaction_bytes, REQUESTER),
        }),
      ),
      deps,
    );
    expect(posted.status).toBe(200);
    const order = posted.body as {
      order_id: string;
      transaction_ids: Record<string, string>;
      service_fee: { amount_tinybars: string; settled: boolean };
    };
    expect(order.order_id).toBe(orderId);
    // The escrow is funded, the envelope is out and the service fee settled,
    // each with its own id. Threaded, never swallowed.
    expect(order.transaction_ids["fund_lock"]).toBeTruthy();
    expect(order.transaction_ids["submit_envelope"]).toBeTruthy();
    expect(order.transaction_ids["service_fee"]).toBeTruthy();
    // The service fee is 0.5 HBAR and the order value is 200. Two money flows,
    // different rails, different sizes, and this test holds both at once.
    expect(order.service_fee).toMatchObject({ amount_tinybars: "50000000", settled: true });

    // Hashes only. The report itself never reached a topic.
    const onTopic = await chain.readMessages(ORDERS, { limit: 50 });
    expect(onTopic.map((m) => m.contents).join()).not.toContain("11,900");
    expect(onTopic.map((m) => m.contents).join()).toContain(ARTIFACT_HASH);

    const openStatus = await handle(
      { method: "GET", path: `/orders/${orderId}`, headers: {}, body: Buffer.alloc(0) },
      deps,
    );
    expect(openStatus.body).toMatchObject({ state: "POSTED" });

    // Settling now would pay nobody, and it refuses rather than guessing.
    const early = await handle(post(`/orders/${orderId}/settle`, {}, ""), deps);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ retryable: true, state: "POSTED" });

    // ── Beat 3. The expert claims, paying for their own message.
    await chain.publishClaim(
      ORDERS,
      EXPERT,
      encodeClaim({ kind: "claim", order_id: orderId, cert_tag: "cpa-us", schema_version: SCHEMA_VERSION }),
    );
    const claimedStatus = await handle(
      { method: "GET", path: `/orders/${orderId}`, headers: {}, body: Buffer.alloc(0) },
      deps,
    );
    expect(claimedStatus.body).toMatchObject({ state: "CLAIMED", claimedBy: EXPERT });

    // ── Beat 4. The expert signs the attestation from their own account.
    await chain.publishClaim(
      ATTESTATIONS,
      EXPERT,
      encodeAttestation({
        order_id: orderId,
        class: "review",
        verdict: "reject",
        defects: ["ARITHMETIC"],
        notes_hash: NOTES_HASH,
        artifact_hash_in: ARTIFACT_HASH,
        cert_tag: "cpa-us",
        schema_version: SCHEMA_VERSION,
      }),
    );
    const deliveredStatus = await handle(
      { method: "GET", path: `/orders/${orderId}`, headers: {}, body: Buffer.alloc(0) },
      deps,
    );
    expect(deliveredStatus.body).toMatchObject({
      state: "DELIVERED",
      verdict: "reject",
      signedBy: EXPERT,
    });

    // ── Beat 5. The escrow releases. A reject is a delivered product.
    const settled = await handle(post(`/orders/${orderId}/settle`, {}, ""), deps);
    expect(settled.status).toBe(200);
    expect(settled.body).toMatchObject({
      state: "SETTLED",
      payeeAccountId: EXPERT,
      // 200 HBAR, the order value. Not the 0.5 HBAR service fee — two money
      // flows, never conflated.
      amountTinybars: "20000000000",
    });

    // ── And once more, which is the thing that must never pay twice.
    const again = await handle(post(`/orders/${orderId}/settle`, {}, ""), deps);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ state: "SETTLED", alreadyRecorded: true });
  });
});

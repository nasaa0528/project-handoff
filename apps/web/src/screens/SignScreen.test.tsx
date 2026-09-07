/**
 * The screen, rendered to static markup. Not a substitute for looking at it,
 * but it proves the component tree composes and that the words the demo
 * depends on are actually on the page for each state.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewOrder, SCHEMA_VERSION, type TransactionRecord } from "@handoff/schema";
import { buildReviewAttestation } from "../sign/attestation";
import type { SettlementState } from "../sign/settlement";
import type { OrderForSigning, SignedAttestation } from "../sign/sign";
import type { SignFlow } from "../sign/useSignFlow";
import { SignScreen } from "./SignScreen";

const EXPERT = "0.0.12345";

const envelope = ReviewOrder.parse({
  order_id: "ord_demo",
  class: "review",
  spec_hash: "a".repeat(64),
  artifact_hash_in: "b".repeat(64),
  cert_tag: "demo-reviewer",
  price_tinybars: "20000000000",
  deadline: "2026-09-14T00:00:00Z",
  claim_timeout_seconds: 3600,
  schema_version: SCHEMA_VERSION,
});

function order(escrowAccountId: string, topicId: string): OrderForSigning {
  return { envelope, escrowAccountId, topicId };
}

function signed(transactionId: string, topicId: string): SignedAttestation {
  return {
    attestation: buildReviewAttestation(envelope, { verdict: "approve", defects: [], notesHash: "c".repeat(64) }),
    body: "{}",
    notesRef: "memory://notes",
    topicId,
    transactionId,
    consensusTimestamp: "1757000000.000000001",
    sequenceNumber: 2,
  };
}

const record = (transactionId: string): TransactionRecord => ({
  transactionId,
  status: "SUCCESS",
  consensusTimestamp: "1757000006.000000000",
});

const noop = { platformIssue: null, sign: async () => {}, checkAgain: () => {} };

describe("SignScreen", () => {
  it("offers the sign action from the expert's own account and says which chain it is on", () => {
    const flow: SignFlow = { ...noop, status: { kind: "idle" }, settlement: null };
    const html = renderToStaticMarkup(
      <SignScreen
        mode="mock"
        expertAccountId={EXPERT}
        order={order("MOCK-escrow-ord_demo", "MOCK-topic-orders")}
        artifactText="FAKE DOCUMENT"
        flow={flow}
      />,
    );

    expect(html).toContain(`Sign and publish from ${EXPERT}`);
    expect(html).toContain("MOCK CHAIN");
    expect(html).toContain("200 HBAR");
    expect(html).toContain("FAKE");
    expect(html).toContain("never a schedule key");
    // The expert account is real; the escrow is a mock id and gets no link.
    expect(html).toContain(`hashscan.io/testnet/account/${EXPERT}`);
    expect(html).not.toContain("hashscan.io/testnet/account/MOCK");
  });

  it("shows settlement as read from the mirror node, with the payout id in hand", () => {
    const settlement: SettlementState = {
      phase: "settled",
      elapsedMs: 12_000,
      slow: false,
      attestationTransactionId: "MOCK-tx-3",
      attestation: record("MOCK-tx-3"),
      payoutTransactionId: "MOCK-tx-7",
      payout: record("MOCK-tx-7"),
      failure: null,
      lastReadError: null,
    };
    const flow: SignFlow = {
      ...noop,
      status: { kind: "signed", signed: signed("MOCK-tx-3", "MOCK-topic-orders") },
      settlement,
    };
    const html = renderToStaticMarkup(
      <SignScreen
        mode="mock"
        expertAccountId={EXPERT}
        order={order("MOCK-escrow-ord_demo", "MOCK-topic-orders")}
        artifactText={null}
        flow={flow}
      />,
    );

    expect(html).toContain("SETTLED");
    expect(html).toContain("MOCK-tx-3");
    expect(html).toContain("MOCK-tx-7");
    expect(html).toContain("200 HBAR");
    expect(html).not.toContain("Sign and publish");
    // Mock transaction ids never get a Hashscan link.
    expect(html).not.toContain("hashscan.io/testnet/transaction/");
  });

  it("links real transaction ids on testnet", () => {
    const attestationTx = "0.0.12345@1757000000.000000000";
    const payoutTx = "0.0.4242@1757000010.000000000";
    const settlement: SettlementState = {
      phase: "settled",
      elapsedMs: 9_000,
      slow: false,
      attestationTransactionId: attestationTx,
      attestation: record(attestationTx),
      payoutTransactionId: payoutTx,
      payout: record(payoutTx),
      failure: null,
      lastReadError: null,
    };
    const flow: SignFlow = { ...noop, status: { kind: "signed", signed: signed(attestationTx, "0.0.777") }, settlement };
    const html = renderToStaticMarkup(
      <SignScreen mode="testnet" expertAccountId={EXPERT} order={order("0.0.999", "0.0.777")} artifactText={null} flow={flow} />,
    );

    expect(html).toContain(`hashscan.io/testnet/transaction/${attestationTx}`);
    expect(html).toContain(`hashscan.io/testnet/transaction/${payoutTx}`);
    expect(html).toContain("Hedera testnet");
    expect(html).not.toContain("MOCK");
  });

  it("offers a retry when the mirror node goes quiet, and says nothing is lost", () => {
    const settlement: SettlementState = {
      phase: "stalled",
      elapsedMs: 90_000,
      slow: true,
      attestationTransactionId: "MOCK-tx-3",
      attestation: null,
      payoutTransactionId: null,
      payout: null,
      failure: null,
      lastReadError: null,
    };
    const flow: SignFlow = {
      ...noop,
      status: { kind: "signed", signed: signed("MOCK-tx-3", "MOCK-topic-orders") },
      settlement,
    };
    const html = renderToStaticMarkup(
      <SignScreen
        mode="mock"
        expertAccountId={EXPERT}
        order={order("MOCK-escrow-ord_demo", "MOCK-topic-orders")}
        artifactText={null}
        flow={flow}
      />,
    );

    expect(html).toContain("Check again");
    expect(html).toContain("Nothing is lost");
    expect(html).not.toContain("SETTLED");
  });
});

describe("SignScreen, what the settlement panel says for each read", () => {
  const mockOrder = order("MOCK-escrow-ord_demo", "MOCK-topic-orders");
  const failedRecord = (transactionId: string): TransactionRecord => ({ ...record(transactionId), status: "FAILED" });

  function render(settlement: SettlementState, extra: Partial<SignFlow> = {}, mode: "mock" | "testnet" = "mock") {
    const tx = settlement.attestationTransactionId;
    const flow: SignFlow = {
      ...noop,
      status: { kind: "signed", signed: signed(tx, mockOrder.topicId) },
      settlement,
      ...extra,
    };
    const o = mode === "mock" ? mockOrder : order("0.0.999", "0.0.777");
    return renderToStaticMarkup(
      <SignScreen mode={mode} expertAccountId={EXPERT} order={o} artifactText={null} flow={flow} />,
    );
  }

  const base = (attestationTransactionId: string): SettlementState => ({
    phase: "waiting-for-mirror",
    elapsedMs: 0,
    slow: false,
    attestationTransactionId,
    attestation: null,
    payoutTransactionId: null,
    payout: null,
    failure: null,
    lastReadError: null,
  });

  it("puts a failed attestation on the mirror step, never a green tick", () => {
    const html = render({
      ...base("MOCK-tx-3"),
      phase: "failed",
      attestation: failedRecord("MOCK-tx-3"),
      failure: "the mirror node reports the attestation transaction as FAILED",
    });
    expect(html).toContain("the mirror node reports the attestation transaction as FAILED");
    expect(html).not.toContain("Seen at");
    expect(html).toContain("FAILED");
    expect(html).not.toContain("SETTLED");
  });

  it("keeps the payout id and its link on screen when the payout failed", () => {
    const attestationTx = "0.0.12345@1757000000.000000000";
    const payoutTx = "0.0.4242@1757000010.000000000";
    const html = render(
      {
        ...base(attestationTx),
        phase: "failed",
        attestation: record(attestationTx),
        payoutTransactionId: payoutTx,
        payout: failedRecord(payoutTx),
        failure: "the mirror node reports the payout transaction as FAILED",
      },
      {},
      "testnet",
    );
    expect(html).toContain("the mirror node reports the payout transaction as FAILED");
    expect(html).toContain(payoutTx);
    expect(html).toContain(`hashscan.io/testnet/transaction/${payoutTx}`);
    expect(html).toContain("Seen at");
    expect(html).not.toContain("SETTLED");
  });

  it("says so when the payout is what stalled, and shows the id if it is known", () => {
    const html = render({
      ...base("MOCK-tx-3"),
      phase: "stalled",
      elapsedMs: 90_000,
      slow: true,
      attestation: record("MOCK-tx-3"),
      payoutTransactionId: "MOCK-tx-7",
    });
    expect(html).toContain("Seen at");
    expect(html).toContain("No answer about the payout in 90 s");
    expect(html).toContain("known but the mirror node has not shown it yet");
    expect(html).toContain("MOCK-tx-7");
    expect(html).toContain("Check again");
  });

  it("says the platform has not released payment when no payout id exists yet", () => {
    const html = render({
      ...base("MOCK-tx-3"),
      phase: "stalled",
      elapsedMs: 90_000,
      slow: true,
      attestation: record("MOCK-tx-3"),
    });
    expect(html).toContain("The platform has not released payment yet");
    expect(html).toContain("Check again");
  });

  it("mentions a read that failed while it keeps reading", () => {
    const html = render({ ...base("MOCK-tx-3"), elapsedMs: 4_000, lastReadError: "503 from the mirror node" });
    expect(html).toContain("Last read failed: 503 from the mirror node");
    expect(html).toContain("Reading again");
  });

  it("gives the settled amount its provenance rather than the mirror node's authority", () => {
    const html = render({
      ...base("MOCK-tx-3"),
      phase: "settled",
      elapsedMs: 12_000,
      attestation: record("MOCK-tx-3"),
      payoutTransactionId: "MOCK-tx-7",
      payout: record("MOCK-tx-7"),
    });
    expect(html).toContain("200 HBAR, the order value per the envelope");
    expect(html).toContain("SETTLED");
  });

  it("reports a platform issue without taking back the attestation", () => {
    const html = render(
      { ...base("MOCK-tx-3"), elapsedMs: 2_000 },
      { platformIssue: "verifier unreachable" },
    );
    expect(html).toContain("The stand-in platform failed: verifier unreachable");
    expect(html).toContain("Your attestation stands regardless");
    expect(html).not.toContain("Not published");
  });
});

describe("SignScreen, why the sign button is disabled", () => {
  const mockOrder = order("MOCK-escrow-ord_demo", "MOCK-topic-orders");
  const idle: SignFlow = { ...noop, status: { kind: "idle" }, settlement: null };

  it("lists what is missing, and keeps the button disabled until nothing is", () => {
    const html = renderToStaticMarkup(
      <SignScreen mode="mock" expertAccountId={EXPERT} order={mockOrder} artifactText={null} flow={idle} />,
    );
    expect(html).toContain("Pick a verdict.");
    expect(html).toContain("Write your notes.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Sign and publish from/);
  });

  it("refuses to sign while a defect code sits uncommitted in the box", () => {
    const html = renderToStaticMarkup(
      <SignScreen
        mode="mock"
        expertAccountId={EXPERT}
        order={mockOrder}
        artifactText={null}
        flow={idle}
        initialDefectDraft="FN-3-TOTAL"
      />,
    );
    expect(html).toContain("Add or clear the defect code you typed.");
    expect(html).toContain('value="FN-3-TOTAL"');
  });
});

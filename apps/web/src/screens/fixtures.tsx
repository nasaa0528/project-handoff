/**
 * Shared fixtures for the screen tests. Rendered to static markup: not a
 * substitute for looking at the screens, but it proves the tree composes
 * and that the words the demo depends on are on the page for each state,
 * and that the banned ones are not.
 */

import { ReviewOrder, SCHEMA_VERSION, type TransactionRecord } from "@handoff/schema";
import type { ExpertIdentity } from "../components/Shell";
import type { DraftStore } from "../lib/draft";
import type { ClaimFlow } from "../orders/useClaimFlow";
import type { ExpertOrder } from "../orders/order";
import { buildReviewAttestation } from "../sign/attestation";
import type { SettlementState } from "../sign/settlement";
import type { SignedAttestation } from "../sign/sign";
import type { SignFlow } from "../sign/useSignFlow";

export const EXPERT = "0.0.12345";
export const IDENTITY: ExpertIdentity = { accountId: EXPERT, credentials: ["demo-reviewer"] };

/** Tue Sep 8 2026, 17:30 local. Every clock in the fixtures is relative to this. */
export const NOW = new Date(2026, 8, 8, 17, 30, 0);
export const DEADLINE = utc(new Date(2026, 8, 8, 20, 0, 0));
export const SIGN_BY = utc(new Date(2026, 8, 8, 18, 12, 0));

export function utc(local: Date): string {
  return local.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const envelope = ReviewOrder.parse({
  order_id: "ord_demo",
  class: "review",
  spec_hash: "a".repeat(64),
  artifact_hash_in: "b".repeat(64),
  cert_tag: "demo-reviewer",
  price_tinybars: "10000000000",
  deadline: DEADLINE,
  claim_timeout_seconds: 1800,
  schema_version: SCHEMA_VERSION,
});

export function order(overrides: Partial<ExpertOrder> = {}): ExpertOrder {
  return {
    envelope,
    escrowAccountId: "MOCK-escrow-ord_demo",
    ordersTopicId: "MOCK-topic-orders",
    attestationsTopicId: "MOCK-topic-attestations",
    title: "Quarterly summary — internal consistency",
    ask: "FAKE — demo fixture.\n\nTask (FAKE): review the attached summary for consistency.",
    documentWords: 80,
    ...overrides,
  };
}

export function signed(transactionId: string): SignedAttestation {
  return {
    attestation: buildReviewAttestation(envelope, { verdict: "reject", defects: ["FN-2-DATE"], notesHash: "c".repeat(64) }),
    body: "{}",
    notesRef: "memory://notes",
    topicId: "MOCK-topic-attestations",
    transactionId,
    consensusTimestamp: "1757000000.000000001",
    sequenceNumber: 2,
  };
}

export const record = (transactionId: string): TransactionRecord => ({
  transactionId,
  status: "SUCCESS",
  consensusTimestamp: "1757000006.000000000",
});

export function settlement(overrides: Partial<SettlementState> = {}): SettlementState {
  return {
    phase: "waiting-for-mirror",
    elapsedMs: 0,
    slow: false,
    attestationTransactionId: "MOCK-tx-3",
    attestation: null,
    payoutTransactionId: null,
    payout: null,
    failure: null,
    lastReadError: null,
    ...overrides,
  };
}

const noSign = { platformIssue: null, sign: async () => {}, checkAgain: () => {} };
export const idleSign: SignFlow = { ...noSign, status: { kind: "idle" }, settlement: null };
export function signedFlow(state: SettlementState, extra: Partial<SignFlow> = {}): SignFlow {
  return { ...noSign, status: { kind: "signed", signed: signed(state.attestationTransactionId) }, settlement: state, ...extra };
}

const noClaim = { claim: async () => {}, checkAgain: () => {} };
export const idleClaim: ClaimFlow = { ...noClaim, status: { kind: "idle" } };
export function claimFlow(status: ClaimFlow["status"]): ClaimFlow {
  return { ...noClaim, status };
}

/** A draft store that remembers what it was given, so a test can seed the workspace. */
export function drafts(seed: Parameters<DraftStore["save"]>[1] | null = null): DraftStore & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    saved,
    load: () => seed ?? { notes: "", defects: [], verdict: null, step: "notes" },
    save: (_, draft) => void saved.push(draft),
    clear: () => {},
  };
}

/**
 * Banned on default screens, per the copy dictionary. Checked against the
 * visible text of every rendered state, so a leak fails a test rather than
 * a persona review. `HCS` and `attestation` cover the older wording too.
 */
export const BANNED_WORDS: readonly RegExp[] = [
  /attestation/i,
  /consensus timestamp/i,
  /mirror node/i,
  /\bschema\b/i,
  /\bbytes?\b/i,
  /fresh schedule/i,
  /tinybar/i,
  /schema_version/,
  /ScheduleSign/,
  /threshold/i,
  /facilitator/i,
  /\bECDSA\b/,
  /PAYMENT-SIGNATURE/,
  /MockChainAdapter/,
  /\bHCS\b/,
];

/** The text a person sees: tags, attributes and entities stripped. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

export function expectNoBannedWords(html: string): string[] {
  const text = visibleText(html);
  return BANNED_WORDS.filter((word) => word.test(text)).map((word) => `${word} in: ${text.match(word)?.[0] ?? ""}`);
}

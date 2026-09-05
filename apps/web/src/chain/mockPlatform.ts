/**
 * MOCK ONLY. The rest of the lifecycle, in miniature, so the sign screen can
 * be exercised end to end before the cutover.
 *
 * Two roles the expert app never plays for real live here: the requester who
 * posts and funds an order, and the platform verifier plus schedule admin who
 * release payment after the attestation. After Monday this file is a test
 * fixture. It never appears in a demo or a recording; its ids say `MOCK-` so
 * that anyone who sees one on screen knows at once.
 *
 * Every transaction id the mock produces is handed back, even though nothing
 * here reads them yet. The rule is never to swallow one, and a pattern that
 * drops ids in a stand-in is a pattern that gets copied into the real thing.
 */

import {
  assertClaimTimeoutFitsWindow,
  encodeEnvelope,
  formatTinybars,
  hbarToTinybars,
  ReviewOrder,
  SCHEMA_VERSION,
  type ChainAdapter,
} from "@handoff/schema";
import fakeArtifact from "../../../../assets/demo/fake-quarterly-summary.txt?raw";
import fakeSpec from "../../../../assets/demo/fake-review-spec.txt?raw";
import { notesToBytes, sha256HexOfBytes } from "../sign/notes";
import type { OrderForSigning } from "../sign/sign";
import type { PayoutLocator, SettlementReader } from "../sign/settlement";

/**
 * The fabricated order, from `assets/demo/`, where every artifact that can
 * appear on camera lives (hard rule 7). Both say FAKE in their first word.
 */
export const FAKE_SPEC: string = fakeSpec;
export const FAKE_ARTIFACT: string = fakeArtifact;

export const FAKE_CERT_TAG = "demo-reviewer";

export interface SeedOptions {
  readonly ordersTopicId: string;
  readonly requesterAccountId: string;
  /** In HBAR, as a string. Never a float. */
  readonly priceHbar: string;
  readonly claimTimeoutSeconds?: number;
  readonly orderId?: string;
  /** Injectable so tests are deterministic. Epoch milliseconds. */
  readonly now?: () => number;
}

/** What the sign screen needs, plus the ids the posting produced. */
export interface SeededOrder extends OrderForSigning {
  readonly transactionIds: {
    readonly lockFunds: string;
    readonly submitEnvelope: string;
  };
}

/** `Utc` in the schema is second precision, `Z` only. */
function utcSecondsFromNow(nowMillis: number, seconds: number): string {
  return new Date(nowMillis + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Post a fabricated review order and lock its funds, then hand it over as if
 * this expert's claim had already won. A claim message would sit between the
 * two in the real lifecycle; its schema is not in the treaty yet, and the sign
 * screen needs only the order and the escrow.
 */
export async function seedClaimedReviewOrder(
  chain: ChainAdapter,
  options: SeedOptions,
): Promise<SeededOrder> {
  const now = options.now ?? Date.now;
  const nowMillis = now();

  const [specHash, artifactHash] = await Promise.all([
    sha256HexOfBytes(notesToBytes(FAKE_SPEC)),
    sha256HexOfBytes(notesToBytes(FAKE_ARTIFACT)),
  ]);

  const envelope = ReviewOrder.parse({
    order_id: options.orderId ?? "ord_mock_demo_0001",
    class: "review",
    spec_hash: specHash,
    artifact_hash_in: artifactHash,
    cert_tag: FAKE_CERT_TAG,
    price_tinybars: formatTinybars(hbarToTinybars(options.priceHbar)),
    deadline: utcSecondsFromNow(nowMillis, 3 * 24 * 3600),
    claim_timeout_seconds: options.claimTimeoutSeconds ?? 3600,
    schema_version: SCHEMA_VERSION,
  });
  assertClaimTimeoutFitsWindow(Math.floor(nowMillis / 1000), envelope);

  // Lock before publish, same as apps/mcp: a public order with no money
  // behind it is the worse failure.
  const escrow = await chain.lockFunds({
    orderId: envelope.order_id,
    amountTinybars: envelope.price_tinybars,
    requesterAccountId: options.requesterAccountId,
  });
  const published = await chain.submitMessage(options.ordersTopicId, encodeEnvelope(envelope));

  return {
    envelope,
    escrowAccountId: escrow.escrowAccountId,
    topicId: options.ordersTopicId,
    transactionIds: {
      lockFunds: escrow.transactionId,
      submitEnvelope: published.transactionId,
    },
  };
}

export interface MockPayout {
  readonly scheduleId: string;
  /** The verifier's signature, then the schedule admin's. The second one fired the transfer. */
  readonly signatureTransactionIds: readonly [verifier: string, admin: string];
  readonly payoutTransactionId: string;
}

/**
 * The platform's side: after the attestation, the verifier and the schedule
 * admin co-sign and the scheduled transfer fires.
 *
 * On Hedera the payout is the scheduled transaction itself, whose id is the
 * ScheduleCreate's id with the scheduled flag set. The mock keeps no separate
 * record for the inner transfer, so the id handed back here is the signature
 * that executed it. The shape of the real one is `packages/chain`'s to settle.
 */
export class MockPlatform {
  readonly #chain: ChainAdapter;
  readonly #expertAccountId: string;
  readonly #payouts = new Map<string, MockPayout>();

  constructor(chain: ChainAdapter, expertAccountId: string) {
    this.#chain = chain;
    this.#expertAccountId = expertAccountId;
  }

  /**
   * Release payment for an order this expert attested. Idempotent, like the
   * real payout: releasing twice returns the same payout and moves no money.
   */
  async releasePayment(order: OrderForSigning): Promise<MockPayout> {
    const orderId = order.envelope.order_id;
    const existing = this.#payouts.get(orderId);
    if (existing !== undefined) {
      return existing;
    }

    const schedule = await this.#chain.createSchedule({
      orderId,
      escrowAccountId: order.escrowAccountId,
      payeeAccountId: this.#expertAccountId,
      amountTinybars: order.envelope.price_tinybars,
      expiresAt: order.envelope.deadline,
    });

    const verifier = await this.#chain.signSchedule(schedule.scheduleId);
    const admin = await this.#chain.signSchedule(schedule.scheduleId);
    if (!admin.executed) {
      throw new Error(`mock schedule ${schedule.scheduleId} did not execute after two signatures`);
    }

    const payout: MockPayout = {
      scheduleId: schedule.scheduleId,
      signatureTransactionIds: [verifier.transactionId, admin.transactionId],
      payoutTransactionId: admin.transactionId,
    };
    this.#payouts.set(orderId, payout);
    return payout;
  }

  /** What the settlement watcher asks. Null until the payout exists. */
  locator(orderId: string): PayoutLocator {
    return {
      locate: async () => this.#payouts.get(orderId)?.payoutTransactionId ?? null,
    };
  }
}

/**
 * Mirror lag, simulated: an id stays invisible until `lagMs` after it is
 * first asked for. The mock answers instantly otherwise, and a screen that
 * never shows its waiting state is a screen nobody has looked at.
 */
export function withSimulatedMirrorLag(
  reader: SettlementReader,
  lagMs: number,
  now: () => number = Date.now,
): SettlementReader {
  const firstAsked = new Map<string, number>();
  return {
    async getTransaction(transactionId) {
      const asked = firstAsked.get(transactionId);
      if (asked === undefined) {
        firstAsked.set(transactionId, now());
        return null;
      }
      return now() - asked < lagMs ? null : reader.getTransaction(transactionId);
    },
  };
}

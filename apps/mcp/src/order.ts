/**
 * Order packaging and the fund-lock call.
 *
 * This is what `handoff_verify` does once the x402 gate has let a call
 * through: turn a requester's task into an order envelope, put the content
 * where only its hashes leave, lock the money, and publish.
 *
 * Three rules are load-bearing here rather than decorative.
 *
 * **Hashes only.** The specification and the artifact go to the content store.
 * The envelope carries `spec_hash` and `artifact_hash_in` and nothing else
 * about them, and there is a test that greps the published body for the input
 * text to keep it that way.
 *
 * **No payout record at post time.** The payee has to be known and at `POSTED`
 * nobody has claimed yet. The record is created at settle, not at claim: the
 * claim is an HCS message from the expert's own account, so this server learns
 * of it through a mirror read and has no claim-time hook to hang it on. See
 * `./settle.ts` and
 * `../../../docs/decisions/2026-09-12-settle-is-an-explicit-endpoint-and-idempotency-lives-on-the-mirror.md`.
 *
 * **`review` only.** The `execution` class exists in the schema and in the
 * architecture, and building a working execution path is Tier 3 this week. A
 * request for one is refused here rather than half-supported.
 */

import { randomUUID } from "node:crypto";
import {
  assertClaimTimeoutFitsWindow,
  encodeEnvelope,
  formatTinybars,
  hbarToTinybars,
  ReviewOrder,
  SCHEMA_VERSION,
  sha256Hex,
  type ChainAdapter,
} from "@handoff/schema";
import type { ContentStore } from "./content.js";

export class OrderError extends Error {
  constructor(
    message: string,
    /**
     * The fund lock's transaction id, whenever the escrow is already funded.
     *
     * Present means the requester's money has moved and the order did not
     * finish, which is the one failure a caller must not answer by ordering
     * again — a fresh 402 mints a fresh id and a fresh lock, and they would
     * fund the escrow a second time for what was meant to be one order.
     * Structured rather than only in the message, so a handler can act on it.
     */
    readonly escrowTransactionId?: string,
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export interface ReviewOrderRequest {
  /** The task specification. Stored, hashed, never published. */
  readonly spec: string;
  /** The artifact to be reviewed. Stored, hashed, never published. */
  readonly artifact: Uint8Array;
  /** Which certification may claim this. */
  readonly certTag: string;
  /** The price of the judgment, in HBAR, as a string. Never a float. */
  readonly priceHbar: string;
  /** Order deadline: UTC, second precision, `Z` only. */
  readonly deadline: string;
  /** Short relative to the deadline, so a lazy claimant cannot hold the funds. */
  readonly claimTimeoutSeconds: number;
}

export interface PackageDeps {
  readonly content: ContentStore;
  /** Injectable so tests are deterministic. */
  readonly now?: () => number;
  readonly newOrderId?: () => string;
}

export interface PostDeps extends PackageDeps {
  readonly chain: ChainAdapter;
  readonly ordersTopicId: string;
  /** Whose funds are being locked, taken from the payment and never from our env. */
  readonly requesterAccountId: string;
  /**
   * The lock the requester signed, base64, as it came back over the wire.
   *
   * Untrusted. `submitFundLock` validates it against the parameters below
   * before anything executes; nothing here reads the bytes.
   */
  readonly signedFundLock: string;
}

export interface PackagedOrder {
  readonly envelope: ReviewOrder;
  /** Canonical bytes, validated and proven to fit one HCS message. */
  readonly body: string;
  readonly specRef: string;
  readonly artifactRef: string;
}

export interface PostedOrder extends PackagedOrder {
  readonly orderId: string;
  readonly escrowAccountId: string;
  /** The network's word on when this was posted, and the truth for ordering. */
  readonly consensusTimestamp: string;
  readonly sequenceNumber: number;
  /**
   * Every transaction id this produced, threaded rather than swallowed.
   * Settlement state is read from a mirror node, never inferred from these.
   */
  readonly transactionIds: {
    readonly fundLock: string;
    readonly submitEnvelope: string;
  };
}

const encoder = new TextEncoder();

export function defaultOrderId(): string {
  // 36 bytes, inside the 64-byte bound, and readable in a log line.
  return `ord_${randomUUID().replaceAll("-", "")}`;
}

/**
 * `seconds.nanoseconds` to whole seconds.
 *
 * Deliberately string surgery rather than `Number()` on the whole thing: the
 * nanosecond part would round into the seconds and move the instant.
 */
export function consensusEpochSeconds(consensusTimestamp: string): number {
  const seconds = consensusTimestamp.split(".")[0];
  if (seconds === undefined || !/^\d+$/.test(seconds)) {
    throw new OrderError(
      `consensus timestamp ${consensusTimestamp} is not seconds.nanoseconds`,
    );
  }
  return Number.parseInt(seconds, 10);
}

/**
 * Store the content, hash it, and build the envelope.
 *
 * Runs before any money moves, so everything that can be rejected on shape
 * alone is rejected while the only cost is a wasted store write.
 */
export async function packageReviewOrder(
  request: ReviewOrderRequest,
  deps: PackageDeps,
): Promise<PackagedOrder> {
  const now = deps.now ?? Date.now;
  const orderId = (deps.newOrderId ?? defaultOrderId)();

  if (request.artifact.byteLength === 0) {
    throw new OrderError("a review order needs an artifact to review");
  }

  const specBytes = encoder.encode(request.spec);
  const specHash = sha256Hex(specBytes);
  const artifactHash = sha256Hex(request.artifact);

  const [specRef, artifactRef] = await Promise.all([
    deps.content.put(specHash, specBytes),
    deps.content.put(artifactHash, request.artifact),
  ]);

  const envelope = ReviewOrder.parse({
    order_id: orderId,
    class: "review",
    spec_hash: specHash,
    artifact_hash_in: artifactHash,
    cert_tag: request.certTag,
    price_tinybars: formatTinybars(hbarToTinybars(request.priceHbar)),
    deadline: request.deadline,
    claim_timeout_seconds: request.claimTimeoutSeconds,
    schema_version: SCHEMA_VERSION,
  });

  // Preflight against our own clock. The authoritative check is against the
  // consensus timestamp after publishing, but failing here costs nothing and
  // failing there means an unusable envelope is already on a topic.
  assertClaimTimeoutFitsWindow(Math.floor(now() / 1000), envelope);

  return { envelope, body: encodeEnvelope(envelope), specRef, artifactRef };
}

/**
 * Package, lock the funds, publish the envelope.
 *
 * **Lock before publish, and that order matters.** Publishing first and then
 * failing to lock would leave a public order with no money behind it, which a
 * certified expert could claim and work on for nothing. Locking first and then
 * failing to publish leaves funds in an escrow we control, with no order
 * anybody has seen — recoverable, and nobody has been misled.
 *
 * The lock is the requester's own signed transfer, built at the 402 and signed
 * on their machine. See
 * ../../../docs/decisions/2026-09-08-requester-signs-the-fund-lock.md.
 */
export async function postReviewOrder(
  request: ReviewOrderRequest,
  deps: PostDeps,
): Promise<PostedOrder> {
  const packaged = await packageReviewOrder(request, deps);
  const { envelope } = packaged;

  // The whitelist compares the returned bytes against these, never against
  // what the bytes claim. They are ours: the id was minted at the 402 and the
  // price and requester come from the envelope we just packaged.
  const escrow = await deps.chain.submitFundLock(
    {
      orderId: envelope.order_id,
      amountTinybars: envelope.price_tinybars,
      requesterAccountId: deps.requesterAccountId,
    },
    deps.signedFundLock,
  );

  let consensus;
  try {
    consensus = await deps.chain.submitMessage(deps.ordersTopicId, packaged.body);
  } catch (error) {
    // The funds are locked and the envelope is not out. Carry the lock's id:
    // it is the requester's money, it has moved, and the caller needs to know
    // that before they decide what to do next.
    throw new OrderError(
      `order ${envelope.order_id} locked its funds but the envelope did not publish ` +
        `(${(error as Error).message}). fundLock ${escrow.transactionId}`,
      escrow.transactionId,
    );
  }

  // No createSchedule here. The payee is unknown until somebody claims, and a
  // payout record is a hash of parameters that include the payee.

  const posted: PostedOrder = {
    ...packaged,
    orderId: envelope.order_id,
    escrowAccountId: escrow.escrowAccountId,
    consensusTimestamp: consensus.consensusTimestamp,
    sequenceNumber: consensus.sequenceNumber,
    transactionIds: {
      fundLock: escrow.transactionId,
      submitEnvelope: consensus.transactionId,
    },
  };

  try {
    assertClaimTimeoutFitsWindow(consensusEpochSeconds(consensus.consensusTimestamp), envelope);
  } catch (error) {
    // The envelope is already published, so this cannot be undone by throwing.
    // Carry the ids out with the failure: whoever handles this needs them to
    // find the order that must not be claimed.
    throw new OrderError(
      `order ${envelope.order_id} was published but its claim timeout does not fit the ` +
        `window the network assigned (${(error as Error).message}). ` +
        `fundLock ${escrow.transactionId}, submitEnvelope ${consensus.transactionId}`,
      escrow.transactionId,
    );
  }

  return posted;
}

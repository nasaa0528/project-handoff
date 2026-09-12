/**
 * Reading an order's state back off the public topics.
 *
 * MCP is request/response and nothing pushes, so a requester who closed the
 * laptop after posting has no way to learn what happened. Without a query the
 * flow ends at beat 3 for a real user, however well the rest of it works. See
 * `../../../docs/decisions/2026-09-06-ux-fixes-from-persona-and-laws.md`.
 *
 * **This is a query, not a polling loop.** It answers once, from the mirror
 * node, and nothing here retries or waits.
 *
 * **Free, and it has to stay free of anything private.** Reads are ungated by
 * `../../../docs/decisions/2026-09-05-gate-covers-order-posting-only.md`, whose
 * standing consequence is that nothing on a read path may return anything the
 * HCS topics do not already make public. Everything below comes off a topic any
 * mirror node will serve to anybody. The spec and the artifact are in the
 * content store and are not read here.
 */

import * as z from "zod";
import {
  Attestation as AttestationSchema,
  decodeAttestation,
  decodeEnvelope,
  OrderEnvelope as OrderEnvelopeSchema,
  resolveClaims,
  tryDecodeClaim,
  Verdict as VerdictSchema,
  type Attestation,
  type ChainAdapter,
  type ClaimRecord,
  type ClaimResolution,
  type OrderEnvelope,
} from "@handoff/schema";

/**
 * What we can prove about an order from the topics alone.
 *
 * `CLAIMED` is read, not inferred. A claim is a `ClaimEnvelope` on the orders
 * topic submitted from the claimant's own account, so the same scan that finds
 * the order envelope finds every claim for it, and `resolveClaims` — the
 * treaty's rule, the one the expert app calls — says which one holds it. The
 * rule is not reimplemented here on purpose: a rule with two ends implemented
 * twice is a rule that disagrees with itself.
 */
export type ReadableOrderState = "POSTED" | "CLAIMED" | "DELIVERED" | "UNKNOWN";

/**
 * What a status read answers, as a parser first and a type second.
 *
 * One declaration, not two. The MCP tool reads this back over HTTP and puts
 * the verdict straight in front of a requester, so the body is parsed rather
 * than asserted — a cast would make a malformed or hostile response
 * indistinguishable from a real one at exactly the point where the words carry
 * the most weight.
 */
export const OrderStatusShape = z.object({
  orderId: z.string().min(1),
  state: z.enum(["POSTED", "CLAIMED", "DELIVERED", "UNKNOWN"]),
  envelope: OrderEnvelopeSchema.optional(),
  /** The consensus timestamp the envelope landed at. Ordering truth. */
  postedAt: z.string().optional(),
  attestation: AttestationSchema.optional(),
  verdict: VerdictSchema.optional(),
  /**
   * The account that paid to submit the attestation.
   *
   * That is all this is. It is not proof the account holds the credential:
   * the attestations topic carries no submit key on purpose, and the registry
   * that would check one is not live. Copy built from this must not call the
   * signer certified.
   */
  signedBy: z.string().optional(),
  signedAt: z.string().optional(),
  /**
   * The account that holds the order, once one does.
   *
   * The claimant is the account that paid to submit the claim, never a field
   * in the body, and it carries exactly as much weight as `signedBy`: it says
   * who, not that they hold the credential. No registry checks the cert tag
   * this week, so copy built from this must not call the claimant certified.
   */
  claimedBy: z.string().optional(),
  claimedAt: z.string().optional(),
  /**
   * When the holder's claim expires, as a UTC instant. The earlier of the
   * claim timeout and the order deadline — the window never outlives the
   * order. Present only while the state is `CLAIMED`.
   */
  signBy: z.string().optional(),
  /**
   * Whether the server can see claims at all.
   *
   * True since the server reads the orders topic for claims as well as
   * envelopes. It stays in the shape rather than being deleted because the
   * expert app and the requester screens both branch on it, and because a
   * reader that lost the ability to see claims — a topic id misconfigured,
   * say — has to be able to say so instead of reporting an order as open.
   */
  claimReadable: z.boolean(),
});

export type OrderStatus = z.infer<typeof OrderStatusShape>;

export interface StatusDeps {
  readonly chain: ChainAdapter;
  readonly ordersTopicId: string;
  readonly attestationsTopicId: string;
  /** Pages read per topic, as a stop rather than a tuning knob. */
  readonly maxPages?: number;
  readonly pageSize?: number;
  /**
   * The reader's clock, in epoch seconds, for deciding whether a claim window
   * has run out. Injectable so a test can sit either side of an expiry without
   * waiting an hour; in production it is this process's clock, which is the
   * honest answer for a read the mirror node does not timestamp.
   */
  readonly nowEpochSeconds?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 40;

/**
 * Walk a topic and hand every message to a reader.
 *
 * Paged on purpose. A mirror node returns 25 by default and paginates through
 * `links.next`, so a reader that takes the first page silently stops seeing
 * orders once a topic has more than a page of them — and it stops seeing the
 * newest ones, which are exactly the ones anybody is asking about.
 */
async function scanTopic<T>(
  topicId: string,
  deps: StatusDeps,
  read: (
    contents: string,
    consensusTimestamp: string,
    payerAccountId: string,
    sequenceNumber: number,
  ) => T | undefined,
): Promise<readonly T[]> {
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;

  let afterSequenceNumber: number | undefined;
  const found: T[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const messages = await deps.chain.readMessages(topicId, {
      limit: pageSize,
      ...(afterSequenceNumber === undefined ? {} : { afterSequenceNumber }),
    });

    if (messages.length === 0) {
      return found;
    }

    for (const message of messages) {
      // A topic with no submit key takes anything anybody submits, so a
      // message that does not parse is ordinary noise, not an error worth
      // failing a status query over.
      let candidate: T | undefined;
      try {
        candidate = read(
          message.contents,
          message.consensusTimestamp,
          message.payerAccountId,
          message.sequenceNumber,
        );
      } catch {
        continue;
      }
      // Every match, in consensus order, rather than one. Claims need all of
      // them to resolve a winner, and a caller that wants the last — a later
      // attestation supersedes an earlier one — takes the last of these.
      if (candidate !== undefined) {
        found.push(candidate);
      }
    }

    const last = messages[messages.length - 1];
    if (last === undefined || messages.length < pageSize) {
      return found;
    }
    afterSequenceNumber = last.sequenceNumber;
  }

  return found;
}

/**
 * One sighting on the orders topic. Orders and claims share it, and the two
 * shapes cannot be confused by a parser: the order envelope is a strict object
 * with no `kind`, the claim is a strict object that requires one.
 */
type OrderSighting =
  | { readonly kind: "order"; readonly envelope: OrderEnvelope; readonly consensusTimestamp: string }
  | { readonly kind: "claim"; readonly record: ClaimRecord };

/** Seconds → the schema's `Utc` shape: second precision, `Z` only. */
function epochSecondsToUtc(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** One attestation as read off the topic, with what the network attached to it. */
export interface AttestationRecord {
  readonly attestation: Attestation;
  readonly consensusTimestamp: string;
  /** The account that paid to submit it. Not proof of anything but authorship. */
  readonly payerAccountId: string;
}

/**
 * Everything the topics say about one order, before anything is decided.
 *
 * Separate from `readOrderStatus` because the two readers want different
 * things out of the same scan. A status read is a *display*: it shows the last
 * attestation whoever wrote it, and shows `claimedBy` beside `signedBy` so a
 * requester can compare them. The settle path cannot afford that reading — it
 * pays money against an attestation, so it has to pick the claimant's own out
 * of every message on a topic that has no submit key, and a stray one must not
 * be able to shadow the real one.
 *
 * Duplicating the scan for that was the alternative and it is the worse one:
 * two readers of the same topics that disagree about what they saw.
 */
export interface OrderFacts {
  readonly posted?: { readonly envelope: OrderEnvelope; readonly consensusTimestamp: string };
  readonly claims: readonly ClaimRecord[];
  /** In consensus order, every one of them, whoever submitted. */
  readonly attestations: readonly AttestationRecord[];
  /** The treaty's answer to who holds the order. Absent when the envelope is not visible. */
  readonly holder?: ClaimResolution;
}

/** Read the topics once and hand back what they say. */
export async function readOrderFacts(orderId: string, deps: StatusDeps): Promise<OrderFacts> {
  // One scan, not two. Claims live on the orders topic, so reading them
  // separately would double every mirror-node read this query makes.
  const sightings = await scanTopic<OrderSighting>(
    deps.ordersTopicId,
    deps,
    (contents, consensusTimestamp, payerAccountId, sequenceNumber) => {
      const claim = tryDecodeClaim(contents);
      if (claim !== null) {
        return claim.order_id === orderId
          ? { kind: "claim", record: { claim, payerAccountId, consensusTimestamp, sequenceNumber } }
          : undefined;
      }
      const envelope = decodeEnvelope(contents);
      return envelope.order_id === orderId
        ? { kind: "order", envelope, consensusTimestamp }
        : undefined;
    },
  );

  let posted: { readonly envelope: OrderEnvelope; readonly consensusTimestamp: string } | undefined;
  const claims: ClaimRecord[] = [];
  for (const sighting of sightings) {
    if (sighting.kind === "claim") {
      claims.push(sighting.record);
    } else {
      // The last envelope wins, the same rule as the attestation: consensus
      // order is the truth.
      posted = sighting;
    }
  }

  const attestations = await scanTopic(
    deps.attestationsTopicId,
    deps,
    (contents, consensusTimestamp, payerAccountId) => {
      const attestation = decodeAttestation(contents);
      return attestation.order_id === orderId
        ? { attestation, consensusTimestamp, payerAccountId }
        : undefined;
    },
  );

  /**
   * Who holds the order, by the treaty's rule. Unanswerable without the
   * envelope, because the rule reads the cert tag, the deadline and the claim
   * timeout off it — a claim for an order we cannot see is a claim we cannot
   * score.
   */
  /**
   * Who holds the order, by the treaty's rule.
   *
   * Two passes, and the second one is what keeps a stranger from deciding it.
   * `resolveClaims` treats *any* `deliveredAt` as proof that the **first**
   * claim was delivered and stops expiring it — it has no way to ask whose
   * attestation it was handed. The attestations topic has no submit key, so
   * while this passed the last message from anybody, one stranger's message
   * made a lapsed claim final and the expert who actually claimed the reopen
   * and did the work could not be paid.
   *
   * So: resolve once on the claims alone to see who that first claimant is,
   * and pass `deliveredAt` only when it is *their own* attestation and no
   * reopen has already happened. That preserves the documented grace — a
   * verdict signed a second after the window closed is a delivered claim, not
   * an expired one — while a message from anybody else changes nothing.
   *
   * TODO(NAS): the exact rule needs `resolveClaims` to see the attestations,
   * because only it knows which claim won. One case is still wrong here: if
   * the first claimant delivers late *and* somebody has already claimed the
   * reopen, the treaty says the delivered first claim wins and this gives it
   * to the reopener. Narrow, and unreachable while reopen is unwired, but it
   * belongs in `packages/schema/src/claim.ts`.
   */
  const nowEpochSeconds = deps.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const holder =
    posted === undefined
      ? undefined
      : resolveWithDelivery(posted.envelope, claims, attestations, nowEpochSeconds);

  return {
    ...(posted === undefined ? {} : { posted }),
    claims,
    attestations,
    ...(holder === undefined ? {} : { holder }),
  };
}

/**
 * `resolveClaims`, told about a delivery only when it is the first claimant's own.
 *
 * See the note at the call site for why the shape is two passes rather than
 * one argument.
 */
function resolveWithDelivery(
  order: OrderEnvelope,
  claims: readonly ClaimRecord[],
  attestations: readonly AttestationRecord[],
  nowEpochSeconds: number,
): ClaimResolution {
  const provisional = resolveClaims({ order, claims, nowEpochSeconds });

  const candidate =
    provisional.state === "claimed"
      ? provisional.active
      : provisional.state === "claim_timeout"
        ? provisional.expired
        : undefined;

  // A reopen has already happened, so the claim `deliveredAt` would make final
  // is not the one this candidate holds. Passing it would hand the order back
  // to the claimant who let their window lapse.
  if (candidate === undefined || candidate.reopened) {
    return provisional;
  }

  const theirs = attestations.find(
    (record) => record.payerAccountId === candidate.claimantAccountId,
  );
  if (theirs === undefined) {
    return provisional;
  }

  return resolveClaims({
    order,
    claims,
    nowEpochSeconds,
    deliveredAt: theirs.consensusTimestamp,
  });
}

/** Read what the topics say about one order, as a requester reads it. */
export async function readOrderStatus(
  orderId: string,
  deps: StatusDeps,
): Promise<OrderStatus> {
  const facts = await readOrderFacts(orderId, deps);
  const { posted, attestations } = facts;
  const delivered = attestations.at(-1);
  const holder = facts.holder;
  const held = holder?.state === "claimed" ? holder.active : undefined;

  if (delivered !== undefined) {
    return {
      orderId,
      state: "DELIVERED",
      claimReadable: true,
      ...(posted === undefined
        ? {}
        : { envelope: posted.envelope, postedAt: posted.consensusTimestamp }),
      attestation: delivered.attestation,
      verdict: delivered.attestation.verdict,
      signedBy: delivered.payerAccountId,
      signedAt: delivered.consensusTimestamp,
      // Carried on a delivered order too, so a reader can compare it with
      // `signedBy` themselves. The topic has no submit key, so an attestation
      // from an account that never held the claim is a thing that can happen
      // and a requester is entitled to see both accounts rather than one.
      ...(held === undefined
        ? {}
        : { claimedBy: held.claimantAccountId, claimedAt: held.claimedAt }),
    };
  }

  if (posted !== undefined && held !== undefined) {
    return {
      orderId,
      state: "CLAIMED",
      claimReadable: true,
      envelope: posted.envelope,
      postedAt: posted.consensusTimestamp,
      claimedBy: held.claimantAccountId,
      claimedAt: held.claimedAt,
      signBy: epochSecondsToUtc(held.signByEpochSeconds),
    };
  }

  if (posted !== undefined) {
    // Unclaimed, or claimed by somebody whose window ran out. Both read as
    // POSTED: the order is open to a claim again, and the one case where it is
    // not — a second window expired, so no reopen remains — is the lifecycle's
    // to close, not a status read's to invent a state for.
    return {
      orderId,
      state: "POSTED",
      claimReadable: true,
      envelope: posted.envelope,
      postedAt: posted.consensusTimestamp,
    };
  }

  // Not a 404. The order may be seconds old and the mirror node lags about six
  // seconds behind consensus, so "we cannot see it" is the honest answer and
  // "it does not exist" is a guess.
  return { orderId, state: "UNKNOWN", claimReadable: true };
}

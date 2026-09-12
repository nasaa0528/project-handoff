/**
 * The resource server: `POST /orders`, behind the payment gate.
 *
 * The sequence, and the order is the design:
 *
 * 1. Gate. No payment, or a payment the facilitator rejects, is answered with
 *    402 and the price. Nothing else happens.
 * 2. Post. The order envelope publishes and the funds lock.
 * 3. Settle. Only now does the fee actually move, and its receipt rides back
 *    in the `PAYMENT-RESPONSE` header.
 *
 * Settling last is deliberate. `/verify` proves the payment is good without
 * submitting it, so a failure to post the order leaves the caller's money
 * untouched — they were charged for a service they did not receive only if we
 * settle first, and we do not.
 */

import * as z from "zod";
import {
  formatTinybars,
  FundLockError,
  FundLockSubmitError,
  hbarToTinybars,
  sha256Hex,
  Utc,
  type ChainAdapter,
} from "@handoff/schema";
import type { ContentStore } from "./content.js";
import { defaultOrderId, OrderError, postReviewOrder } from "./order.js";
import {
  gate,
  headerLookup,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  settle,
  type GateConfig,
} from "./x402/gate.js";
import type { Facilitator } from "./x402/facilitator.js";
import type { CertTagOption } from "./config.js";
import type { PayoutSighting } from "@handoff/chain";
import { SettleError, settleOrder } from "./settle.js";
import { readOrderStatus } from "./status.js";
import { unknownTagReply } from "./replies.js";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  /**
   * The body as it arrived.
   *
   * Bytes rather than a string because the content endpoint is addressed by
   * the sha-256 of exactly these bytes, and a utf8 round trip is not the
   * identity function for every input. Everything else decodes at the one
   * place that parses JSON.
   */
  readonly body: Buffer;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  /**
   * Bytes to write instead of JSON, for the content reads. When this is set
   * `body` is ignored, so the two never disagree about what was served.
   */
  readonly bytes?: Uint8Array;
}

export interface ServerDeps {
  readonly facilitator: Facilitator;
  readonly gateConfig: GateConfig;
  readonly chain: ChainAdapter;
  readonly content: ContentStore;
  readonly ordersTopicId: string;
  readonly attestationsTopicId: string;
  /** The one shared escrow. Needed to settle; never invented by this process. */
  readonly escrowAccountId: string;
  /**
   * "Has this order already been paid?", answered by the mirror node.
   *
   * Passed straight through to `settleOrder`, which asks it before anything
   * else so a retry of a settle that already paid is a 200 rather than a
   * retryable 409. See `SettleDeps.findPayout`.
   */
  readonly findPayout: (orderId: string) => Promise<PayoutSighting | null>;
  readonly certTags: readonly CertTagOption[];
  /** Injectable so tests are deterministic. Minted at the 402. */
  readonly newOrderId?: () => string;
}

/**
 * The request body of `handoff_verify`.
 *
 * `class` is accepted and pinned rather than ignored: an agent that asks for
 * an `execution` order gets told this build does not sell one, instead of
 * quietly receiving a review.
 */
const OrderRequestBody = z.strictObject({
  class: z.literal("review").default("review"),
  /**
   * Whose account funds the escrow.
   *
   * A claim, not a credential. Anyone can put anyone's account id here, so it
   * is checked below against the account the facilitator says actually paid,
   * and only the verified one is ever used. It has to be in the body rather
   * than in the server's configuration because a service reachable by more
   * than one requester cannot know the caller from an environment variable.
   */
  requester_account_id: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "expected a Hedera account id like 0.0.1234"),
  spec: z.string().min(1),
  /** Base64, because JSON has no bytes. Never published, only hashed. */
  artifact_base64: z.string().min(1),
  cert_tag: z.string().min(1),
  /**
   * Delegated to the money module rather than re-expressed as a regex here.
   * A bound that exists in two places is a bound that will disagree with
   * itself, and this one decides how much money is at stake.
   */
  price_hbar: z.string().refine(
    (value) => {
      try {
        hbarToTinybars(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "not an HBAR amount, for example 200 or 0.5" },
  ),
  deadline: Utc,
  claim_timeout_seconds: z.int().positive(),
  /**
   * The order id this call is for, minted by the 402 and echoed back.
   *
   * Absent on the first call, because there is no order yet. Required on the
   * paid retry: it is the memo inside the signed fund lock, and the only thing
   * binding those bytes to this order — the escrow is one shared account, so
   * without it two orders at the same price from the same requester are
   * satisfied by the same lock.
   */
  order_id: z
    .string()
    .regex(/^ord_[0-9a-f]{32}$/, "not an order id this service minted")
    .optional(),
  /**
   * The fund lock the requester signed, base64.
   *
   * Untrusted, and never parsed here. `submitFundLock` validates it against
   * the parameters the server holds before anything executes.
   */
  signed_fund_lock: z.string().min(1).optional(),
});

const json = { "Content-Type": "application/json" } as const;

/**
 * The expert app runs on its own origin and reads content from this one, so
 * the browser needs to be told that is allowed. `*` is the honest value: the
 * resource is already public to anyone holding the hash, and the hashes are on
 * a public topic.
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

/**
 * What a PUT may store. Notes are a few kilobytes; the artifact arrives with
 * the order, not through here. Small enough that filling the store is tedious,
 * large enough that no honest write hits it.
 */
export const CONTENT_PUT_MAX_BYTES = 256 * 1024;

/**
 * Every answer is readable from another origin, and every route answers a
 * preflight. The expert app is a browser build on its own domain, and the
 * requests screen reads `/tags` and `/orders/{id}` and makes the free first
 * `POST /orders` from there; without these headers the browser drops the
 * answer on the floor and the form shows an empty reviewer list. `*` is honest
 * for the same reason as on `/content`: nothing here is private to an origin,
 * and the gate charges by payment header, not by who is asking. The two x402
 * response headers are exposed because a browser cannot read a 402 otherwise.
 */
const open = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": `${PAYMENT_REQUIRED_HEADER}, ${PAYMENT_RESPONSE_HEADER}`,
} as const;

const preflight = {
  ...open,
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": `content-type, ${PAYMENT_SIGNATURE_HEADER}, X-PAYMENT`,
  "Access-Control-Max-Age": "86400",
} as const;

export async function handle(request: HttpRequest, deps: ServerDeps): Promise<HttpResponse> {
  if (request.method === "OPTIONS") {
    return { status: 204, headers: preflight, body: null };
  }
  const answer = await route(request, deps);
  return { ...answer, headers: { ...answer.headers, ...open } };
}

async function route(request: HttpRequest, deps: ServerDeps): Promise<HttpResponse> {
  // Deliberately free and deliberately not a payment surface. It says the
  // process is up, nothing about the chain or the facilitator, so it cannot
  // become a way to read anything the gate is supposed to charge for.
  if (request.path === "/health") {
    return { status: 200, headers: json, body: { status: "ok", network: deps.gateConfig.network } };
  }

  // Free, like /health and for the same reason as every other read: the gate
  // covers order posting only, and this list is what an agent needs before it
  // can post a routable order at all.
  if (request.path === "/tags") {
    if (request.method !== "GET") {
      return { status: 405, headers: { ...json, Allow: "GET" }, body: { error: "use GET" } };
    }
    return { status: 200, headers: json, body: { tags: deps.certTags } };
  }

  // Content, addressed by the hash the envelope committed to. Free and
  // unauthenticated, decided in
  // docs/decisions/2026-09-09-content-reads-are-by-hash-and-unauthenticated.md:
  // the expert app is a browser build and cannot hold the store's credentials,
  // so this process answers for it. Anyone holding the hash can read the
  // bytes, and the hashes are on a public topic — certification routes an
  // order, it does not keep the document secret. Every demo artifact is
  // fabricated for that reason (hard rule 7).
  const contentPath = /^\/content\/([0-9a-f]{64})$/.exec(request.path);
  if (contentPath !== null) {
    const hash = contentPath[1] ?? "";

    // The expert app is served from another origin, so the browser preflights
    // the PUT before it is allowed to send one.
    if (request.method === "OPTIONS") {
      return { status: 204, headers: { ...cors, "Access-Control-Max-Age": "86400" }, body: null };
    }

    if (request.method === "GET") {
      let bytes: Uint8Array | null;
      try {
        bytes = await deps.content.get(hash);
      } catch (error) {
        // The store had something and it does not hash to what was asked for.
        // Saying "not found" would be a lie that hides a broken commitment.
        return {
          status: 502,
          headers: { ...json, ...cors },
          body: { error: "the stored content does not match its hash", hash },
        };
      }
      if (bytes === null) {
        return { status: 404, headers: { ...json, ...cors }, body: { error: "no content under that hash" } };
      }
      return {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          // Content-addressed, so these bytes can never change under this URL.
          "Cache-Control": "public, max-age=31536000, immutable",
          ...cors,
        },
        body: null,
        bytes,
      };
    }

    if (request.method === "PUT") {
      if (request.body.byteLength > CONTENT_PUT_MAX_BYTES) {
        return {
          status: 413,
          headers: { ...json, ...cors },
          body: { error: `content over ${CONTENT_PUT_MAX_BYTES} bytes`, limit: CONTENT_PUT_MAX_BYTES },
        };
      }
      // The whole authorization story, and it is enough to stop one thing:
      // nobody can replace content with different content, because the bytes
      // have to be what the path already says they are. It does not stop
      // somebody filling the store with hash-valid noise, which is what the
      // cap above is for.
      const actual = sha256Hex(request.body);
      if (actual !== hash) {
        return {
          status: 400,
          headers: { ...json, ...cors },
          body: { error: "the body does not hash to the hash in the path", expected: hash, actual },
        };
      }
      try {
        await deps.content.put(hash, request.body);
      } catch {
        // Caught rather than left to the catch-all in http.ts, which answers
        // with the thrown message. The store's messages name the bucket and
        // the vendor's own error text, and this endpoint is reachable by
        // anyone; the caller can act on "it did not store" and nothing more.
        return { status: 502, headers: { ...json, ...cors }, body: { error: "the content store did not take it" } };
      }
      return { status: 200, headers: { ...json, ...cors }, body: { hash } };
    }

    return { status: 405, headers: { ...json, ...cors, Allow: "GET, PUT, OPTIONS" }, body: { error: "use GET or PUT" } };
  }

  // Releasing the escrow. Ungated, and deliberately so: the x402 gate covers
  // order posting only (decision 2026-09-05), and this call charges nobody —
  // it moves money the requester already locked, to the expert who already
  // signed, on facts that are already public. A caller cannot make it pay
  // anything other than what the topics say, so there is nothing to sell here.
  const orderSettle = /^\/orders\/([^/]+)\/settle$/.exec(request.path);
  if (orderSettle !== null) {
    if (request.method !== "POST") {
      return { status: 405, headers: { ...json, Allow: "POST" }, body: { error: "use POST" } };
    }
    let orderId: string;
    try {
      orderId = decodeURIComponent(orderSettle[1] ?? "");
    } catch {
      return { status: 400, headers: json, body: { error: "that is not a usable order id" } };
    }

    try {
      const settlement = await settleOrder(orderId, {
        chain: deps.chain,
        ordersTopicId: deps.ordersTopicId,
        attestationsTopicId: deps.attestationsTopicId,
        escrowAccountId: deps.escrowAccountId,
        findPayout: deps.findPayout,
      });
      return { status: 200, headers: json, body: settlement };
    } catch (error) {
      if (error instanceof SettleError) {
        // 409, not 400. The request was fine; the order is not in a state that
        // pays yet. `retryable` is the half a caller acts on: a violation
        // never becomes payable and a poller must stop.
        return {
          status: 409,
          headers: json,
          body: {
            error: error.refusal.kind === "violation" ? "schema violation" : "not ready to settle",
            message: error.refusal.message,
            // A not-ready that cannot change — an order past its deadline
            // with nobody holding it — says so, or a poller waits forever.
            retryable: error.refusal.kind === "not-ready" && error.refusal.retryable !== false,
            ...(error.refusal.kind === "not-ready" ? { state: error.refusal.state } : {}),
          },
        };
      }
      // The chain or the mirror node failed. Never flatten this into "could
      // not settle": the message may carry the transaction id of a payout
      // whose outcome is unknown, and that is the one thing the caller needs.
      return {
        status: 502,
        headers: json,
        body: { error: "the payout did not complete", detail: (error as Error).message },
      };
    }
  }

  // Reads are ungated by decision. Everything returned here is already on a
  // public topic that any mirror node serves without asking us, so there is
  // nothing to charge for and nothing private to leak.
  const orderRead = /^\/orders\/([^/]+)$/.exec(request.path);
  if (orderRead !== null) {
    if (request.method !== "GET") {
      return { status: 405, headers: { ...json, Allow: "GET" }, body: { error: "use GET" } };
    }
    let orderId: string;
    try {
      orderId = decodeURIComponent(orderRead[1] ?? "");
    } catch {
      // `decodeURIComponent("%")` throws. This route is unauthenticated, so a
      // malformed id is an ordinary answer rather than something to raise.
      return { status: 400, headers: json, body: { error: "that is not a usable order id" } };
    }

    const status = await readOrderStatus(orderId, {
      chain: deps.chain,
      ordersTopicId: deps.ordersTopicId,
      attestationsTopicId: deps.attestationsTopicId,
    });
    return { status: 200, headers: json, body: status };
  }

  if (request.path !== "/orders") {
    return { status: 404, headers: json, body: { error: "not found" } };
  }
  if (request.method !== "POST") {
    return { status: 405, headers: { ...json, Allow: "POST" }, body: { error: "use POST" } };
  }

  const gateDeps = { facilitator: deps.facilitator, config: deps.gateConfig };

  // The body is parsed before the gate now, because the 402 has to carry a
  // fund lock and a lock cannot be built without the price, the requester and
  // an order id. The deliberate consequence: a malformed body returns 400
  // rather than 402. Nothing is charged either way — the caller never gets far
  // enough to pay — but the status changes and the tests say so.
  const parsed = OrderRequestBody.safeParse(parseJson(request.body.toString("utf8")));
  if (!parsed.success) {
    return {
      status: 400,
      headers: json,
      body: { error: "invalid order", detail: z.treeifyError(parsed.error) },
    };
  }

  // The tag is the routing, so an unknown one is refused before a price is
  // ever quoted. Nothing has been charged at this point and the reply says so.
  if (!deps.certTags.some((tag) => tag.code === parsed.data.cert_tag)) {
    return {
      status: 400,
      headers: json,
      body: {
        error: "unknown credential tag",
        message: unknownTagReply(parsed.data.cert_tag, deps.certTags),
        available: deps.certTags,
      },
    };
  }

  let outcome;
  try {
    outcome = await gate(headerLookup(request.headers), "/orders", gateDeps);
  } catch (error) {
    // We settle through a facilitator we do not run, so its outage is a
    // failure mode we own the presentation of. An unpriced 503 is honest:
    // we cannot state a price we cannot have co-signed.
    return {
      status: 503,
      headers: { ...json, "Retry-After": "30" },
      body: { error: "the payment facilitator is unreachable", detail: (error as Error).message },
    };
  }

  if (outcome.kind === "payment-required") {
    // The 402 mints the order id and hands back the transfer the requester
    // will sign. Both travel in the JSON body beside the x402 challenge rather
    // than inside it: `accepts` is @x402/core's shape and ours to leave alone.
    const orderId = (deps.newOrderId ?? defaultOrderId)();
    let fundLock;
    try {
      fundLock = await deps.chain.buildFundLock({
        orderId,
        amountTinybars: formatTinybars(hbarToTinybars(parsed.data.price_hbar)),
        requesterAccountId: parsed.data.requester_account_id,
      });
    } catch (error) {
      return {
        status: 500,
        headers: json,
        body: { error: "could not build the fund lock", detail: (error as Error).message },
      };
    }
    return {
      status: outcome.status,
      headers: outcome.headers,
      body: {
        ...outcome.body,
        fund_lock: {
          order_id: orderId,
          escrow_account_id: fundLock.escrowAccountId,
          transaction_bytes: fundLock.transactionBytes,
          memo: fundLock.memo,
          valid_until: fundLock.validUntil,
        },
      },
    };
  }

  // Who pays is settled by the facilitator, never by the caller's own say-so.
  // Same slot as the tag check: after verify, before settle, before anything
  // is published, so a refusal here has taken nothing.
  if (outcome.payer === undefined) {
    return {
      status: 502,
      headers: json,
      body: {
        error: "the facilitator verified the payment but did not say who paid",
        message:
          "The payment checked out, but the facilitator did not name the account it came " +
          "from, and the escrow cannot be funded by an account nobody has vouched for. " +
          "Nothing was charged.",
      },
    };
  }
  if (outcome.payer !== parsed.data.requester_account_id) {
    return {
      status: 400,
      headers: json,
      body: {
        error: "the order names a different requester than the one who paid",
        message:
          `The order says ${parsed.data.requester_account_id} is the requester, but the ` +
          `service fee was paid from ${outcome.payer}. An order is funded by the account ` +
          `that paid for it. Nothing was charged.`,
      },
    };
  }

  // Minted at the 402 and echoed back. Without both of these there is nothing
  // to submit and nothing binding a lock to this order, so refuse before
  // settling: the caller still has their money.
  //
  // **The caller cannot choose this id, even though they send it.** To post
  // under some id X they need a lock memoed X, the memo sits inside the signed
  // body, and only this server mints one — at the 402, as a random uuid. An id
  // the whitelist has not seen a matching lock for is refused by
  // `submitFundLock` before anything executes. Replaying a spent lock is
  // refused too, by the network: DUPLICATE_TRANSACTION inside the receipt
  // period and TRANSACTION_EXPIRED past it. The shape check above is a cheap
  // second fence, not the one doing the work.
  const { order_id: orderId, signed_fund_lock: signedFundLock } = parsed.data;
  if (orderId === undefined || signedFundLock === undefined) {
    return {
      status: 400,
      headers: json,
      body: {
        error: "the paid call carries no signed fund lock",
        message:
          "The escrow is funded by your own signature now. Call again without payment to " +
          "get a fund lock to sign, then retry with order_id and signed_fund_lock. " +
          "Nothing was charged.",
      },
    };
  }

  let posted;
  try {
    posted = await postReviewOrder(
      {
        spec: parsed.data.spec,
        artifact: Buffer.from(parsed.data.artifact_base64, "base64"),
        certTag: parsed.data.cert_tag,
        priceHbar: parsed.data.price_hbar,
        deadline: parsed.data.deadline,
        claimTimeoutSeconds: parsed.data.claim_timeout_seconds,
      },
      {
        chain: deps.chain,
        content: deps.content,
        ordersTopicId: deps.ordersTopicId,
        // The verified account, not the one the body claimed. They are equal
        // by the check above; reading it from the payment keeps that obvious.
        requesterAccountId: outcome.payer,
        signedFundLock,
        // The id the 402 minted. Reusing it is what lets the memo inside the
        // signed bytes match, so a lock built for another order is refused.
        newOrderId: () => orderId,
      },
    );
  } catch (error) {
    // Never settle on this path. What differs is what the caller should do
    // next, and that turns entirely on whether their money moved — so these
    // are told apart rather than flattened into one 502. A caller who cannot
    // distinguish "nothing happened" from "your escrow is funded" answers the
    // second by ordering again, and funds a second escrow for one order.

    // Refused by the whitelist, before anything executed. The caller's own
    // bytes are wrong and they can rebuild: nothing moved, nothing was taken.
    if (error instanceof FundLockError) {
      return {
        status: 400,
        headers: json,
        body: {
          error: "the fund lock was refused",
          reason: error.reason,
          message:
            `The fund lock did not match the order it was issued for (${error.reason}). ` +
            `Call again without payment to get a fresh one. Nothing was charged.`,
          detail: error.message,
        },
      };
    }

    // Submitted and refused by the network. DUPLICATE_TRANSACTION is the one
    // that means the escrow *is* funded — by an earlier submission of these
    // same bytes — so it must never read as "try again".
    if (error instanceof FundLockSubmitError) {
      const funded = error.status === "DUPLICATE_TRANSACTION";
      return {
        status: 502,
        headers: json,
        body: {
          error: "the fund lock did not settle",
          network_status: error.status,
          transaction_id: error.transactionId ?? "",
          escrow_funded: funded,
          message: funded
            ? `This fund lock was already submitted, so the escrow is funded. Read ` +
              `${error.transactionId} on a mirror node before doing anything else — ` +
              `ordering again would lock a second time for the same order.`
            : `The network refused the fund lock with ${error.status}. Nothing was ` +
              `charged and no funds moved.`,
          detail: error.message,
        },
      };
    }

    // The lock landed and the order did not finish. The requester's money has
    // moved; say so, and hand back the id that proves it.
    if (error instanceof OrderError && error.escrowTransactionId !== undefined) {
      return {
        status: 502,
        headers: json,
        body: {
          error: "the funds are locked but the order did not post",
          transaction_id: error.escrowTransactionId,
          escrow_funded: true,
          message:
            `Your ${parsed.data.price_hbar} HBAR is in escrow (${error.escrowTransactionId}) ` +
            `and the order did not finish publishing. Do not order again — that would lock ` +
            `a second time. The service fee was not charged.`,
          detail: error.message,
        },
      };
    }

    // Everything else: the payment is verified but unsettled, so the caller
    // still has their money and can retry.
    return {
      status: 502,
      headers: json,
      body: { error: "the order did not post", detail: (error as Error).message },
    };
  }

  // Past this point the envelope is published and the funds are locked, so
  // there is no failure worth hiding the order behind. A settlement that
  // throws is reported the same way as one that comes back unsuccessful: the
  // caller gets their order id either way, and we say the fee did not land.
  let settled: Awaited<ReturnType<typeof settle>> | undefined;
  let settleError: string | undefined;
  try {
    settled = await settle(outcome, gateDeps);
  } catch (error) {
    settleError = (error as Error).message;
  }

  const feeFailure = settleError ?? (settled?.receipt.success === false
    ? settled.receipt.errorReason ?? settled.receipt.errorMessage ?? "settlement failed"
    : undefined);

  return {
    status: 200,
    headers: { ...json, ...(settled?.headers ?? {}) },
    body: {
      order_id: posted.orderId,
      escrow_account_id: posted.escrowAccountId,
      consensus_timestamp: posted.consensusTimestamp,
      sequence_number: posted.sequenceNumber,
      // Threaded, never swallowed. Settlement state is read from a mirror
      // node; these are how you find it.
      transaction_ids: {
        fund_lock: posted.transactionIds.fundLock,
        submit_envelope: posted.transactionIds.submitEnvelope,
        service_fee: settled?.receipt.transaction ?? "",
      },
      service_fee: {
        settled: feeFailure === undefined,
        // What we charged, stated by the side that set the price. The caller
        // saw it in the 402, but the reply should not make them go back for it.
        amount_tinybars: deps.gateConfig.feeTinybars,
        payer: outcome.payer ?? settled?.receipt.payer,
        ...(feeFailure === undefined ? {} : { error: feeFailure }),
      },
    },
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

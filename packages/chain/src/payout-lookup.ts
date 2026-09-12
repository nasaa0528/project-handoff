/**
 * "Has this order already been paid?", answered by the network rather than by
 * this process's memory.
 *
 * `PendingPayoutStore` is in-memory and per-process, which is fine for
 * remembering an *intent* and useless as a guard against paying twice: a
 * restart empties it, and the next settle call would happily co-sign a second
 * transfer for an order the expert has already been paid for. "Payout is an
 * idempotent retry. Never double-pay" is a stated invariant, so the check that
 * enforces it has to live somewhere a restart cannot reach.
 *
 * The mirror node is that place, and the payout memo (payout-memo.ts) is what
 * makes the question answerable there.
 */

import { formatTinybars, parseTinybars } from "@handoff/schema";
import { fetchMirrorAccountDebits, fromMirrorTransactionId } from "./mirror.js";
import { payoutMemoFor } from "./payout-memo.js";

export interface PayoutSighting {
  /** SDK shape (`0.0.x@s.n`), converted from the mirror's, so it matches every other `TxRef`. */
  readonly transactionId: string;
  readonly consensusTimestamp: string;
  /** Tinybars the escrow was debited. A string end to end; never a `number`. */
  readonly amountTinybars: string;
  /**
   * The account credited exactly what the escrow was debited.
   *
   * Null when no single leg matches — the transaction's other legs are network
   * fees, and a fee that happens to equal the payout makes the payee
   * ambiguous. The memo is what binds the transfer to the order, so an
   * ambiguous payee is still a payout that happened; it is the caller's to
   * decide whether an unverifiable payee is worth refusing over.
   */
  readonly payeeAccountId: string | null;
}

/** How many of the escrow's payouts to look back through before giving up. */
export const PAYOUT_LOOKBACK_PAGE_SIZE = 100;

function decodeMemo(memoBase64: string | null): string {
  if (memoBase64 === null) return "";
  try {
    return Buffer.from(memoBase64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * The payout for one order, if the escrow has already made it.
 *
 * Reads one page of the escrow's debits, newest first. One page is the whole
 * search on purpose: an order settles within minutes of its attestation, and
 * a payout that has fallen more than `PAYOUT_LOOKBACK_PAGE_SIZE` payouts into
 * the past is one whose order was settled long ago and is not being retried.
 * Stated as a bound rather than left implicit, because the failure mode of
 * missing a sighting is a double payment.
 */
export async function findPayout(
  mirrorNodeUrl: string,
  params: { escrowAccountId: string; orderId: string; limit?: number },
): Promise<PayoutSighting | null> {
  const memo = payoutMemoFor(params.orderId);
  const debits = await fetchMirrorAccountDebits(mirrorNodeUrl, params.escrowAccountId, {
    order: "desc",
    limit: params.limit ?? PAYOUT_LOOKBACK_PAGE_SIZE,
  });

  for (const transaction of debits) {
    if (decodeMemo(transaction.memo_base64) !== memo) continue;

    // bigint throughout. The legs came off a public API and are parsed rather
    // than trusted, which is also why a leg that is not a tinybar figure is
    // skipped instead of throwing: a malformed row is somebody else's
    // transaction, not a reason to fail a check that guards a payment.
    const legs: { account: string | null; amount: bigint }[] = [];
    for (const leg of transaction.transfers ?? []) {
      try {
        legs.push({ account: leg.account, amount: parseTinybars(leg.amount) });
      } catch {
        continue;
      }
    }

    const escrowLeg = legs.find(
      (leg) => leg.account === params.escrowAccountId && leg.amount < 0n,
    );
    if (escrowLeg === undefined) {
      // The memo names this order and the escrow is not debited in it. That is
      // not our payout, whatever it is, and guessing would be guessing about
      // money.
      continue;
    }

    const amount = -escrowLeg.amount;
    const credited = legs.filter((leg) => leg.amount === amount && leg.account !== null);

    return {
      transactionId: fromMirrorTransactionId(transaction.transaction_id),
      consensusTimestamp: transaction.consensus_timestamp,
      amountTinybars: formatTinybars(amount),
      payeeAccountId: credited.length === 1 ? (credited[0]?.account ?? null) : null,
    };
  }

  return null;
}

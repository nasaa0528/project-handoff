/**
 * The payout transaction's memo.
 *
 * Without one, a completed payout is invisible on the mirror node: a transfer
 * out of the shared escrow carries no order id anywhere else, and "this order
 * is settled" would have to be *inferred* from a process's own memory rather
 * than *read*. The engineering agreements forbid exactly that — settlement
 * state is read from a mirror node, never inferred from "we sent it" — and the
 * in-memory `PendingPayoutStore` loses everything on a restart, so the memo is
 * the only thing standing between a crash and paying an expert twice.
 *
 * Prefixed rather than bare, because the fund lock already memoes the bare
 * order id (`assertFundLockMemoFits`) and the escrow sees both. A reader
 * scanning the escrow's transactions has to be able to tell the money going in
 * from the money coming out without also reading the transfer legs.
 *
 * The byte bound is Hedera's transaction-memo limit, imported rather than
 * restated so there is one number.
 */

import { FUND_LOCK_MEMO_MAX_BYTES } from "@handoff/schema";

export class PayoutMemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutMemoError";
  }
}

export const PAYOUT_MEMO_PREFIX = "handoff-payout:";

/**
 * The memo for one order's payout, refused if it will not fit.
 *
 * Byte length, not string length — a multi-byte character costs Hedera more
 * than one byte and `String.length` counts UTF-16 code units. An `ord_`-prefixed
 * uuid plus this prefix is 51 bytes, so there is room to spare; the check
 * exists for the day somebody makes order ids longer.
 */
export function payoutMemoFor(orderId: string): string {
  const memo = `${PAYOUT_MEMO_PREFIX}${orderId}`;
  const bytes = new TextEncoder().encode(memo).byteLength;
  if (bytes > FUND_LOCK_MEMO_MAX_BYTES) {
    throw new PayoutMemoError(
      `the payout memo for order ${JSON.stringify(orderId)} is ${bytes} bytes, over the ` +
        `${FUND_LOCK_MEMO_MAX_BYTES}-byte transaction memo Hedera accepts`,
    );
  }
  return memo;
}

/** The order id a payout memo names, or null when the memo is not one of ours. */
export function orderIdFromPayoutMemo(memo: string): string | null {
  return memo.startsWith(PAYOUT_MEMO_PREFIX) ? memo.slice(PAYOUT_MEMO_PREFIX.length) : null;
}

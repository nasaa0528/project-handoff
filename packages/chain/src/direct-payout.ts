/**
 * The direct co-signed payout — replaces ScheduleCreate/ScheduleSign for a
 * KeyList-controlled escrow (see pending-payout.ts and
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md).
 *
 * Both platform keys sign the SAME TransferTransaction in one call, verified against
 * real testnet (docs/research/schedule-create-keylist-blocker.md, diagnostic 5 — a
 * plain co-signed transfer debiting a KeyList account succeeds; it's specifically
 * ScheduleCreateTransaction that doesn't).
 *
 * **The memo is load-bearing, not decoration.** It is the only thing that lets
 * a later reader ask the mirror node whether an order has already been paid,
 * and that question is what keeps a restart from paying an expert twice. See
 * payout-memo.ts and payout-lookup.ts.
 */
import { type AccountId, type Client, Hbar, type PrivateKey, StatusError, TransferTransaction } from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, parseTinybars } from "@handoff/schema";
import type { TxResult } from "./escrow.js";
import { payoutMemoFor } from "./payout-memo.js";

export interface DirectPayoutParams {
  /** Memoed onto the transfer. The binding between this money and that order. */
  orderId: string;
  escrowAccountId: AccountId;
  payeeAccountId: AccountId;
  amountTinybars: string;
  verifierKey: PrivateKey;
  scheduleAdminKey: PrivateKey;
}

export async function executeDirectPayout(client: Client, params: DirectPayoutParams): Promise<TxResult<Record<string, never>>> {
  const amount = Hbar.fromTinybars(formatTinybars(assertPositive(parseTinybars(params.amountTinybars))));
  // Before anything is frozen or signed. An order id that will not fit the
  // memo is a payout that cannot be made idempotent, and a payout nobody can
  // read back is worse than one that refuses to start.
  const memo = payoutMemoFor(params.orderId);

  const transfer = new TransferTransaction()
    .addHbarTransfer(params.escrowAccountId, amount.negated())
    .addHbarTransfer(params.payeeAccountId, amount)
    .setTransactionMemo(memo);

  const frozen = await transfer.freezeWith(client).sign(params.verifierKey);
  const doubleSigned = await frozen.sign(params.scheduleAdminKey);
  const submittedId = doubleSigned.transactionId?.toString();

  try {
    const response = await doubleSigned.execute(client);
    await response.getReceipt(client);
    return { transactionId: response.transactionId.toString(), result: {} };
  } catch (error) {
    // Same discipline as submitFundLock, and for the same reason. A socket
    // error or a receipt timeout says nothing about whether consensus
    // happened, so the transaction may well have landed — and the one thing a
    // caller must not do is retry blind. Never swallow the transaction id,
    // least of all the one that says whether the expert has been paid.
    const detail = error instanceof StatusError ? error.status.toString() : (error as Error).message;
    throw new Error(
      `the payout for order ${params.orderId} was submitted as ${submittedId ?? "an unknown transaction"} ` +
        `and its outcome is unknown: ${detail}. Read the escrow's transfers on the mirror node for ` +
        `memo ${JSON.stringify(memo)} before retrying — retrying blind pays twice.`,
      { cause: error },
    );
  }
}

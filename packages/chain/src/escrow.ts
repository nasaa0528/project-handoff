import { AccountCreateTransaction, type AccountId, Hbar, type KeyList, TransferTransaction, type Client } from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, hbarToTinybars, parseTinybars } from "@handoff/schema";

/** Every exported function surfaces its transaction ID — never swallow it (CLAUDE.md). */
export interface TxResult<T> {
  transactionId: string;
  result: T;
}

/**
 * Creates the escrow account for one order, keyed by the 2-of-3 threshold KeyList
 * from keys.ts. `initialBalanceHbar` covers the account's own existence + auto-renew
 * buffer — the order's price is locked separately via fundEscrow below.
 */
export async function createEscrowAccount(
  client: Client,
  keyList: KeyList,
  initialBalanceHbar: string,
): Promise<TxResult<{ accountId: AccountId }>> {
  const initialBalance = formatTinybars(assertPositive(hbarToTinybars(initialBalanceHbar)));

  const response = await new AccountCreateTransaction()
    .setKey(keyList)
    .setInitialBalance(Hbar.fromTinybars(initialBalance))
    .execute(client);

  const receipt = await response.getReceipt(client);
  if (!receipt.accountId) {
    throw new Error(`AccountCreateTransaction returned no accountId (tx ${response.transactionId.toString()})`);
  }

  return { transactionId: response.transactionId.toString(), result: { accountId: receipt.accountId } };
}

/**
 * Locks the order's price into the escrow account at POSTED, before the HCS envelope
 * publishes — the envelope must never announce a commitment that doesn't exist yet.
 *
 * Takes tinybars, not HBAR — matches @handoff/schema's `adapter.ts` (`LockFundsParams.
 * amountTinybars`), which is the unit every ChainAdapter caller already has on hand.
 */
export async function fundEscrow(
  client: Client,
  fromAccountId: AccountId,
  escrowAccountId: AccountId,
  amountTinybars: string,
): Promise<TxResult<Record<string, never>>> {
  const amount = Hbar.fromTinybars(formatTinybars(assertPositive(parseTinybars(amountTinybars))));

  const response = await new TransferTransaction()
    .addHbarTransfer(fromAccountId, amount.negated())
    .addHbarTransfer(escrowAccountId, amount)
    .execute(client);

  await response.getReceipt(client);

  return { transactionId: response.transactionId.toString(), result: {} };
}

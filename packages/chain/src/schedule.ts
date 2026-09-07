import {
  type AccountId,
  type Client,
  Hbar,
  type PrivateKey,
  ReceiptStatusError,
  ScheduleCreateTransaction,
  ScheduleDeleteTransaction,
  type ScheduleId,
  ScheduleSignTransaction,
  Status,
  Timestamp,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, parseTinybars } from "@handoff/schema";
import type { TxResult } from "./escrow.js";

/**
 * Schedule-at-claim, confirmed by docs/research/hedera-primitives-verified.md:
 * ScheduleCreate needs a fully-formed inner transaction, so the payee must be known —
 * this is created at CLAIMED, not at POSTED. Funds already sit in escrow from POSTED
 * (escrow.ts); this only schedules the transfer out.
 *
 * Two DIFFERENT authorization surfaces, kept deliberately separate:
 *   1. The escrow ACCOUNT's 2-of-3 KeyList (keys.ts) authorizes the underlying
 *      transfer — satisfied by two ScheduleSignTransaction calls (verifier +
 *      schedule-admin) at early-execute.
 *   2. The SCHEDULE entity's own admin key (set here, at creation) authorizes
 *      ScheduleDeleteTransaction. This package sets it to the schedule-admin role's
 *      key alone. Do not conflate the two: deleting a schedule needs only the
 *      schedule-admin key, not the requester's or verifier's signature.
 */

export interface CreateClaimScheduleParams {
  escrowAccountId: AccountId;
  payeeAccountId: AccountId;
  /** Tinybar string — @handoff/schema money module, matches CreateScheduleParams.amountTinybars. */
  amountTinybars: string;
  scheduleAdminKey: PrivateKey;
  memo?: string;
  /**
   * Match this to the order deadline. Hedera's protobuf reference documents a
   * 30-minute default expiration; the core-concepts page documents a settable
   * expiration up to 62 days. `docs/research/hedera-primitives-verified.md` flags
   * this as unconfirmed on testnet — do not omit this parameter and rely on
   * whichever default turns out to be real.
   */
  expirationTime: Date;
}

/**
 * CLAIMED: creates the scheduled payment now that the payee is known.
 * `waitForExpiry` is left at its default (`false`) — that default IS early-execute:
 * the network fires the transfer the moment the 2-of-3 threshold is met, not at
 * expiration. Setting it `true` would make the schedule wait for expiration
 * regardless of signatures, which is the opposite of what we want.
 *
 * Idempotent by construction: if this is called twice for the same order (e.g. a
 * retried request), Hedera returns IDENTICAL_SCHEDULE_ALREADY_CREATED and the receipt
 * still carries the existing scheduleId — return it rather than treating it as an
 * error. **Unverified**: confirm this behavior on testnet before relying on it in the
 * retry path (see docs/research/hedera-primitives-verified.md).
 */
export async function createClaimSchedule(
  client: Client,
  params: CreateClaimScheduleParams,
): Promise<TxResult<{ scheduleId: ScheduleId; alreadyExisted: boolean }>> {
  const amount = Hbar.fromTinybars(formatTinybars(assertPositive(parseTinybars(params.amountTinybars))));

  const scheduledTransfer = new TransferTransaction()
    .addHbarTransfer(params.escrowAccountId, amount.negated())
    .addHbarTransfer(params.payeeAccountId, amount);

  let scheduleCreateTx = new ScheduleCreateTransaction()
    .setScheduledTransaction(scheduledTransfer)
    .setAdminKey(params.scheduleAdminKey.publicKey)
    .setExpirationTime(Timestamp.fromDate(params.expirationTime));

  if (params.memo) {
    scheduleCreateTx = scheduleCreateTx.setScheduleMemo(params.memo);
  }

  const response = await scheduleCreateTx.execute(client);

  try {
    const receipt = await response.getReceipt(client);
    if (!receipt.scheduleId) {
      throw new Error(`ScheduleCreateTransaction returned no scheduleId (tx ${response.transactionId.toString()})`);
    }
    return {
      transactionId: response.transactionId.toString(),
      result: { scheduleId: receipt.scheduleId, alreadyExisted: false },
    };
  } catch (error) {
    if (
      error instanceof ReceiptStatusError &&
      error.status === Status.IdenticalScheduleAlreadyCreated &&
      error.transactionReceipt.scheduleId
    ) {
      return {
        transactionId: response.transactionId.toString(),
        result: { scheduleId: error.transactionReceipt.scheduleId, alreadyExisted: true },
      };
    }
    throw error;
  }
}

/**
 * DELIVERED → SETTLED: verifier and schedule-admin each co-sign after independently
 * validating the expert's attestation. Call once per signer — the network executes
 * the underlying transfer automatically once the escrow's 2-of-3 threshold is met.
 * Safe to retry per signer: schedule signatures are add-only, never double-pay.
 */
export async function signScheduleForEarlyExecute(
  client: Client,
  scheduleId: ScheduleId,
  signerKey: PrivateKey,
): Promise<TxResult<Record<string, never>>> {
  const tx = await new ScheduleSignTransaction().setScheduleId(scheduleId).freezeWith(client).sign(signerKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return { transactionId: response.transactionId.toString(), result: {} };
}

/**
 * CLAIM_TIMEOUT re-open, or VIOLATION clawback — both cancel the pending schedule via
 * the schedule-admin key alone (module doc above; NOT the escrow account's 2-of-3
 * KeyList). Caller's lifecycle guard is what ensures only VIOLATION or an idle
 * claim-timeout reaches this — never a bare disagreement (hard rule 4).
 */
export async function deleteSchedule(
  client: Client,
  scheduleId: ScheduleId,
  scheduleAdminKey: PrivateKey,
): Promise<TxResult<Record<string, never>>> {
  const tx = await new ScheduleDeleteTransaction().setScheduleId(scheduleId).freezeWith(client).sign(scheduleAdminKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return { transactionId: response.transactionId.toString(), result: {} };
}

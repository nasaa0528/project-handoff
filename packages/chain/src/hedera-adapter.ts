import { AccountId, type Client, type PrivateKey, TopicId } from "@hiero-ledger/sdk";
import type {
  ChainAdapter,
  ConsensusRef,
  CreateScheduleParams,
  EscrowRef,
  LockFundsParams,
  UnsignedFundLock,
  ReadMessagesOptions,
  ScheduleRef,
  SignScheduleResult,
  TopicMessage,
  TransactionRecord,
  TxRef,
} from "@handoff/schema";
import { executeDirectPayout } from "./direct-payout.js";
import { buildFundLock, submitFundLock } from "./fund-lock.js";
import { submitTopicMessage, submitTopicMessageAsPayer } from "./hcs.js";
import { fetchMirrorTopicMessages, fetchMirrorTransaction, toMirrorTransactionId } from "./mirror.js";
import { findPayout } from "./payout-lookup.js";
import { PendingPayoutStore } from "./pending-payout.js";

/**
 * The real ChainAdapter, satisfying @handoff/schema's interface (the cutover seam
 * MockChainAdapter also satisfies). See packages/chain/CLAUDE.md.
 *
 * **createSchedule/signSchedule/deleteSchedule do not touch Hedera's Schedule
 * Service.** docs/research/schedule-create-keylist-blocker.md found
 * ScheduleCreateTransaction cannot debit a KeyList-controlled account (8 isolated
 * testnet tests, root cause unresolved). This adapter instead tracks the pending
 * payout locally (pending-payout.ts) and fires a directly co-signed
 * TransferTransaction the moment signSchedule is called (direct-payout.ts) — the
 * external ChainAdapter contract is unchanged, only the internals. See
 * docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md.
 *
 * **One shared escrow account — settled, no longer an open question.** Provisioned
 * once out of band (escrow.ts's createEscrowAccount, run separately, not by this
 * class); every order locks funds into it, so the fund lock is a plain transfer in and
 * always returns the same `escrowAccountId`. Per-order escrow (with the requester's
 * own public key genuinely in the KeyList) is roadmap, not this week — see
 * ../../../docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md. The
 * third KeyList key is the demo requester's session key; say that out loud if a judge
 * asks who holds it.
 *
 * **The escrow is funded by the requester, not by us.** `buildFundLock` freezes a
 * transfer whose debited account and fee payer are both the requester and hands
 * back the bytes; the requester signs them on their own machine with the key that
 * already signs the x402 fee; `submitFundLock` validates the returned bytes against
 * what was asked for and submits them. This class never holds the requester's key
 * and never signs their transfer. It replaced `lockFunds`, which signed as the
 * constructor's `client` — the platform operator — and so funded the escrow out of
 * our own account and refused any payer who was not the operator.
 */
export interface HederaChainAdapterConfig {
  client: Client;
  mirrorNodeUrl: string;
  escrowAccountId: AccountId;
  verifierKey: PrivateKey;
  scheduleAdminKey: PrivateKey;
  /**
   * Resolves a claimant's own signing key, for `publishClaim` only.
   *
   * **The platform does not hold expert keys, by design** — an expert signs from
   * their own account, and this adapter has no business knowing that key. So this
   * is optional and normally absent: a server-side adapter left without it refuses
   * to publish a claim rather than quietly signing as itself and reassigning
   * authorship. Provide it only where the claimant genuinely is the process doing
   * the signing (the expert app holding its own connection), or for a deliberately
   * staged demo expert — and say which, out loud, if a judge asks who signed.
   */
  resolveClaimantKey?: (claimantAccountId: string) => PrivateKey | undefined;
}

export class HederaChainAdapter implements ChainAdapter {
  readonly network = "testnet" as const;
  readonly #pendingPayouts = new PendingPayoutStore();
  /**
   * Payouts currently in flight, by schedule id.
   *
   * The mirror check below cannot see a transfer that has not been submitted
   * yet, so two overlapping calls for the same order — an expert clicking sign
   * while the demo script retries, an HTTP client that timed out and tried
   * again — would both read "not paid" and both pay. `markExecuted` runs far
   * too late to help. So the second caller joins the first one's promise
   * instead of starting its own.
   */
  readonly #inFlight = new Map<string, Promise<SignScheduleResult>>();

  constructor(private readonly config: HederaChainAdapterConfig) {}

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    const result = await submitTopicMessage(this.config.client, TopicId.fromString(topicId), contents);
    return {
      transactionId: result.transactionId,
      consensusTimestamp: result.result.consensusTimestamp,
      sequenceNumber: Number(result.result.topicSequenceNumber),
    };
  }

  /**
   * A claim is published from the CLAIMANT's account, not this adapter's operator —
   * readers take the claimant from the topic message's payer account, never from the
   * body, so signing as anyone else silently reassigns authorship.
   *
   * That means this needs the claimant's own key, which the platform deliberately
   * does not hold. Without a `resolveClaimantKey` that returns one for this account,
   * this refuses rather than falling back to `submitMessage` and putting the
   * operator's account on someone else's claim.
   */
  async publishClaim(topicId: string, claimantAccountId: string, contents: string): Promise<ConsensusRef> {
    const claimantKey = this.config.resolveClaimantKey?.(claimantAccountId);
    if (!claimantKey) {
      throw new Error(
        `cannot publish a claim for ${claimantAccountId}: no signing key for that account. ` +
          `A claim is paid for and signed by the claimant, because the payer account IS the ` +
          `claimant on the topic. This adapter does not hold expert keys by design — publish ` +
          `the claim from the claimant's own client, or construct the adapter with ` +
          `resolveClaimantKey if this process legitimately holds that key.`,
      );
    }

    const result = await submitTopicMessageAsPayer(
      this.config.client,
      TopicId.fromString(topicId),
      AccountId.fromString(claimantAccountId),
      claimantKey,
      contents,
    );

    return {
      transactionId: result.transactionId,
      consensusTimestamp: result.result.consensusTimestamp,
      sequenceNumber: Number(result.result.topicSequenceNumber),
    };
  }

  async readMessages(topicId: string, options: ReadMessagesOptions = {}): Promise<readonly TopicMessage[]> {
    const messages = await fetchMirrorTopicMessages(this.config.mirrorNodeUrl, topicId, {
      order: "asc",
      ...(options.afterSequenceNumber !== undefined ? { afterSequenceNumber: options.afterSequenceNumber } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });

    return messages.map((m) => ({
      topicId,
      sequenceNumber: m.sequence_number,
      consensusTimestamp: m.consensus_timestamp,
      payerAccountId: m.payer_account_id,
      contents: m.message,
    }));
  }

  /**
   * Freeze the transfer the requester will sign. The server never signs it.
   *
   * See fund-lock.ts and
   * ../../../docs/decisions/2026-09-08-requester-signs-the-fund-lock.md.
   */
  async buildFundLock(params: LockFundsParams): Promise<UnsignedFundLock> {
    return buildFundLock(this.config.client, this.config.escrowAccountId, params);
  }

  /** Validate the returned bytes against what was asked for, then submit them. */
  async submitFundLock(
    expected: LockFundsParams,
    signedTransactionBytes: string,
  ): Promise<EscrowRef> {
    return submitFundLock(
      this.config.client,
      this.config.escrowAccountId,
      expected,
      signedTransactionBytes,
    );
  }

  /** Tracks the payout locally — no Hedera schedule is created. See module doc above. */
  async createSchedule(params: CreateScheduleParams): Promise<ScheduleRef> {
    // No real transaction happens here, so there's no transaction ID of our own to
    // report — the caller gets one the moment money actually moves, at signSchedule.
    // A synthetic ID keeps TxRef honest about what this step actually did (nothing
    // on-chain yet) while still returning something.
    const placeholderTransactionId = `pending@${Date.now()}`;

    const { id, alreadyExisted } = this.#pendingPayouts.create(
      {
        orderId: params.orderId,
        escrowAccountId: params.escrowAccountId,
        payeeAccountId: params.payeeAccountId,
        amountTinybars: params.amountTinybars,
        expiresAt: params.expiresAt,
      },
      placeholderTransactionId,
    );

    return { transactionId: placeholderTransactionId, scheduleId: id, alreadyExisted };
  }

  /**
   * The interface takes only a scheduleId — it deliberately hides that early-execute
   * needs two signatures. Both platform keys co-sign the SAME TransferTransaction in
   * one call (direct-payout.ts), not two separate ScheduleSign calls over time.
   *
   * Idempotent on two levels, and it needs both. In-process, an already-executed
   * record returns its transaction id. Across a restart — where the in-process
   * record is gone — the mirror node is asked whether this order's payout memo
   * already appears among the escrow's debits. Without the second level, every
   * crash is a double payment waiting for a retry.
   */
  async signSchedule(scheduleId: string): Promise<SignScheduleResult> {
    // Before anything else, including the record lookup: a caller that arrives
    // while a payout is in flight gets that payout's answer, not a second one.
    const inFlight = this.#inFlight.get(scheduleId);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const attempt = this.#signSchedule(scheduleId);
    this.#inFlight.set(scheduleId, attempt);
    try {
      return await attempt;
    } finally {
      // Cleared on failure too. A payout that threw may or may not have
      // landed, and the next caller has to be able to ask the mirror node
      // rather than being handed a rejection forever.
      this.#inFlight.delete(scheduleId);
    }
  }

  async #signSchedule(scheduleId: string): Promise<SignScheduleResult> {
    const record = this.#pendingPayouts.get(scheduleId);

    if (record.deleted) {
      throw new Error(`payout ${scheduleId} was cancelled and cannot be signed`);
    }

    if (record.executed) {
      return { transactionId: record.executedTransactionId ?? record.createdTransactionId, executed: true };
    }

    // The in-memory record above is this process's memory and nothing more. It
    // is empty after a restart, and a caller retrying a settle it never got an
    // answer to would arrive here with a fresh record for an order the expert
    // has already been paid for. So the authoritative "already paid?" is asked
    // of the mirror node, which remembers what this process does not.
    //
    // Ordering matters: the network is consulted BEFORE any signature is
    // composed, so the expensive, irreversible half never runs on an order
    // that is already settled.
    const alreadyPaid = await findPayout(this.config.mirrorNodeUrl, {
      escrowAccountId: record.escrowAccountId,
      orderId: record.orderId,
    });
    if (alreadyPaid !== null) {
      // The memo binds that transfer to this order, but it does not promise it
      // went where this record says. A sighting that credited somebody else is
      // not "already paid" — it is a fact nobody here can explain, and the
      // wrong answer to it is to report success and move on.
      //
      // Only the payee is compared. Not the amount: a payout whose payee also
      // paid the transaction fee has that fee netted out of their credit leg,
      // so the amounts legitimately differ and comparing them would refuse a
      // correct payout. Measured on testnet 2026-09-12.
      if (
        alreadyPaid.payeeAccountId !== null &&
        alreadyPaid.payeeAccountId !== record.payeeAccountId
      ) {
        throw new Error(
          `order ${record.orderId} was already paid by ${alreadyPaid.transactionId}, but that ` +
            `transfer credited ${alreadyPaid.payeeAccountId} and this payout is for ` +
            `${record.payeeAccountId}. Refusing to report it as settled; read the escrow's ` +
            `transfers on the mirror node before doing anything else.`,
        );
      }
      // Not an error. "Payout is an idempotent retry" — a second call returns
      // the first call's transaction id and moves nothing.
      this.#pendingPayouts.markExecuted(scheduleId, alreadyPaid.transactionId);
      return { transactionId: alreadyPaid.transactionId, executed: true };
    }

    const result = await executeDirectPayout(this.config.client, {
      orderId: record.orderId,
      escrowAccountId: AccountId.fromString(record.escrowAccountId),
      payeeAccountId: AccountId.fromString(record.payeeAccountId),
      amountTinybars: record.amountTinybars,
      verifierKey: this.config.verifierKey,
      scheduleAdminKey: this.config.scheduleAdminKey,
    });

    this.#pendingPayouts.markExecuted(scheduleId, result.transactionId);
    return { transactionId: result.transactionId, executed: true };
  }

  /**
   * Cancels the local record only — there is no Hedera schedule to delete. No new
   * on-chain fact is created by cancelling; the transaction ID returned is the one
   * that established the payout being cancelled, not a new one. Not on today's
   * demo path (that's the happy path: POSTED -> CLAIMED -> DELIVERED -> SETTLED);
   * revisit if CLAIM_TIMEOUT/VIOLATION need their own on-chain audit trail later.
   */
  async deleteSchedule(scheduleId: string): Promise<TxRef> {
    const record = this.#pendingPayouts.get(scheduleId);
    this.#pendingPayouts.markDeleted(scheduleId);
    return { transactionId: record.createdTransactionId };
  }

  async getTransaction(transactionId: string): Promise<TransactionRecord | null> {
    const tx = await fetchMirrorTransaction(this.config.mirrorNodeUrl, transactionId);
    if (!tx) return null;

    return {
      transactionId: tx.transaction_id,
      status: tx.result === "SUCCESS" ? "SUCCESS" : "FAILED",
      consensusTimestamp: tx.consensus_timestamp,
    };
  }
}

export { toMirrorTransactionId };

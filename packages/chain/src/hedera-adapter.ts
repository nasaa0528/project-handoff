import { AccountId, type Client, type PrivateKey, ScheduleId, TopicId } from "@hiero-ledger/sdk";
import type {
  ChainAdapter,
  ConsensusRef,
  CreateScheduleParams,
  EscrowRef,
  LockFundsParams,
  ReadMessagesOptions,
  ScheduleRef,
  SignScheduleResult,
  TopicMessage,
  TransactionRecord,
  TxRef,
} from "@handoff/schema";
import { fundEscrow } from "./escrow.js";
import { submitTopicMessage } from "./hcs.js";
import { fetchMirrorTopicMessages, fetchMirrorTransaction, toMirrorTransactionId } from "./mirror.js";
import { createClaimSchedule, deleteSchedule as deleteScheduleImpl, signScheduleForEarlyExecute } from "./schedule.js";

/**
 * The real ChainAdapter, satisfying @handoff/schema's interface (the cutover seam
 * MockChainAdapter also satisfies). See packages/chain/CLAUDE.md.
 *
 * **Open question, flagged rather than silently decided** (same shape as the
 * x402/SDK-boundary question already sitting with Tseegii and the sync): this class
 * assumes ONE escrow account, provisioned once out of band (escrow.ts's
 * createEscrowAccount, run separately — not by this class), not a fresh account per
 * order. `lockFunds` only transfers into it and always returns the same
 * `escrowAccountId`. The alternative — a fresh escrow account per order, with the
 * real requester's own public key as the KeyList's requester role, looked up via a
 * mirror-node account-info read — is also implementable, but needs someone to decide
 * whether a per-order account is worth the extra AccountCreateTransaction cost and
 * the added trust surface of resolving a stranger's key at runtime. Don't build past
 * this assumption without that decision landing in docs/decisions/.
 *
 * `lockFunds`'s transfer is signed by whatever the constructor's `client` is
 * authorized as. If that's meant to be the requester's own signature, the caller
 * must construct this adapter with a client whose operator matches
 * `requesterAccountId` — this class does not itself hold or request the requester's key.
 */
export interface HederaChainAdapterConfig {
  client: Client;
  mirrorNodeUrl: string;
  escrowAccountId: AccountId;
  verifierKey: PrivateKey;
  scheduleAdminKey: PrivateKey;
}

export class HederaChainAdapter implements ChainAdapter {
  readonly network = "testnet" as const;

  constructor(private readonly config: HederaChainAdapterConfig) {}

  async submitMessage(topicId: string, contents: string): Promise<ConsensusRef> {
    const result = await submitTopicMessage(this.config.client, TopicId.fromString(topicId), contents);
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

  async lockFunds(params: LockFundsParams): Promise<EscrowRef> {
    const result = await fundEscrow(
      this.config.client,
      AccountId.fromString(params.requesterAccountId),
      this.config.escrowAccountId,
      params.amountTinybars,
    );

    return { transactionId: result.transactionId, escrowAccountId: this.config.escrowAccountId.toString() };
  }

  async createSchedule(params: CreateScheduleParams): Promise<ScheduleRef> {
    const result = await createClaimSchedule(this.config.client, {
      escrowAccountId: AccountId.fromString(params.escrowAccountId),
      payeeAccountId: AccountId.fromString(params.payeeAccountId),
      amountTinybars: params.amountTinybars,
      scheduleAdminKey: this.config.scheduleAdminKey,
      memo: params.orderId,
      expirationTime: new Date(params.expiresAt),
    });

    return {
      transactionId: result.transactionId,
      scheduleId: result.result.scheduleId.toString(),
      alreadyExisted: result.result.alreadyExisted,
    };
  }

  /**
   * The interface takes only a scheduleId — it deliberately hides that early-execute
   * is two signatures. Both platform keys (verifier, schedule-admin) co-sign here in
   * one call; ScheduleSignTransaction is safe to retry, so signing an
   * already-executed schedule is success, not an error.
   */
  async signSchedule(scheduleId: string): Promise<SignScheduleResult> {
    const id = ScheduleId.fromString(scheduleId);

    const verifierResult = await signScheduleForEarlyExecute(this.config.client, id, this.config.verifierKey);
    const adminResult = await signScheduleForEarlyExecute(this.config.client, id, this.config.scheduleAdminKey);

    const executed = await this.hasExecuted(scheduleId);
    return { transactionId: adminResult.transactionId ?? verifierResult.transactionId, executed };
  }

  async deleteSchedule(scheduleId: string): Promise<TxRef> {
    const result = await deleteScheduleImpl(this.config.client, ScheduleId.fromString(scheduleId), this.config.scheduleAdminKey);
    return { transactionId: result.transactionId };
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

  /**
   * Not part of ChainAdapter — a mirror-node check for whether a schedule has fired,
   * since unlike MockChainAdapter's in-memory `hasExecuted`, the real adapter has no
   * local state to ask. Used internally by `signSchedule`.
   */
  private async hasExecuted(scheduleId: string): Promise<boolean> {
    const url = `${this.config.mirrorNodeUrl}/schedules/${scheduleId}`;
    const response = await fetch(url);
    if (!response.ok) return false;
    const body = (await response.json()) as { executed_timestamp: string | null };
    return body.executed_timestamp !== null;
  }
}

export { toMirrorTransactionId };

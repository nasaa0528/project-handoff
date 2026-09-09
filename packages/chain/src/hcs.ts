import {
  type AccountId,
  type Client,
  type PrivateKey,
  TopicCreateTransaction,
  type TopicId,
  TopicMessageSubmitTransaction,
  TransactionId,
} from "@hiero-ledger/sdk";
import { byteLength, canonicalize } from "@handoff/schema";
import type { TxResult } from "./escrow.js";

/**
 * Verified against docs.hedera.com (docs/research/hedera-primitives-verified.md):
 * HCS message max is 1024 bytes; beyond that the SDK auto-chunks rather than erroring.
 * A chunked attestation is a worse artifact than a bounded one, so this package
 * throws before ever letting a submit reach that path — it does not rely on the
 * schema package's (not-yet-built) defects[] bound alone.
 *
 * TODO(schema): this constant belongs in @handoff/schema once its HCS bounds land
 * (packages/schema/CLAUDE.md names them as owned there) — move it when that ships.
 */
export const HCS_MESSAGE_MAX_BYTES = 1024;

export class HcsMessageTooLargeError extends Error {
  constructor(
    public readonly byteLength: number,
    public readonly limit: number,
  ) {
    super(`HCS message is ${byteLength}B, exceeds the ${limit}B single-message limit — would auto-chunk`);
    this.name = "HcsMessageTooLargeError";
  }
}

/**
 * The bytes that go on the topic, checked against the wire size.
 *
 * A string is already the wire form: `ChainAdapter.submitMessage(topicId,
 * contents)` hands over an envelope, claim or attestation that the schema
 * package encoded and bounded, and readers on the other end `JSON.parse` the
 * topic message and expect an object. Canonicalizing a string would JSON-encode
 * it a second time and put a quoted string on the topic, which every treaty
 * decoder rejects; that is what happened to the first real order on testnet.
 * Anything that is not a string is canonicalized here, which is what the
 * provisioning scripts rely on when they publish a probe object.
 */
export function assertWithinHcsMessageLimit(payload: unknown): string {
  const canonical = typeof payload === "string" ? payload : canonicalize(payload);
  const size = byteLength(canonical);
  if (size > HCS_MESSAGE_MAX_BYTES) {
    throw new HcsMessageTooLargeError(size, HCS_MESSAGE_MAX_BYTES);
  }
  return canonical;
}

export interface CreateTopicParams {
  memo: string;
  adminKey?: PrivateKey;
  /**
   * Verified guidance: the order/attestation topic wants NO submitKey — experts
   * submit from their own accounts, and a submitKey would put the platform in the
   * signing path. The registry topic wants a submitKey SET — only the platform
   * writes it. Pass it only for the registry topic.
   */
  submitKey?: PrivateKey;
}

export async function createTopic(client: Client, params: CreateTopicParams): Promise<TxResult<{ topicId: TopicId }>> {
  let tx = new TopicCreateTransaction().setTopicMemo(params.memo);
  if (params.adminKey) {
    tx = tx.setAdminKey(params.adminKey.publicKey);
  }
  if (params.submitKey) {
    tx = tx.setSubmitKey(params.submitKey.publicKey);
  }

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  if (!receipt.topicId) {
    throw new Error(`TopicCreateTransaction returned no topicId (tx ${response.transactionId.toString()})`);
  }

  return { transactionId: response.transactionId.toString(), result: { topicId: receipt.topicId } };
}

/**
 * Submits any HCS payload (order envelope, attestation, or registry event) after
 * canonicalizing + bounding it. Content itself never belongs in `payload` — only its
 * hash (hard rule 1); this function does not know or enforce that on its own, the
 * caller's payload shape is what must already be hash-only.
 *
 * Uses `getRecord`, not `getReceipt` — the ChainAdapter interface's `ConsensusRef`
 * needs `consensusTimestamp`, which only the record carries. Costs a small extra
 * query fee over a bare receipt; worth it since callers need it to resolve claim races.
 */
export async function submitTopicMessage(
  client: Client,
  topicId: TopicId,
  payload: unknown,
  submitKey?: PrivateKey,
): Promise<TxResult<{ topicSequenceNumber: string; consensusTimestamp: string }>> {
  const canonical = assertWithinHcsMessageLimit(payload);

  let tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(canonical);
  if (submitKey) {
    tx = await tx.freezeWith(client).sign(submitKey);
  }

  const response = await tx.execute(client);
  const record = await response.getRecord(client);
  if (record.receipt.topicSequenceNumber === null) {
    throw new Error(`TopicMessageSubmitTransaction returned no topicSequenceNumber (tx ${response.transactionId.toString()})`);
  }
  if (!record.consensusTimestamp) {
    throw new Error(`TopicMessageSubmitTransaction returned no consensusTimestamp (tx ${response.transactionId.toString()})`);
  }

  return {
    transactionId: response.transactionId.toString(),
    result: {
      topicSequenceNumber: record.receipt.topicSequenceNumber.toString(),
      consensusTimestamp: `${record.consensusTimestamp.seconds.toString()}.${String(record.consensusTimestamp.nanos).padStart(9, "0")}`,
    },
  };
}

/**
 * Submits a topic message paid for by a SPECIFIC account, not the client's operator.
 *
 * This exists because readers take the author of a claim or an attestation from the
 * topic message's **payer account**, never from its body (schema's `adapter.ts` says
 * so for `publishClaim`). Making the payer somebody else means generating the
 * transaction id against their account and signing with their key — a signature from
 * the operator alone would put the operator's account on the message and quietly
 * reassign authorship.
 */
export async function submitTopicMessageAsPayer(
  client: Client,
  topicId: TopicId,
  payerAccountId: AccountId,
  payerKey: PrivateKey,
  payload: unknown,
): Promise<TxResult<{ topicSequenceNumber: string; consensusTimestamp: string }>> {
  const canonical = assertWithinHcsMessageLimit(payload);

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(canonical)
    // The payer is the author. Generating the id against their account is what makes
    // the mirror node report them as `payer_account_id`.
    .setTransactionId(TransactionId.generate(payerAccountId))
    .freezeWith(client)
    .sign(payerKey);

  const response = await tx.execute(client);
  const record = await response.getRecord(client);
  if (record.receipt.topicSequenceNumber === null) {
    throw new Error(`TopicMessageSubmitTransaction returned no topicSequenceNumber (tx ${response.transactionId.toString()})`);
  }
  if (!record.consensusTimestamp) {
    throw new Error(`TopicMessageSubmitTransaction returned no consensusTimestamp (tx ${response.transactionId.toString()})`);
  }

  return {
    transactionId: response.transactionId.toString(),
    result: {
      topicSequenceNumber: record.receipt.topicSequenceNumber.toString(),
      consensusTimestamp: `${record.consensusTimestamp.seconds.toString()}.${String(record.consensusTimestamp.nanos).padStart(9, "0")}`,
    },
  };
}

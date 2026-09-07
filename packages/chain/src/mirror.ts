/**
 * Mirror-node reads + Hashscan link building. Verified against docs.hedera.com
 * (docs/research/hedera-primitives-verified.md): read-only, no auth, no fees; the
 * base URL is configurable per CLAUDE.md's `HEDERA_MIRROR_NODE_URL`, never hardcoded
 * to one network here.
 *
 * "Hashscan is a viewer, not a dependency." Every Hashscan link here is a UI
 * convenience; settlement truth comes from these reads, never from "the SDK call
 * didn't throw."
 */

const HASHSCAN_BASE_URL = "https://hashscan.io/testnet";

/** SDK tx IDs print "0.0.1234@1699000000.000000000"; mirror + Hashscan want "-" instead of "@"/".". */
export function toMirrorTransactionId(sdkTransactionId: string): string {
  const match = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(sdkTransactionId);
  if (!match) {
    throw new Error(`Not a recognizable Hedera transaction ID: "${sdkTransactionId}"`);
  }
  const [, accountId, seconds, nanos] = match;
  return `${accountId}-${seconds}-${nanos}`;
}

export function hashscanTransactionUrl(sdkTransactionId: string): string {
  return `${HASHSCAN_BASE_URL}/transaction/${toMirrorTransactionId(sdkTransactionId)}`;
}

export function hashscanAccountUrl(accountId: string): string {
  return `${HASHSCAN_BASE_URL}/account/${accountId}`;
}

export function hashscanTopicUrl(topicId: string): string {
  return `${HASHSCAN_BASE_URL}/topic/${topicId}`;
}

export function hashscanScheduleUrl(scheduleId: string): string {
  return `${HASHSCAN_BASE_URL}/schedule/${scheduleId}`;
}

export interface MirrorTransaction {
  transaction_id: string;
  result: string;
  consensus_timestamp: string;
}

export async function fetchMirrorTransaction(mirrorNodeUrl: string, sdkTransactionId: string): Promise<MirrorTransaction | null> {
  const id = toMirrorTransactionId(sdkTransactionId);
  const response = await fetch(`${mirrorNodeUrl}/transactions/${id}`);

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mirror node returned ${response.status} for transaction ${id}`);

  const body = (await response.json()) as { transactions?: MirrorTransaction[] };
  return body.transactions?.[0] ?? null;
}

export interface MirrorSchedule {
  schedule_id: string;
  executed_timestamp: string | null;
  deleted: boolean;
  expiration_time: string | null;
}

export async function fetchMirrorSchedule(mirrorNodeUrl: string, scheduleId: string): Promise<MirrorSchedule | null> {
  const response = await fetch(`${mirrorNodeUrl}/schedules/${scheduleId}`);

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mirror node returned ${response.status} for schedule ${scheduleId}`);

  return (await response.json()) as MirrorSchedule;
}

export interface MirrorTopicMessage {
  consensus_timestamp: string;
  sequence_number: number;
  payer_account_id: string;
  /** Base64 by default from the API; this function decodes it to plain text already. */
  message: string;
}

/**
 * Reads back a topic's messages, decoded to plaintext (`encoding=utf-8` — the mirror
 * API returns base64 by default, verified in the research doc). Used to resolve which
 * claim actually won: sort by `sequence_number` / `consensus_timestamp`, first wins.
 */
export async function fetchMirrorTopicMessages(
  mirrorNodeUrl: string,
  topicId: string,
  opts: { limit?: number; order?: "asc" | "desc"; afterSequenceNumber?: number } = {},
): Promise<MirrorTopicMessage[]> {
  const params = new URLSearchParams({ encoding: "utf-8" });
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.order) params.set("order", opts.order);
  if (opts.afterSequenceNumber !== undefined) {
    params.set("sequencenumber", `gt:${opts.afterSequenceNumber}`);
  }

  const response = await fetch(`${mirrorNodeUrl}/topics/${topicId}/messages?${params.toString()}`);
  if (!response.ok) throw new Error(`Mirror node returned ${response.status} for topic ${topicId} messages`);

  const body = (await response.json()) as { messages?: MirrorTopicMessage[] };
  return body.messages ?? [];
}

/**
 * Hedera's own tutorial sleeps 6 seconds before querying the mirror node after a
 * submit (docs/research/hedera-primitives-verified.md) — do not put a bare mirror
 * read on the critical path of a demo without this, and never put a Hashscan link on
 * the critical path of a 90-second-class demo at all (its indexing lag can exceed it).
 */
export const MIRROR_NODE_INDEXING_DELAY_MS = 6000;

export async function waitForMirrorTransaction(
  mirrorNodeUrl: string,
  sdkTransactionId: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<MirrorTransaction | null> {
  const maxAttempts = opts.maxAttempts ?? 10;
  const delayMs = opts.delayMs ?? MIRROR_NODE_INDEXING_DELAY_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tx = await fetchMirrorTransaction(mirrorNodeUrl, sdkTransactionId);
    if (tx) return tx;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return null;
}

/**
 * Hashscan links. Garnish, not a dependency.
 *
 * The app reads mirror nodes for anything it relies on; Hashscan's own
 * indexing can lag past the length of the demo, so a link here is offered as
 * "see it there too", never as the proof of anything.
 *
 * Mock ids get no link at all. They 404 on Hashscan, and a mock id reaching a
 * recording is the failure the mock's deliberately malformed ids exist to make
 * visible. Refusing to build the link is that guard, in code.
 *
 * Testnet only. There is no other base URL here and there never will be. Both
 * paths below are the ones Hedera's own docs use.
 */

export const HASHSCAN_TESTNET_BASE = "https://hashscan.io/testnet";

export function isMockId(id: string): boolean {
  return id.startsWith("MOCK-");
}

/** Hashscan accepts the SDK form `0.0.x@seconds.nanos` in this path. */
export function hashscanTransactionUrl(transactionId: string): string | null {
  return isMockId(transactionId) ? null : `${HASHSCAN_TESTNET_BASE}/transaction/${transactionId}`;
}

export function hashscanAccountUrl(accountId: string): string | null {
  return isMockId(accountId) ? null : `${HASHSCAN_TESTNET_BASE}/account/${accountId}`;
}

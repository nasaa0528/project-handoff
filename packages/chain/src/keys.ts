import { KeyList, type PublicKey } from "@hiero-ledger/sdk";

/**
 * The escrow account's 2-of-3 threshold KeyList. Three DISTINCT roles, no person
 * holds two (CLAUDE.md, "Where things live" + the attestation section):
 *
 *   1. requester     — co-signs a CLAWBACK, together with the platform.
 *   2. verifier      — co-signs EARLY-EXECUTE with schedule-admin (the normal payout
 *                       path, after validating the expert's attestation). Also
 *                       co-signs a CLAWBACK with the requester.
 *   3. scheduleAdmin — co-signs EARLY-EXECUTE with verifier. Owns ScheduleDelete on
 *                       claim-timeout re-open and on VIOLATION (this is the
 *                       schedule ENTITY's own admin key, a different authorization
 *                       surface from this KeyList — see schedule.ts).
 *
 * The expert's own key is never a member of this KeyList — it signs the HCS
 * attestation message from its own account, never a schedule.
 */
export interface EscrowKeyRoles {
  requester: PublicKey;
  verifier: PublicKey;
  scheduleAdmin: PublicKey;
}

export function buildEscrowKeyList(roles: EscrowKeyRoles): KeyList {
  return new KeyList([roles.requester, roles.verifier, roles.scheduleAdmin], 2);
}

/** Which roles must co-sign for a given escrow action — asserted at call sites and in tests. */
export const ESCROW_SIGNING_COMBINATIONS = {
  earlyExecute: ["verifier", "scheduleAdmin"],
  clawback: ["requester", "verifierOrScheduleAdmin"],
} as const;

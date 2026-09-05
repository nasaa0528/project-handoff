/**
 * The sign sequence, with its one hard boundary drawn in code.
 *
 * Before `signAndPublish` resolves, nothing is on the ledger and a failure
 * means "not published". After it resolves, the attestation is on HCS with a
 * consensus timestamp, and nothing that happens later may say otherwise: not
 * a failed platform hook, not a failed mirror read. The two outcomes go to two
 * different callbacks so a screen cannot confuse them, and so the sign button
 * can never come back for an attestation that already exists.
 *
 * Kept out of React so the boundary is tested without a renderer.
 */

import type { Verdict } from "@handoff/schema";
import type { WebChain } from "../chain/adapter";
import { signAndPublish, type OrderForSigning, type SignedAttestation } from "./sign";

export interface SignRequest {
  readonly order: OrderForSigning;
  readonly verdict: Verdict;
  readonly defects: readonly string[];
  readonly notes: string;
}

export interface SignRunDeps {
  readonly chain: WebChain;
  /**
   * Mock mode only: the platform's side, standing in for the verifier that
   * reads the attestation and co-signs the payout. On testnet this is absent.
   * The expert app never triggers a payout; it only reads whether one landed.
   */
  readonly afterPublish?: (order: OrderForSigning, signed: SignedAttestation) => Promise<void>;
}

export interface SignRunOutcomes {
  /** The attestation is on the ledger. Irreversible from here. */
  readonly onSigned: (signed: SignedAttestation) => void;
  /** Nothing was published. The draft can be corrected and signed again. */
  readonly onPublishFailed: (message: string) => void;
  /** Something after the publish failed. The attestation still stands. */
  readonly onPlatformIssue: (message: string) => void;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSign(
  request: SignRequest,
  deps: SignRunDeps,
  outcomes: SignRunOutcomes,
): Promise<void> {
  let signed: SignedAttestation;
  try {
    signed = await signAndPublish(request, {
      chain: deps.chain.chain,
      content: deps.chain.content,
    });
  } catch (error) {
    outcomes.onPublishFailed(describeError(error));
    return;
  }

  outcomes.onSigned(signed);

  if (deps.afterPublish === undefined) return;
  try {
    await deps.afterPublish(request.order, signed);
  } catch (error) {
    outcomes.onPlatformIssue(describeError(error));
  }
}

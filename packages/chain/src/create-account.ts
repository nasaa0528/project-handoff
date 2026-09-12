/**
 * Creating a Hedera account on behalf of someone else.
 *
 * This exists because of one decision and would be a rule violation without it:
 * `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md`, a scope
 * exception granted by P4 that overrides the custody line in the Sep 8 ruling and
 * the "nothing here creates a Hedera account" clause in the Sep 10 one. Read it
 * before extending anything here. The honesty cost it accepts is real and is owed
 * on camera: **the platform holds the expert's signing key this week.**
 *
 * The SDK stays in this package, as the layout rule requires — `packages/accounts`
 * takes a provisioner function and never imports Hedera.
 */

import {
  AccountCreateTransaction,
  Hbar,
  PrivateKey,
  type AccountId,
  type Client,
  type PublicKey,
} from "@hiero-ledger/sdk";
import { assertPositive, formatTinybars, hbarToTinybars } from "@handoff/schema";
import type { TxResult } from "./escrow.js";

/**
 * `PrivateKey.generateECDSA().type`, read off the SDK rather than recalled — the
 * same constant and the same reason as `x402-signer.ts`.
 */
const ECDSA_KEY_TYPE = "secp256k1";

export interface CreatedAccount {
  readonly accountId: AccountId;
  /**
   * The plaintext key, held only long enough for the caller to encrypt it.
   *
   * Nothing in this package writes it anywhere. The caller's contract is to
   * encrypt it under the owner's password and drop the plaintext — see
   * `encryptPrivateKey` in `packages/accounts`.
   */
  readonly privateKey: PrivateKey;
}

/**
 * ECDSA, not the Ed25519 the portal hands out by default.
 *
 * Two reasons, and only the first is about this function. An expert account may
 * later need to pay an x402 service fee, and that scheme is secp256k1 —
 * `X402Signer` throws on anything else, so an Ed25519 expert would hit it as a
 * runtime error weeks from the code that chose the key type. The second is that
 * `2026-09-12-platform-creates-and-stores-expert-key.md` says ECDSA in as many
 * words.
 *
 * `setKeyWithoutAlias` rather than `setKey`: the latter is deprecated in the SDK
 * version this repo pins, and for an ECDSA key it also derives an EVM address
 * alias. Nothing in this design is a smart contract and the expert account's job
 * is to sign HAPI topic messages, so the alias is surface we do not want.
 */
/**
 * The transaction, built but not executed — split out so it can be asserted
 * against the real SDK with no network, which is the same builder/decoder shape
 * `fund-lock.ts` uses and for the same reason.
 *
 * `setKeyWithoutAlias` rather than `setKey`: the latter is deprecated in the SDK
 * version this repo pins, and for an ECDSA key it also derives an EVM address
 * alias. Nothing in this design is a smart contract and the expert account's job
 * is to sign HAPI topic messages, so the alias is surface we do not want.
 */
export function buildAccountCreate(
  publicKey: PublicKey,
  initialBalanceHbar: string,
): AccountCreateTransaction {
  const initialBalance = formatTinybars(assertPositive(hbarToTinybars(initialBalanceHbar)));

  return new AccountCreateTransaction()
    .setKeyWithoutAlias(publicKey)
    .setInitialBalance(Hbar.fromTinybars(initialBalance));
}

/**
 * ECDSA, not the Ed25519 the portal hands out by default.
 *
 * Two reasons, and only the first is about this function. An expert account may
 * later need to pay an x402 service fee, and that scheme is secp256k1 —
 * `X402Signer` throws on anything else, so an Ed25519 expert would hit it as a
 * runtime error weeks from the code that chose the key type. The second is that
 * `2026-09-12-platform-creates-and-stores-expert-key.md` says ECDSA in as many
 * words.
 */
export async function createTestnetAccount(
  client: Client,
  initialBalanceHbar: string,
): Promise<TxResult<CreatedAccount>> {
  const privateKey = PrivateKey.generateECDSA();

  if (privateKey.type !== ECDSA_KEY_TYPE) {
    throw new Error(`expected an ECDSA key from generateECDSA, got ${privateKey.type}`);
  }

  const response = await buildAccountCreate(privateKey.publicKey, initialBalanceHbar).execute(client);

  const receipt = await response.getReceipt(client);
  if (!receipt.accountId) {
    throw new Error(`AccountCreateTransaction returned no accountId (tx ${response.transactionId.toString()})`);
  }

  return {
    transactionId: response.transactionId.toString(),
    result: { accountId: receipt.accountId, privateKey },
  };
}

import { AccountId, Client, PrivateKey } from "@hiero-ledger/sdk";

/**
 * Testnet only, always (hard rule 5, CLAUDE.md) — there is no mainnet branch in this
 * file, deliberately. Reads exactly the vars in the committed `.env.example`: the
 * per-dev operator account, plus the mirror-node base URL.
 *
 * The escrow's 2-of-3 role keys (requester, verifier, schedule-admin — see keys.ts)
 * are NOT loaded here. They are the shared, vault-only keys the CLAUDE.md "Where
 * things live" table describes — callers pass them in explicitly (as `PrivateKey` /
 * `PublicKey` values) rather than this module inventing new required env-var names
 * into a shared `.env.example` unilaterally.
 */
export interface ChainEnv {
  network: "testnet";
  operatorId: AccountId;
  operatorKey: PrivateKey;
  mirrorNodeUrl: string;
}

const DEFAULT_MIRROR_NODE_URL = "https://testnet.mirrornode.hedera.com/api/v1";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return value;
}

export function loadChainEnv(): ChainEnv {
  const network = process.env["HEDERA_NETWORK"] ?? "testnet";
  if (network !== "testnet") {
    throw new Error(`HEDERA_NETWORK must be "testnet" — got "${network}" (hard rule 5).`);
  }

  return {
    network: "testnet",
    operatorId: AccountId.fromString(requireEnv("HEDERA_ACCOUNT_ID")),
    // Generic parser, not fromStringED25519/ECDSA — a portal-exported DER key
    // self-identifies its curve, and dev accounts are not guaranteed to be one or
    // the other (the x402 signer specifically must be ECDSA; this operator need not be).
    operatorKey: PrivateKey.fromString(requireEnv("HEDERA_PRIVATE_KEY")),
    mirrorNodeUrl: process.env["HEDERA_MIRROR_NODE_URL"] ?? DEFAULT_MIRROR_NODE_URL,
  };
}

export function createTestnetClient(env: ChainEnv): Client {
  const client = Client.forTestnet();
  client.setOperator(env.operatorId, env.operatorKey);
  return client;
}

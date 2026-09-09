/**
 * Configuration, from the environment.
 *
 * Two things are deliberately absent. There is no private key of any kind:
 * anything prefixed `VITE_` is bundled into the browser build, so a key here
 * would be a key in a JavaScript file, and a variable whose name says it is
 * one refuses to boot. And there is no mainnet: the mode type has two members
 * and neither is it, and a URL that so much as mentions it is refused.
 *
 * Who signs is not configuration either. The account comes from the person at
 * the connect screen; the environment may prefill the field and nothing more.
 *
 * The mock has its own block, because the things only the mock needs (whose
 * funds the seeded order locks, what it costs) must not exist as fields on a
 * testnet configuration where nothing reads them. Testnet has its own too:
 * where the mirror is, where content is, and which account is the escrow.
 */

import { assertPositive, hbarToTinybars } from "@handoff/schema";
import { parseAccountId } from "../session/accountId";
import { describePrivateKey } from "../session/keyShape";
import { looksLikeSecretName, secretNameMessage } from "./secretNames";

export type ChainMode = "mock" | "testnet";

interface Common {
  /** Prefills the connect screen. Optional, and never the source of who signs. */
  readonly expertAccountIdPrefill: string | null;
  /** Where orders and claims are published. Not where attestations go. */
  readonly ordersTopicId: string;
  /**
   * Where attestations are published. A separate topic from the orders one,
   * because P1 provisions them separately and apps/mcp reads the verdict from
   * this one. One variable per topic, so neither can silently become the other.
   */
  readonly attestationsTopicId: string;
}

export interface MockChainConfig extends Common {
  readonly mode: "mock";
  readonly mock: {
    /** Whose funds the seeded demo order locks. */
    readonly requesterAccountId: string;
    /**
     * The seeded orders' price, in HBAR as a string. The default is the
     * committed demo price, 100 HBAR, settled in
     * docs/decisions/2026-09-06-demo-price-and-x402-fee.md because the
     * faucet gives exactly that per call. Never changed on camera.
     */
    readonly priceHbar: string;
  };
}

export interface TestnetChainConfig extends Common {
  readonly mode: "testnet";
  /** Where every mirror read goes. Testnet's public mirror node unless overridden. */
  readonly mirrorNodeUrl: string;
  /**
   * Where the browser reads the ask and the document and stores the notes,
   * as `{contentUrl}/{sha256}`. GET returns the bytes, PUT stores them. The
   * service key never comes here; whatever answers this URL holds it.
   */
  readonly contentUrl: string;
  /** The shared escrow account, a public id. Shown and read about, never touched. */
  readonly escrowAccountId: string;
}

export type WebChainConfig = MockChainConfig | TestnetChainConfig;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

const DEMO_PRICE_HBAR = "100";

/** Testnet's public mirror node. The same default `.env.example` names for the server side. */
export const DEFAULT_MIRROR_NODE_URL = "https://testnet.mirrornode.hedera.com/api/v1";

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. See apps/web/.env.example.`);
  }
  return value;
}

function accountIdFrom(name: string, value: string): string {
  const parsed = parseAccountId(value);
  if (!parsed.ok) throw new ConfigError(`${name} is set but is not an account id like 0.0.12345. ${parsed.reason}`);
  return parsed.accountId;
}

function optionalAccountId(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return null;
  return accountIdFrom(name, value);
}

/** A price. Same rule as the envelope's: a real amount, and zero is not a price. */
function hbarAmount(env: Env, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  try {
    assertPositive(hbarToTinybars(value));
  } catch (error) {
    throw new ConfigError(`${name} is ${value}: ${(error as Error).message}`);
  }
  return value;
}

/**
 * A URL the browser will talk to. Hard rule 5 in one line: anything that
 * mentions mainnet is refused before it can be dialled. https, or http on
 * localhost for a dev server; a trailing slash is dropped so `${url}/${path}`
 * composes.
 */
function serviceUrl(env: Env, name: string, fallback?: string): string {
  const value = env[name]?.trim() || fallback;
  if (value === undefined || value === "") throw new ConfigError(`${name} is not set. See apps/web/.env.example.`);
  if (/mainnet/i.test(value)) throw new ConfigError(`${name} mentions mainnet. This app runs against testnet and nothing else.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a URL: ${value}`);
  }
  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    throw new ConfigError(`${name} must be https, or http on localhost. Got ${url.protocol}//${url.host}.`);
  }
  return value.replace(/\/+$/, "");
}

/**
 * Hard rule 2, as a startup failure. Two checks: a name that says secret,
 * and a value shaped like a private key under any name. Neither message
 * repeats the value.
 */
function refuseSecrets(env: Env): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_")) continue;
    if (looksLikeSecretName(name)) throw new ConfigError(secretNameMessage(name));
    if (value !== undefined && describePrivateKey(value).ok) {
      throw new ConfigError(
        `${name} holds what looks like a private key. Anything prefixed VITE_ is bundled into the browser build. Remove it.`,
      );
    }
  }
}

export function configFromEnv(env: Env): WebChainConfig {
  refuseSecrets(env);

  const mode = env["VITE_CHAIN"]?.trim() ?? "mock";
  if (mode !== "mock" && mode !== "testnet") {
    // Hard rule 5. Refusing here means a misconfigured app never renders.
    throw new ConfigError(`VITE_CHAIN is ${mode}. This app runs against "mock" or "testnet" and nothing else.`);
  }

  const expertAccountIdPrefill = optionalAccountId(env, "VITE_EXPERT_ACCOUNT_ID");

  if (mode === "mock") {
    return {
      mode,
      expertAccountIdPrefill,
      ordersTopicId: env["VITE_HANDOFF_ORDERS_TOPIC_ID"]?.trim() || "MOCK-topic-orders",
      attestationsTopicId: env["VITE_HANDOFF_ATTESTATIONS_TOPIC_ID"]?.trim() || "MOCK-topic-attestations",
      mock: {
        requesterAccountId: env["VITE_MOCK_REQUESTER_ACCOUNT_ID"]?.trim() || "MOCK-requester",
        priceHbar: hbarAmount(env, "VITE_MOCK_PRICE_HBAR", DEMO_PRICE_HBAR),
      },
    };
  }

  return {
    mode,
    expertAccountIdPrefill,
    ordersTopicId: required(env, "VITE_HANDOFF_ORDERS_TOPIC_ID"),
    attestationsTopicId: required(env, "VITE_HANDOFF_ATTESTATIONS_TOPIC_ID"),
    mirrorNodeUrl: serviceUrl(env, "VITE_HEDERA_MIRROR_NODE_URL", DEFAULT_MIRROR_NODE_URL),
    contentUrl: serviceUrl(env, "VITE_CONTENT_URL"),
    escrowAccountId: accountIdFrom("VITE_HANDOFF_ESCROW_ACCOUNT_ID", required(env, "VITE_HANDOFF_ESCROW_ACCOUNT_ID")),
  };
}

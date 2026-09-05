/**
 * Configuration, from the environment.
 *
 * Two things are deliberately absent. There is no private key of any kind:
 * anything prefixed `VITE_` is bundled into the browser build, so a key here
 * would be a key in a JavaScript file. And there is no mainnet: the mode type
 * has two members and neither is it.
 *
 * The mock has its own block, because the things only the mock needs (whose
 * funds the seeded order locks, what it costs) must not exist as fields on a
 * testnet configuration where nothing reads them.
 */

import { hbarToTinybars } from "@handoff/schema";

export type ChainMode = "mock" | "testnet";

interface Common {
  /** The expert's own account. The only account this app ever signs from. */
  readonly expertAccountId: string;
  /** Where orders are published and, until P1 says otherwise, attestations too. */
  readonly ordersTopicId: string;
}

export interface MockChainConfig extends Common {
  readonly mode: "mock";
  readonly mock: {
    /** Whose funds the seeded demo order locks. */
    readonly requesterAccountId: string;
    /**
     * The seeded order's price, in HBAR as a string. The default is the
     * proposed demo price, which is still an open decision (200 HBAR pending
     * a faucet check). Change it here, not in code, and never on camera.
     */
    readonly priceHbar: string;
  };
}

export interface TestnetChainConfig extends Common {
  readonly mode: "testnet";
}

export type WebChainConfig = MockChainConfig | TestnetChainConfig;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

const ACCOUNT_ID = /^0\.0\.[1-9]\d*$/;

const PROPOSED_DEMO_PRICE_HBAR = "200";

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. See apps/web/.env.example.`);
  }
  return value;
}

function accountId(env: Env, name: string): string {
  const value = required(env, name);
  if (!ACCOUNT_ID.test(value)) {
    throw new ConfigError(`${name} is ${value}, which is not an account id like 0.0.12345.`);
  }
  return value;
}

function hbarAmount(env: Env, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  try {
    hbarToTinybars(value);
  } catch (error) {
    throw new ConfigError(`${name} is ${value}: ${(error as Error).message}`);
  }
  return value;
}

export function configFromEnv(env: Env): WebChainConfig {
  const mode = env["VITE_CHAIN"]?.trim() ?? "mock";
  if (mode !== "mock" && mode !== "testnet") {
    // Hard rule 5. Refusing here means a misconfigured app never renders.
    throw new ConfigError(`VITE_CHAIN is ${mode}. This app runs against "mock" or "testnet" and nothing else.`);
  }

  const expertAccountId = accountId(env, "VITE_EXPERT_ACCOUNT_ID");

  if (mode === "mock") {
    return {
      mode,
      expertAccountId,
      ordersTopicId: env["VITE_HANDOFF_ORDERS_TOPIC_ID"]?.trim() || "MOCK-topic-orders",
      mock: {
        requesterAccountId: env["VITE_MOCK_REQUESTER_ACCOUNT_ID"]?.trim() || "MOCK-requester",
        priceHbar: hbarAmount(env, "VITE_MOCK_PRICE_HBAR", PROPOSED_DEMO_PRICE_HBAR),
      },
    };
  }

  return {
    mode,
    expertAccountId,
    ordersTopicId: required(env, "VITE_HANDOFF_ORDERS_TOPIC_ID"),
  };
}

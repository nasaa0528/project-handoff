/**
 * Configuration for the accounts API, read once at boot.
 *
 * Every value that must be present is checked here rather than where it is used,
 * so a missing pepper or connection string stops the process at startup with a
 * message naming the variable — not on the first registration attempt, in front
 * of whoever was trying to register.
 */

import { codePepper, type CodePepper } from "@handoff/accounts";

/**
 * Which store the API talks to: `memory` or `mongo`.
 *
 * Named after `HANDOFF_CHAIN`'s mock/testnet switch and refused the same way if
 * it is anything else. An unrecognised value must not fall through to the
 * in-memory store — everything registered would vanish on restart, and the
 * failure would look like "the database lost my account".
 */
export type StoreMode = "memory" | "mongo";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * `??` is not enough: an unset variable and `HANDOFF_ACCOUNTS_CODE_PEPPER=` are
 * different values to Node and the same thing to a person. A blank line in `.env`
 * has to read as absent, or configuration that looks filled in behaves as if it
 * were missing.
 */
function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function required(name: string, why: string): string {
  const value = optional(name);
  if (value === undefined) {
    throw new ConfigError(`${name} is not set. ${why} See .env.example.`);
  }
  return value;
}

export interface AccountsApiConfig {
  readonly port: number;
  readonly storeMode: StoreMode;
  readonly pepper: CodePepper;
  /** Only read when storeMode is `mongo`. */
  readonly mongoUri?: string;
  readonly mongoDatabase?: string;
  /** Absent means registration does not check the ledger at all. */
  readonly mirrorNodeUrl?: string;
  readonly allowUnverifiedSignIn: boolean;
  readonly trustProxy: boolean;
}

export function storeModeFromEnv(): StoreMode {
  const mode = optional("HANDOFF_ACCOUNTS_STORE") ?? "memory";
  if (mode !== "memory" && mode !== "mongo") {
    throw new ConfigError(
      `HANDOFF_ACCOUNTS_STORE is "${mode}". This API runs against "memory" or "mongo" and nothing else.`,
    );
  }
  return mode;
}

export function configFromEnv(): AccountsApiConfig {
  const storeMode = storeModeFromEnv();

  const portText = optional("HANDOFF_ACCOUNTS_PORT") ?? "8788";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigError(`HANDOFF_ACCOUNTS_PORT is "${portText}", which is not a port number.`);
  }

  const pepper = codePepper(
    required(
      "HANDOFF_ACCOUNTS_CODE_PEPPER",
      "It keys the HMAC over email codes and session tokens, so a stolen database is not a pile of live credentials.",
    ),
  );

  // Read into locals first. Calling `optional` twice in a conditional spread
  // gives TypeScript two independent `string | undefined` values, so the check
  // on one cannot narrow the other — and under `exactOptionalPropertyTypes` an
  // explicit `undefined` is not the same as an absent key.
  const mongoDatabase = optional("MONGODB_DB");
  const mirrorNodeUrl = optional("HEDERA_MIRROR_NODE_URL");

  return {
    port,
    storeMode,
    pepper,
    ...(storeMode === "mongo"
      ? {
          mongoUri: required("MONGODB_URI", "HANDOFF_ACCOUNTS_STORE=mongo needs somewhere to write."),
          ...(mongoDatabase === undefined ? {} : { mongoDatabase }),
        }
      : {}),
    ...(mirrorNodeUrl === undefined ? {} : { mirrorNodeUrl }),

    // Defaults to false. Email verification that gates nothing is theatre, so
    // turning it off has to be a deliberate line in a file.
    allowUnverifiedSignIn: optional("HANDOFF_ACCOUNTS_ALLOW_UNVERIFIED_SIGNIN") === "true",

    /**
     * Whether `X-Forwarded-For` may name the client.
     *
     * Off by default, and that matters: the header is client-supplied, so
     * trusting it when nothing is actually in front of this process lets one
     * caller present a different address on every request and walk straight
     * through the rate limiter. Turn it on only behind a proxy that overwrites
     * the header.
     */
    trustProxy: optional("HANDOFF_ACCOUNTS_TRUST_PROXY") === "true",
  };
}

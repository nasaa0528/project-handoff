/**
 * The accounts API process.
 *
 * Composition root: the one place that decides which store, which mail transport
 * and which ledger check the routes get. Everything below takes its dependencies
 * as arguments, which is why the tests need no database and no network.
 */

import {
  AccountService,
  consoleEmailSender,
  InMemoryAccountStore,
  mirrorAccountCheck,
  MongoAccountStore,
  skipAccountCheck,
  type AccountStore,
  type HederaAccountProvisioner,
} from "@handoff/accounts";
import { createTestnetAccount, createTestnetClient, loadChainEnv } from "@handoff/chain";
import { configFromEnv, type AccountsApiConfig } from "./config.js";
import { createAccountsHttpServer } from "./http.js";
import { RateLimiter } from "./rate-limit.js";

async function storeFor(config: AccountsApiConfig): Promise<AccountStore> {
  if (config.storeMode === "memory" || config.mongoUri === undefined) {
    // Loud, for the same reason apps/mcp shouts about the mock chain: everything
    // registered here lives in this process's heap and is gone on restart. An
    // expert who registers during a demo and cannot sign in afterwards is a
    // failure nobody would diagnose in the moment.
    console.warn(
      "\n  IN-MEMORY ACCOUNTS. Every registration is lost when this process exits,\n" +
        "  and no other process can see it. Set HANDOFF_ACCOUNTS_STORE=mongo with\n" +
        "  MONGODB_URI for anything you intend to keep.\n",
    );
    return new InMemoryAccountStore();
  }

  return MongoAccountStore.connect({
    uri: config.mongoUri,
    ...(config.mongoDatabase === undefined ? {} : { databaseName: config.mongoDatabase }),
  });
}

/**
 * The custodial half of registration, and the only place in this process that
 * holds the operator key.
 *
 * Returns `undefined` unless provisioning is switched on, so the service is given
 * no provisioner rather than one it declines to call — the capability is absent,
 * not merely unused. See
 * `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md`, which
 * granted this as a narrow exception with an explicit expiry.
 *
 * The operator key is read from the environment (hard rule 2 — vault, never the
 * repo) and `loadChainEnv` refuses any network but testnet (hard rule 5).
 */
function provisionerFor(config: AccountsApiConfig): HederaAccountProvisioner | undefined {
  if (!config.provisionAccounts) return undefined;

  const client = createTestnetClient(loadChainEnv());

  return async () => {
    const created = await createTestnetAccount(client, config.newAccountBalanceHbar);
    return {
      hederaAccountId: created.result.accountId.toString(),
      // The DER string is what the vault encrypts. It is not logged here and it
      // is not returned to the client — the caller encrypts it and drops it.
      privateKey: created.result.privateKey.toStringDer(),
      transactionId: created.transactionId,
    };
  };
}

async function main(): Promise<void> {
  const config = configFromEnv();
  const store = await storeFor(config);
  const provisionHederaAccount = provisionerFor(config);

  if (provisionHederaAccount !== undefined) {
    // Said on boot for the same reason the in-memory store is: this is custody,
    // and the decision that allowed it is conditional on nobody being able to
    // forget that. A judge asking "who holds the expert's key" deserves the same
    // answer the operator sees here.
    console.warn(
      "\n  CUSTODIAL REGISTRATION IS ON. This process creates Hedera accounts and\n" +
        "  stores their private keys, encrypted under each user's password. Say so\n" +
        "  on camera. See docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md\n",
    );
  }

  const service = new AccountService({
    store,
    pepper: config.pepper,
    // No mail vendor is wired. The code is printed, which is what makes local
    // registration usable; swapping in a real transport is one function.
    sendEmailCode: consoleEmailSender,
    checkHederaAccount:
      config.mirrorNodeUrl === undefined ? skipAccountCheck : mirrorAccountCheck(config.mirrorNodeUrl),
    allowUnverifiedSignIn: config.allowUnverifiedSignIn,
    ...(provisionHederaAccount === undefined ? {} : { provisionHederaAccount }),
  });

  const origins = (process.env["HANDOFF_ACCOUNTS_CORS_ORIGINS"] ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

  const server = createAccountsHttpServer(
    { service, limiter: new RateLimiter(), allowedOrigins: origins },
    { trustProxy: config.trustProxy, log: (line) => console.log(line) },
  );

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} — closing`);
    server.close(() => {
      void store.close().then(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.listen(config.port, () => {
    console.log(`accounts api   http://localhost:${String(config.port)}`);
    console.log(`store          ${config.storeMode}`);
    console.log(`ledger check   ${config.mirrorNodeUrl ?? "off (no HEDERA_MIRROR_NODE_URL)"}`);
    console.log(`sign-in needs  ${config.allowUnverifiedSignIn ? "no email check" : "a verified email"}`);
    console.log(`cors           ${origins.length === 0 ? "same-origin only" : origins.join(", ")}`);
    console.log(
      `new accounts   ${
        provisionHederaAccount === undefined
          ? "off — registration must bring its own account id"
          : `created by the platform, funded with ${config.newAccountBalanceHbar} HBAR, key held encrypted`
      }`,
    );
  });
}

await main();

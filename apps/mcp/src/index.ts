/**
 * The resource server process.
 *
 * Composition root: this is the one place that decides which adapter, which
 * store and which facilitator the handler gets. Everything below it takes its
 * dependencies as arguments, which is what makes the Monday cutover a change
 * here rather than a change everywhere.
 */

import { MOCK_ESCROW_ACCOUNT_ID, MockChainAdapter, type ChainAdapter } from "@handoff/schema";
import {
  assertOperatorKeyMatches,
  createHederaChainAdapter,
  loadChainEnv,
  type ChainEnv,
} from "@handoff/chain";
import { SupabaseContentAdapter, type ContentStoreAdapter } from "@handoff/content";
import { chainModeFromEnv, configFromEnv, type ChainMode } from "./config.js";
import { InMemoryContentStore, contentStore, type ContentStore } from "./content.js";
import { createHttpServer } from "./http.js";
import { Facilitator } from "./x402/facilitator.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set, and HANDOFF_CHAIN=testnet needs it. See .env.example.`);
  }
  return value;
}

function chainFromEnv(mode: ChainMode, env: ChainEnv | undefined): ChainAdapter {
  if (mode === "mock" || env === undefined) {
    // Loud on purpose. Mock transaction ids look like MOCK-tx-1 and 404 on
    // Hashscan, and the one failure this project cannot afford is one of them
    // reaching a recording unnoticed.
    console.warn(
      "\n  MOCK CHAIN. Transaction ids are fabricated and 404 on Hashscan.\n" +
        "  Never record this. Set HANDOFF_CHAIN=testnet after the cutover.\n",
    );
    return new MockChainAdapter();
  }

  // The escrow is one shared account, provisioned once out of band, decided in
  // docs/decisions/2026-09-07-one-shared-escrow-account-this-week.md. Its id and
  // the two platform keys are configuration to this process, never something it
  // creates: a process that made its own escrow on boot would post orders whose
  // funds nobody else can reach.
  //
  // The factory takes strings so this file needs no Hedera SDK import, which is
  // the repo layout rule. It also leaves `resolveClaimantKey` unset, so this
  // server refuses to publish a claim rather than signing as an expert.
  return createHederaChainAdapter(env, {
    escrowAccountId: required("HANDOFF_ESCROW_ACCOUNT_ID"),
    verifierKey: required("HANDOFF_VERIFIER_KEY"),
    scheduleAdminKey: required("HANDOFF_SCHEDULE_ADMIN_KEY"),
  });
}

function contentFromEnv(mode: ChainMode): ContentStore {
  if (mode === "mock") {
    return new InMemoryContentStore();
  }

  // In-memory content with a real chain is the worst pair: the envelope commits
  // to a hash on a public topic while the bytes live in this process's heap, so
  // the expert app in another process fetches nothing. The store moves with the
  // chain, on the same mode, never on a switch of its own.
  const adapter: ContentStoreAdapter = new SupabaseContentAdapter({
    url: required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
    bucket: process.env["SUPABASE_BUCKET"]?.trim() || "handoff-content",
  });
  return contentStore(adapter);
}

async function main(): Promise<void> {
  const config = configFromEnv();
  // Read once. Two reads is how "mock chain with a real content store" happens
  // the day one branch drifts from the other.
  const mode = chainModeFromEnv();

  // Before anything listens. A raw hex key carries no curve, so it is read as
  // ECDSA by default, and a wrong choice is a valid key for a different
  // account — every transaction then fails INVALID_SIGNATURE, which names the
  // signature and nothing else. Cheaper to refuse to start.
  const env = mode === "testnet" ? loadChainEnv() : undefined;
  if (env !== undefined) {
    await assertOperatorKeyMatches(env);
  }

  const server = createHttpServer(
    {
      facilitator: new Facilitator({ baseUrl: config.facilitatorUrl }),
      gateConfig: {
        network: config.network,
        receiverAccountId: config.receiverAccountId,
        feeTinybars: config.feeTinybars,
        serviceUrl: config.serviceUrl,
      },
      chain: chainFromEnv(mode, env),
      content: contentFromEnv(mode),
      ordersTopicId: config.ordersTopicId,
      attestationsTopicId: config.attestationsTopicId,
      // Read from the same place the adapter is given it, and from the mock's
      // own constant otherwise. Two sources for one escrow id is how a settle
      // ends up debiting an account the fund lock never credited.
      escrowAccountId: mode === "testnet" ? required("HANDOFF_ESCROW_ACCOUNT_ID") : MOCK_ESCROW_ACCOUNT_ID,
      certTags: config.certTags,
    },
    { log: (line) => console.log(line) },
  );

  server.listen(config.port, () => {
    console.log(`handoff resource server on :${config.port}`);
    console.log(`  facilitator  ${config.facilitatorUrl} (${config.network})`);
    console.log(`  fee          ${config.feeTinybars} tinybars to ${config.receiverAccountId}`);
    console.log(`  orders topic ${config.ordersTopicId}`);
    console.log(`  resource     ${config.serviceUrl}`);
    console.log(`  chain        ${mode}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

await main();

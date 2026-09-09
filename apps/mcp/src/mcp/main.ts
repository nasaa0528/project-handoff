/**
 * The MCP server process, spoken over stdio.
 *
 * Started by an agent client (Claude Code, Cursor, a desktop app), not by us,
 * so it takes everything from the environment and writes nothing to stdout.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./server.js";
import { fetchTags, UnwiredSigner, type PaymentSigner, type PreflightCheck } from "./client.js";
import { createX402Signer } from "@handoff/chain";
import { preflight } from "../preflight.js";
import type { CertTagOption } from "../config.js";

// `||`, not `??`: `.env.example` ships these keys with an empty value, and an
// empty string is a set variable. Under `??` the default never fires and the
// base url becomes "", which fails every fetch with "Failed to parse URL from
// /tags" — a message that names neither the variable nor the file. The
// resource-server half in ../config.ts already reads it this way, and its
// comment says one variable moves both.
const baseUrl = process.env["HANDOFF_SERVICE_URL"]?.trim() || "http://localhost:4021";
const mirrorNodeUrl =
  process.env["HEDERA_MIRROR_NODE_URL"]?.trim() || "https://testnet.mirrornode.hedera.com/api/v1";

// stderr, because stdout is the JSON-RPC channel.
console.error(`handoff_verify -> ${baseUrl}`);

/**
 * The payer, if this session has one.
 *
 * Absent is a supported state, not a broken one. A session with no payer
 * account still gets both tools: reads are free and ungated, and ordering
 * fails at the signer with the price in the message. Refusing to start would
 * take `handoff_status` away too, and nobody restarts an agent client to
 * recover a tool they never saw appear.
 */
const payerAccountId = process.env["X402_PAYER_ACCOUNT_ID"]?.trim();
const payerKey = process.env["X402_PAYER_PRIVATE_KEY"]?.trim();

let signer: PaymentSigner = new UnwiredSigner();
let check: PreflightCheck | undefined;

/**
 * `.env.example` ships `X402_PAYER_ACCOUNT_ID=0.0.xxxxxx` as a shape to copy.
 * Someone who filled in the key but not the account would otherwise get
 * "account not found" out of the facilitator, which names neither the file nor
 * the line. A real account id is decimal, so this cannot reject one.
 */
function isPlaceholder(accountId: string): boolean {
  return !/^\d+\.\d+\.\d+$/.test(accountId);
}

if (payerAccountId && payerKey && !isPlaceholder(payerAccountId)) {
  try {
    signer = createX402Signer({
      accountId: payerAccountId,
      privateKey: payerKey,
      resourceUrl: `${baseUrl.replace(/\/+$/, "")}/orders`,
      maxAmountTinybars: process.env["X402_MAX_FEE_TINYBARS"]?.trim() || "100000000",
    });
    // The fee is the server's to state, so the amount comes from the quote and
    // never from configuration here. The order value is the caller's and is
    // not this account's problem: the escrow is funded server-side from the
    // requester account, so this checks the fee alone.
    check = async (requirements) =>
      preflight(
        { payerAccountId, feeTinybars: requirements.amount },
        { mirrorNodeUrl },
      );
    console.error(`x402 payer: ${payerAccountId}`);
  } catch (error) {
    // A wrong key type is the common one, and its message names the key type
    // rather than the signature. Say it once here instead of on every order.
    console.error(`x402 payer unavailable: ${(error as Error).message}`);
  }
} else {
  console.error(
    payerAccountId && isPlaceholder(payerAccountId)
      ? `payment signer: none. X402_PAYER_ACCOUNT_ID is ${payerAccountId}, which is the ` +
        `placeholder from .env.example rather than an account. Reads work either way.`
      : "payment signer: none. Set X402_PAYER_ACCOUNT_ID and X402_PAYER_PRIVATE_KEY to order; " +
        "reads work either way.",
  );
}

/**
 * Fetch the tag list, patiently, and start anyway if it never arrives.
 *
 * An agent client starts this process on its own schedule, and nothing
 * guarantees the resource server came up first. Exiting on a connection
 * refused would leave the session with no `handoff` tools at all — and nobody
 * restarts an agent client to recover a tool they never saw appear, so the
 * failure would read as "the MCP server is broken" rather than as "start the
 * other process."
 *
 * So: retry over a few seconds, and if it still will not answer, start with an
 * unenumerated tag. The tool description says the list is unknown, and the
 * resource server still refuses an unknown tag on the wire with the exact
 * copy. The weaker guarantee is the schema one, and it fails safe.
 */
async function resolveTags(): Promise<readonly CertTagOption[]> {
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchTags({ baseUrl });
    } catch (error) {
      if (attempt === attempts) {
        console.error(
          `could not read the credential list from ${baseUrl} after ${attempts} tries ` +
            `(${(error as Error).message}). Start the resource server, then restart this ` +
            `session to get the tags enumerated. Ordering still works and an unknown tag ` +
            `is still refused, just by the server rather than by the tool schema.`,
        );
        return [];
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return [];
}

const certTags = await resolveTags();
if (certTags.length > 0) {
  console.error(`credentials: ${certTags.map((tag) => tag.code).join(", ")}`);
}

const requesterAccountId =
  payerAccountId && !isPlaceholder(payerAccountId) ? payerAccountId : undefined;

serveStdio(() =>
  createMcpServer({
    baseUrl,
    // The account that signs the fee is the account that funds the escrow.
    // One variable, both uses, so they cannot drift apart. Absent when no
    // payer is wired up: that build's signer refuses at the 402, so the body
    // is never parsed and there is no account to leave out.
    ...(requesterAccountId === undefined ? {} : { requesterAccountId }),
    signer,
    certTags,
    ...(check === undefined ? {} : { preflight: check }),
  }),
);

/**
 * The `handoff_verify` and `handoff_status` MCP tools.
 *
 * This is the surface a requester agent orders from, in any session. It holds
 * no keys and talks to no chain: it calls the gated HTTP endpoint and pays,
 * exactly as any other customer would.
 *
 * **The agent's UI is the copy in the tool result.** There is no other
 * requester-facing surface, so replies are rendered as the blocks in
 * `docs/design-system.md` rather than as raw JSON. The structured ids stay in
 * the payload underneath for anything that wants to act on them.
 *
 * Nothing here may write to stdout. That stream is the JSON-RPC channel, and a
 * stray `console.log` corrupts the protocol. Diagnostics go to stderr.
 */

import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { formatTinybars, hbarToTinybars } from "@handoff/schema";
import type { CertTagOption } from "../config.js";
import {
  CLAIM_NOT_READABLE,
  NOT_VISIBLE_YET,
  deliveredReply,
  postedReply,
  waitingReply,
} from "../replies.js";
import { fetchStatus, postOrder, type PaymentSigner, type PreflightCheck } from "./client.js";

export interface McpDeps {
  /** Where the gated resource server is listening. */
  readonly baseUrl: string;
  readonly signer: PaymentSigner;
  /**
   * Checked once the price is known and before anything is signed.
   *
   * Optional so a session with no payer account configured still exposes the
   * tools and fails at the signer with the price in the message, rather than
   * refusing to start.
   */
  readonly preflight?: PreflightCheck;
  /**
   * The credential tags the service routes to, fetched at startup.
   *
   * Enumerated into the input schema so an unknown tag is refused by the
   * schema, before the tool body runs and long before any money moves. The
   * server refuses one too, at parse time — two layers reading one list.
   */
  readonly certTags: readonly CertTagOption[];
  /**
   * The account that pays the service fee, and therefore the account that
   * funds the escrow. Sent as `requester_account_id`, which the resource
   * server requires and then re-derives from the payment before trusting it.
   *
   * Optional for the same reason `preflight` is: a session with no payer still
   * gets both tools, and ordering fails at the signer with the price in the
   * message rather than at a missing field.
   */
  readonly requesterAccountId?: string;
}

function tagDescription(tags: readonly CertTagOption[]): string {
  const preamble =
    "Which certification may claim this order. The tag is the routing: only reviewers " +
    "holding it see the order, and there is no broadcast.";

  if (tags.length === 0) {
    // Said rather than left blank. An agent picking blind should know it is
    // picking blind, and that the service will refuse a wrong guess.
    return `${preamble} The available tags could not be read at startup — call with your best guess and the service will name the real ones if it is wrong.`;
  }

  return `${preamble} ${tags.map((tag) => `${tag.code} (${tag.label})`).join(", ")}`;
}

function labelFor(tags: readonly CertTagOption[], code: string): string {
  return tags.find((tag) => tag.code === code)?.label ?? code;
}

interface PostedBody {
  readonly order_id?: string;
  readonly service_fee?: { readonly settled?: boolean; readonly amount_tinybars?: string; readonly error?: string };
}

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: "handoff", version: "0.1.0" });

  const certTagCodes = deps.certTags.map((tag) => tag.code);
  // An empty list means the service would not say what it routes to at
  // startup. Falling back to a free string keeps the tool usable; the server
  // still refuses an unknown tag on the wire, which is the weaker of the two
  // guarantees but the one that cannot be skipped.
  const certTag =
    certTagCodes.length === 0
      ? z.string().min(1)
      : certTagCodes.length === 1 && certTagCodes[0] !== undefined
        ? z.literal(certTagCodes[0])
        : z.enum(certTagCodes as [string, ...string[]]);

  const inputSchema = z.object({
    spec: z
      .string()
      .min(1)
      .describe("What the expert is being asked to judge. Stored, hashed, never published."),
    artifact: z
      .string()
      .min(1)
      .describe("The work to be reviewed. Stored and hashed; only its hash goes on-chain."),
    cert_tag: certTag.describe(tagDescription(deps.certTags)),
    price_hbar: z
      .string()
      .min(1)
      .describe("What the judgment is worth, in HBAR, as a string. Held in escrow, not the fee."),
    deadline: z
      .string()
      .min(1)
      .describe("UTC instant, second precision, Z only: 2026-09-14T00:00:00Z."),
    claim_timeout_seconds: z
      .int()
      .positive()
      .describe("How long a claimant has before the order reopens. Short next to the deadline."),
  });

  server.registerTool(
    "handoff_verify",
    {
      description:
        "Order a signed review of a piece of work from a certified human. Funds lock up " +
        "front and the expert's attestation is published on Hedera. Calling this costs a " +
        "small service fee over x402, separately from the price of the judgment itself. " +
        // Consent, stated once, where an agent reads it before acting rather
        // than after. Two rails, two amounts, one account.
        "Your agent pays the service fee and locks the order value automatically from the " +
        "configured account.",
      inputSchema,
    },
    async (input) => {
      try {
        const posted = (await postOrder(
          {
            spec: input.spec,
            artifact: input.artifact,
            certTag: input.cert_tag,
            priceHbar: input.price_hbar,
            deadline: input.deadline,
            claimTimeoutSeconds: input.claim_timeout_seconds,
          },
          {
            baseUrl: deps.baseUrl,
            signer: deps.signer,
            ...(deps.requesterAccountId === undefined
              ? {}
              : { requesterAccountId: deps.requesterAccountId }),
            ...(deps.preflight === undefined ? {} : { preflight: deps.preflight }),
          },
        )) as PostedBody & Record<string, unknown>;

        const text = postedReply({
          orderId: posted.order_id ?? "unknown",
          priceTinybars: formatTinybars(hbarToTinybars(input.price_hbar)),
          deadline: input.deadline,
          certTagLabel: labelFor(deps.certTags, input.cert_tag),
          ...(posted.service_fee?.settled === true && posted.service_fee.amount_tinybars !== undefined
            ? { feeTinybars: posted.service_fee.amount_tinybars }
            : { ...(posted.service_fee?.error === undefined ? {} : { feeError: posted.service_fee.error }) }),
        });

        return {
          content: [
            { type: "text", text },
            // The ids stay available for anything that wants to act on them
            // rather than read them. Threaded, never swallowed.
            { type: "text", text: JSON.stringify(posted, null, 2) },
          ],
        };
      } catch (error) {
        // An unpayable or rejected order is an answer the agent can act on,
        // so it comes back as text rather than as a transport error. The
        // server's own failure copy already ends "Nothing was charged."
        return {
          isError: true,
          content: [{ type: "text", text: (error as Error).message }],
        };
      }
    },
  );

  server.registerTool(
    "handoff_status",
    {
      description:
        "Read back what happened to an order you posted: whether it is still open, and " +
        "the signed verdict once a reviewer has published one. Free — this is a read, not " +
        "a payment. Ask once when you want to know; it does not need polling.",
      inputSchema: z.object({
        order_id: z.string().min(1).describe("The id handoff_verify returned."),
      }),
    },
    async (input) => {
      try {
        const status = await fetchStatus(input.order_id, { baseUrl: deps.baseUrl });

        const lines: string[] = [];
        if (status.state === "DELIVERED" && status.verdict !== undefined) {
          lines.push(
            deliveredReply({
              verdict: status.verdict,
              signedBy: status.signedBy ?? "unknown",
              // Self-asserted by the attestation, and said that way.
              ...(status.attestation === undefined ? {} : { certTag: status.attestation.cert_tag }),
            }),
          );
        } else if (status.state === "POSTED" && status.envelope !== undefined) {
          lines.push(waitingReply(status.envelope.deadline));
        } else {
          lines.push(NOT_VISIBLE_YET);
        }

        // Said out loud rather than left to be inferred from silence: a
        // requester reading "waiting" must not conclude nobody has taken it.
        if (!status.claimReadable && status.state !== "DELIVERED") {
          lines.push(CLAIM_NOT_READABLE);
        }

        return {
          content: [
            { type: "text", text: lines.join("\n") },
            { type: "text", text: JSON.stringify(status, null, 2) },
          ],
        };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: (error as Error).message }] };
      }
    },
  );

  return server;
}

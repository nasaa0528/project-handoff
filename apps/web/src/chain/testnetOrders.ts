/**
 * Orders off the real topic.
 *
 * Everything the inbox knows on testnet comes from two reads. The orders
 * topic, through the expert's chain, gives the envelopes and every claim in
 * consensus order; the treaty's `resolveClaims` says who holds each one. The
 * content store, by the hashes the envelope committed to, gives the ask now
 * and the document after a confirmed claim. Nothing is inferred from a click.
 *
 * A claim goes out through `submitMessage` on the expert's own chain, whose
 * operator is the expert, so the payer account on the topic message is the
 * claimant, which is what every reader takes the claimant from.
 */

import { OrderEnvelope, type ConsensusRef, type ReviewOrder, type TopicMessage } from "@handoff/schema";
import type { ContentStore } from "../content";
import { claimBody, claimRecordsFor, claimStateFor, TOPIC_READ_LIMIT, type ClaimReader } from "../orders/claim";
import { titleFromAsk, type ClaimState, type ExpertOrder, type InboxEntry } from "../orders/order";
import type { OrderSource } from "../orders/source";
import type { ExpertChain } from "./adapter";

export interface TestnetOrdersDeps {
  readonly chain: Pick<ExpertChain, "readMessages" | "submitMessage">;
  readonly content: ContentStore;
  readonly ordersTopicId: string;
  /** Where the verdict goes. Never the orders topic. */
  readonly attestationsTopicId: string;
  /** The shared escrow account. Shown; the payout locator reads about it. */
  readonly escrowAccountId: string;
  readonly expertAccountId: string;
  /** Injectable so tests are deterministic. Epoch milliseconds. */
  readonly now?: () => number;
}

/** A review order, or nothing. Claims share the topic, and so may anything else. */
export function tryDecodeReviewOrder(body: string): ReviewOrder | null {
  try {
    const result = OrderEnvelope.safeParse(JSON.parse(body));
    return result.success && result.data.class === "review" ? result.data : null;
  } catch {
    return null;
  }
}

const decoder = new TextDecoder();

export class TestnetOrderSource implements OrderSource {
  readonly reader: ClaimReader;
  readonly #deps: TestnetOrdersDeps;
  /** The ask, by spec hash. Content-addressed, so it never changes once read. */
  readonly #asks = new Map<string, string>();

  constructor(deps: TestnetOrdersDeps) {
    this.#deps = deps;
    this.reader = deps.chain;
  }

  #nowSeconds(): number {
    return Math.floor((this.#deps.now ?? Date.now)() / 1000);
  }

  #state(order: ReviewOrder, messages: readonly TopicMessage[]): ClaimState {
    return claimStateFor(order, claimRecordsFor(messages, order.order_id), this.#deps.expertAccountId, this.#nowSeconds());
  }

  async #messages(): Promise<readonly TopicMessage[]> {
    return this.#deps.chain.readMessages(this.#deps.ordersTopicId, { limit: TOPIC_READ_LIMIT });
  }

  /** The ask, or a sentence saying why not. Only a real ask is cached, or names the order. */
  async #ask(specHash: string): Promise<{ readonly ask: string; readonly known: boolean }> {
    const cached = this.#asks.get(specHash);
    if (cached !== undefined) return { ask: cached, known: true };
    let bytes: Uint8Array | null;
    try {
      bytes = await this.#deps.content.get(specHash);
    } catch (error) {
      return { ask: `The task description could not be read: ${error instanceof Error ? error.message : String(error)}`, known: false };
    }
    if (bytes === null) return { ask: "The task description is not in the content store yet.", known: false };
    const ask = decoder.decode(bytes);
    this.#asks.set(specHash, ask);
    return { ask, known: true };
  }

  async list(): Promise<readonly InboxEntry[]> {
    const messages = await this.#messages();
    const seen = new Set<string>();
    const entries: InboxEntry[] = [];
    for (const message of messages) {
      const envelope = tryDecodeReviewOrder(message.contents);
      // The first envelope for an id is the order; a repeat is noise.
      if (envelope === null || seen.has(envelope.order_id)) continue;
      seen.add(envelope.order_id);
      const { ask, known } = await this.#ask(envelope.spec_hash);
      const order: ExpertOrder = {
        envelope,
        escrowAccountId: this.#deps.escrowAccountId,
        ordersTopicId: this.#deps.ordersTopicId,
        attestationsTopicId: this.#deps.attestationsTopicId,
        title: known ? titleFromAsk(ask, envelope.order_id) : `Order ${envelope.order_id}`,
        ask,
        documentWords: null,
      };
      entries.push({ order, claim: this.#state(envelope, messages) });
    }
    return entries;
  }

  async claim(order: ExpertOrder): Promise<ConsensusRef> {
    return this.#deps.chain.submitMessage(this.#deps.ordersTopicId, claimBody(order.envelope));
  }

  async document(order: ExpertOrder): Promise<string> {
    // The topic decides, not the caller.
    const state = this.#state(order.envelope, await this.#messages());
    if (state.kind !== "yours") throw new Error("The document opens after a confirmed claim.");
    const bytes = await this.#deps.content.get(order.envelope.artifact_hash_in);
    if (bytes === null) throw new Error("The document is not in the content store.");
    return decoder.decode(bytes);
  }
}

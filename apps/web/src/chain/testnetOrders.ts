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
import { claimBody, claimCandidateAccountIdFor, claimRecordsFor, claimStateFor, TOPIC_READ_LIMIT, type ClaimReader } from "../orders/claim";
import { deliveredStateFor, type DeliveredState } from "../orders/delivery";
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

  /**
   * Both facts about one order, resolved together and never apart.
   *
   * Two passes, and the order matters. The first asks the claims alone who
   * holds the order; only then can the second tell the holder's own attestation
   * from a stranger's. The holder's own is then fed back in as `deliveredAt`, so
   * a signed claim stops expiring — which is what the treaty says and what the
   * reader used to get wrong.
   */
  #facts(
    order: ReviewOrder,
    messages: readonly TopicMessage[],
    attestations: readonly TopicMessage[],
  ): { readonly claim: ClaimState; readonly delivered: DeliveredState | null } {
    const records = claimRecordsFor(messages, order.order_id);
    const now = this.#nowSeconds();
    const candidate = claimCandidateAccountIdFor(order, records, now);
    const delivered = deliveredStateFor(order, attestations, candidate, this.#deps.expertAccountId);
    const claim = claimStateFor(order, records, this.#deps.expertAccountId, now, delivered?.consensusTimestamp);
    return { claim, delivered };
  }

  async #messages(): Promise<readonly TopicMessage[]> {
    return this.#deps.chain.readMessages(this.#deps.ordersTopicId, { limit: TOPIC_READ_LIMIT });
  }

  /**
   * The attestations topic, read once per refresh rather than once per order.
   *
   * This read did not exist, which is the whole bug: the app had no way to know
   * a verdict had been published, so it offered the form again.
   */
  async #attestations(): Promise<readonly TopicMessage[]> {
    return this.#deps.chain.readMessages(this.#deps.attestationsTopicId, { limit: TOPIC_READ_LIMIT });
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
    // Both topics, concurrently. Two reads per refresh, not two per order.
    const [messages, attestations] = await Promise.all([this.#messages(), this.#attestations()]);
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
      entries.push({ order, ...this.#facts(envelope, messages, attestations) });
    }
    return entries;
  }

  async claim(order: ExpertOrder): Promise<ConsensusRef> {
    return this.#deps.chain.submitMessage(this.#deps.ordersTopicId, claimBody(order.envelope));
  }

  async document(order: ExpertOrder): Promise<string> {
    // The topic decides, not the caller.
    const [messages, attestations] = await Promise.all([this.#messages(), this.#attestations()]);
    const { claim, delivered } = this.#facts(order.envelope, messages, attestations);
    // Held by this expert, or already signed by them. The second half is not a
    // loosening: an expert reopening the order they judged is the ordinary way
    // to read back what they signed, and refusing it was the reader forgetting
    // that a delivered claim never expires.
    if (claim.kind !== "yours" && delivered?.yours !== true) {
      throw new Error("The document opens after a confirmed claim.");
    }
    const bytes = await this.#deps.content.get(order.envelope.artifact_hash_in);
    if (bytes === null) throw new Error("The document is not in the content store.");
    return decoder.decode(bytes);
  }
}

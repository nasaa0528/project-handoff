/**
 * MOCK ONLY. The inbox's side of the lifecycle, in miniature: several
 * fabricated orders posted and funded on the mock chain, two of them already
 * claimed by other experts, and one rigged so that a rival's claim lands a
 * moment before this expert's. That last one exists because a lost race has
 * to be an ordinary screen, and a screen nobody can reach is a screen nobody
 * has looked at.
 *
 * Everything here reads the way the real thing will. Claim state comes from
 * the claim messages on the topic in consensus order, never from a flag set
 * when a button was clicked. The document is handed out only when the topic
 * says the claim is this expert's. After the cutover this file is a test
 * fixture and never appears in a demo or a recording.
 */

import {
  assertClaimTimeoutFitsWindow,
  encodeEnvelope,
  formatTinybars,
  hbarToTinybars,
  ReviewOrder,
  SCHEMA_VERSION,
  type ConsensusRef,
  type MockChainAdapter,
  type ReadMessagesOptions,
  type TopicMessage,
  signFundLock,
} from "@handoff/schema";
import fakeArtifact from "../../../../assets/demo/fake-quarterly-summary.txt?raw";
import fakeSpec from "../../../../assets/demo/fake-review-spec.txt?raw";
import fakeVendorClause from "../../../../assets/demo/fake-vendor-clause.txt?raw";
import fakeVendorSpec from "../../../../assets/demo/fake-vendor-spec.txt?raw";
import type { ContentStore } from "../content";
import { claimBody, claimRecordsFor, claimStateFor, type ClaimReader } from "../orders/claim";
import { countWords, type ClaimState, type ExpertOrder, type InboxEntry } from "../orders/order";
import type { OrderSource } from "../orders/source";
import { notesToBytes, sha256HexOfBytes } from "../sign/notes";
import { FAKE_CERT_TAG } from "./mockPlatform";

const RIVAL_ACCOUNT_ID = "MOCK-rival-expert";

interface Fixture {
  readonly orderId: string;
  readonly title: string;
  readonly spec: string;
  readonly artifact: string;
  readonly claimTimeoutSeconds: number;
  readonly deadlineSecondsFromNow: number;
  /** Already claimed by another expert before this one arrived. Hidden from the inbox. */
  readonly claimedByRival: boolean;
  /** A rival claims a moment before this expert does. Lost-race demo. */
  readonly racedByRival: boolean;
}

const FIXTURES: readonly Fixture[] = [
  {
    orderId: "ord_mock_demo_0001",
    title: "Quarterly summary — internal consistency",
    spec: fakeSpec,
    artifact: fakeArtifact,
    claimTimeoutSeconds: 1800,
    deadlineSecondsFromNow: 3 * 24 * 3600,
    claimedByRival: false,
    racedByRival: false,
  },
  {
    orderId: "ord_mock_demo_0002",
    title: "Service-credit clauses — can the customer collect?",
    spec: fakeVendorSpec,
    artifact: fakeVendorClause,
    claimTimeoutSeconds: 3600,
    deadlineSecondsFromNow: 26 * 3600,
    claimedByRival: false,
    racedByRival: true,
  },
  {
    orderId: "ord_mock_demo_0003",
    title: "Quarterly summary — footnotes only",
    spec: fakeSpec,
    artifact: fakeArtifact,
    claimTimeoutSeconds: 1800,
    deadlineSecondsFromNow: 2 * 24 * 3600,
    claimedByRival: true,
    racedByRival: false,
  },
  {
    orderId: "ord_mock_demo_0004",
    title: "Service-credit clauses — exclusions",
    spec: fakeVendorSpec,
    artifact: fakeVendorClause,
    claimTimeoutSeconds: 3600,
    deadlineSecondsFromNow: 5 * 24 * 3600,
    claimedByRival: true,
    racedByRival: false,
  },
];

export interface MockOrdersOptions {
  readonly expertAccountId: string;
  readonly ordersTopicId: string;
  /** Where the verdict goes. A separate topic here too, so the mock cannot hide the bug. */
  readonly attestationsTopicId: string;
  readonly requesterAccountId: string;
  /** In HBAR, as a string. Never a float. */
  readonly priceHbar: string;
  /** How long a new message stays invisible to reads, like a real mirror. */
  readonly mirrorLagMs: number;
  /** Injectable so tests are deterministic. Epoch milliseconds. */
  readonly now?: () => number;
}

/** `Utc` in the schema is second precision, `Z` only. */
function utcSecondsFromNow(nowMillis: number, seconds: number): string {
  return new Date(nowMillis + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Mirror lag for a topic, simulated. Messages that existed when the reader
 * was made are visible at once, as if published long ago; anything newer
 * appears `lagMs` after a read first misses it. Same idea as the transaction
 * lag in `mockPlatform.ts`, for the other kind of read.
 */
export function withSimulatedTopicLag(
  chain: ClaimReader,
  lagMs: number,
  now: () => number,
  alreadyVisible: readonly number[] = [],
): ClaimReader {
  const firstMissed = new Map<number, number>();
  for (const sequence of alreadyVisible) firstMissed.set(sequence, Number.NEGATIVE_INFINITY);
  return {
    async readMessages(topicId: string, options?: ReadMessagesOptions): Promise<readonly TopicMessage[]> {
      const all = await chain.readMessages(topicId, options);
      const at = now();
      return all.filter((m) => {
        const missed = firstMissed.get(m.sequenceNumber);
        if (missed === undefined) {
          firstMissed.set(m.sequenceNumber, at);
          return false;
        }
        return at - missed >= lagMs;
      });
    },
  };
}

export class MockOrderSource implements OrderSource {
  readonly reader: ClaimReader;
  readonly #chain: MockChainAdapter;
  readonly #content: ContentStore;
  readonly #options: MockOrdersOptions;
  readonly #orders: readonly ExpertOrder[];
  readonly #raced: ReadonlySet<string>;
  #racesRun = new Set<string>();

  private constructor(
    chain: MockChainAdapter,
    content: ContentStore,
    options: MockOrdersOptions,
    orders: readonly ExpertOrder[],
    raced: ReadonlySet<string>,
    reader: ClaimReader,
  ) {
    this.#chain = chain;
    this.#content = content;
    this.#options = options;
    this.#orders = orders;
    this.#raced = raced;
    this.reader = reader;
  }

  /** Post and fund every fixture, and let the rival claim the ones marked as theirs. */
  static async seed(
    chain: MockChainAdapter,
    content: ContentStore,
    options: MockOrdersOptions,
  ): Promise<MockOrderSource> {
    const now = options.now ?? Date.now;
    const nowMillis = now();
    const orders: ExpertOrder[] = [];
    const raced = new Set<string>();

    for (const fixture of FIXTURES) {
      const [specHash, artifactHash] = await Promise.all([
        sha256HexOfBytes(notesToBytes(fixture.spec)),
        sha256HexOfBytes(notesToBytes(fixture.artifact)),
      ]);
      await content.put(specHash, notesToBytes(fixture.spec));
      await content.put(artifactHash, notesToBytes(fixture.artifact));

      const envelope = ReviewOrder.parse({
        order_id: fixture.orderId,
        class: "review",
        spec_hash: specHash,
        artifact_hash_in: artifactHash,
        cert_tag: FAKE_CERT_TAG,
        price_tinybars: formatTinybars(hbarToTinybars(options.priceHbar)),
        deadline: utcSecondsFromNow(nowMillis, fixture.deadlineSecondsFromNow),
        claim_timeout_seconds: fixture.claimTimeoutSeconds,
        schema_version: SCHEMA_VERSION,
      });
      assertClaimTimeoutFitsWindow(Math.floor(nowMillis / 1000), envelope);

      // Lock before publish, same as apps/mcp: a public order with no money
      // behind it is the worse failure. The requester signs it themselves now,
      // and this seeder plays that role.
      const lockParams = {
        orderId: envelope.order_id,
        amountTinybars: envelope.price_tinybars,
        requesterAccountId: options.requesterAccountId,
      };
      const unsignedLock = await chain.buildFundLock(lockParams);
      const escrow = await chain.submitFundLock(
        lockParams,
        signFundLock(unsignedLock.transactionBytes, options.requesterAccountId),
      );
      await chain.submitMessage(options.ordersTopicId, encodeEnvelope(envelope));
      if (fixture.claimedByRival) {
        await chain.publishClaim(options.ordersTopicId, RIVAL_ACCOUNT_ID, claimBody(envelope));
      }
      if (fixture.racedByRival) raced.add(envelope.order_id);

      orders.push({
        envelope,
        escrowAccountId: escrow.escrowAccountId,
        ordersTopicId: options.ordersTopicId,
        attestationsTopicId: options.attestationsTopicId,
        title: fixture.title,
        ask: fixture.spec,
        documentWords: countWords(fixture.artifact),
      });
    }

    const seeded = (await chain.readMessages(options.ordersTopicId)).map((m) => m.sequenceNumber);
    const reader = withSimulatedTopicLag(chain, options.mirrorLagMs, now, seeded);
    return new MockOrderSource(chain, content, options, orders, raced, reader);
  }

  /** The treaty's rule, with the clock the mock was built with. */
  #state(order: ExpertOrder, messages: readonly TopicMessage[]): ClaimState {
    const now = this.#options.now ?? Date.now;
    return claimStateFor(
      order.envelope,
      claimRecordsFor(messages, order.envelope.order_id),
      this.#options.expertAccountId,
      Math.floor(now() / 1000),
    );
  }

  async list(): Promise<readonly InboxEntry[]> {
    const messages = await this.reader.readMessages(this.#options.ordersTopicId);
    return this.#orders.map((order) => ({ order, claim: this.#state(order, messages) }));
  }

  async claim(order: ExpertOrder): Promise<ConsensusRef> {
    const orderId = order.envelope.order_id;
    if (this.#raced.has(orderId) && !this.#racesRun.has(orderId)) {
      // The rival was a moment quicker. Their message gets the earlier
      // consensus timestamp, and the mirror will say so.
      this.#racesRun.add(orderId);
      await this.#chain.publishClaim(this.#options.ordersTopicId, RIVAL_ACCOUNT_ID, claimBody(order.envelope));
    }
    return this.#chain.publishClaim(this.#options.ordersTopicId, this.#options.expertAccountId, claimBody(order.envelope));
  }

  async document(order: ExpertOrder): Promise<string> {
    // The topic decides, not the caller. Showing the document to a
    // non-claimant would leak access-controlled content.
    const messages = await this.reader.readMessages(this.#options.ordersTopicId);
    const state = this.#state(order, messages);
    if (state.kind !== "yours") throw new Error("The document opens after a confirmed claim.");
    const bytes = await this.#content.get(order.envelope.artifact_hash_in);
    if (bytes === null) throw new Error("The document is not in the content store.");
    return new TextDecoder().decode(bytes);
  }
}

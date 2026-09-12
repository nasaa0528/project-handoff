/**
 * An order as the inbox and the workspace see it: the envelope plus the two
 * things the envelope only commits to by hash. The title and the ask come
 * from the content store, because the envelope carries `spec_hash` and
 * nothing readable. The document itself is not here on purpose: it opens
 * only after a confirmed claim, and a type that carried it would let a
 * screen show it to a non-claimant by accident.
 */

import type { OrderForSigning } from "../sign/sign";

export interface ExpertOrder extends OrderForSigning {
  /**
   * The orders topic: where this envelope was published, and where its claims
   * go. Distinct from `attestationsTopicId`, which is where the verdict goes.
   */
  readonly ordersTopicId: string;
  /** What the work is, one line. */
  readonly title: string;
  /** "What the requester is asking." The task description, from the content store. */
  readonly ask: string;
  /**
   * How big the document is, for the row. Null when the store cannot say
   * before the claim; the workspace counts the document itself once it has it.
   */
  readonly documentWords: number | null;
}

/** What the network says about who holds this order, per the treaty's claim rule. */
export type ClaimState =
  | { readonly kind: "open" }
  | {
      readonly kind: "yours";
      /** The network's clock, not the browser's. */
      readonly claimedAtEpochSeconds: number;
      /** Never past the order deadline. */
      readonly signBy: string;
    }
  | {
      readonly kind: "someone-else";
      /**
       * When the holder's window runs out. At that point the order returns to
       * the inbox and anyone may claim it again, first come. A claim that
       * raced and lost holds no position and no priority: the treaty's rule
       * says a claim that lost stays lost, so nothing here is a queue.
       */
      readonly holderSignBy: string;
      /** This expert claimed it and lost. True only when the topic says so. */
      readonly youClaimed: boolean;
    }
  /** The claim window expired twice. Nobody can claim it again. */
  | { readonly kind: "closed" };

export interface InboxEntry {
  readonly order: ExpertOrder;
  readonly claim: ClaimState;
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

/** The ask's task line, without its FAKE label, for a row or a title. */
export function askSummary(ask: string): string {
  const lines = ask
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^FAKE\b/.test(l));
  const task = lines.find((l) => /^Task\b/i.test(l)) ?? lines[0] ?? "";
  return task.replace(/^Task\s*(\(FAKE\))?\s*:\s*/i, "");
}

/** A title when the store gave none: the ask's first sentence, cut to a line. */
export function titleFromAsk(ask: string, orderId: string): string {
  const summary = askSummary(ask);
  if (summary === "") return `Order ${orderId}`;
  const sentence = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
  const title = sentence.replace(/[.!?]$/, "");
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title;
}

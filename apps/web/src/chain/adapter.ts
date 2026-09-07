/**
 * The one place the expert app picks a chain.
 *
 * Mock until the Monday-night cutover, then the real adapter from
 * `packages/chain`, constructed with the expert's own account. Both satisfy
 * the same `ChainAdapter` interface, so the sign action does not change; only
 * this file does. Nothing in this app imports the Hedera SDK.
 */

import { MockChainAdapter, type ChainAdapter } from "@handoff/schema";
import { InMemoryContentStore, type ContentStore } from "../content";
import type { ChainMode, WebChainConfig } from "./config";

export interface WebChain {
  readonly mode: ChainMode;
  /** Signs as the expert, and as nobody else. */
  readonly chain: ChainAdapter;
  readonly content: ContentStore;
}

export function createWebChain(config: WebChainConfig): WebChain {
  switch (config.mode) {
    case "mock":
      return { mode: "mock", chain: new MockChainAdapter(), content: new InMemoryContentStore() };
    case "testnet":
      // Not a silent fallback to the mock: a screen that says "testnet" while
      // showing mock ids is the exact thing the recording rule forbids.
      throw new Error(
        "The testnet adapter arrives with packages/chain at the Mon Sep 7 cutover. " +
          "Until then run with VITE_CHAIN=mock, and never record it.",
      );
  }
}

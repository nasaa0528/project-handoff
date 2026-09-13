/**
 * The one place the expert app picks a chain, now from a connection.
 *
 * Mock until the cutover, then the expert's slice of the real chain from
 * `packages/chain`, built with the expert's own account and key. Both satisfy
 * the same `ExpertChain` shape, so the sign action does not change; only this
 * file does. Nothing in this app imports the Hedera SDK: the testnet branch
 * imports one factory from `@handoff/chain/expert`, which holds the key in a
 * closure and exposes four methods.
 *
 * Two rules are types here rather than prose. `ExpertChain` is the slice of
 * the adapter the expert app is allowed to call: the expert's key signs the
 * HCS message and nothing else, so the sign path's type has no `signSchedule`,
 * `createSchedule`, `deleteSchedule` or `lockFunds`. And the mock member of
 * `WebChain` is the only one that carries the whole adapter, under a field
 * named for what it is, because only the mock plays the requester and the
 * platform as well.
 */

import { createExpertChain } from "@handoff/chain/expert";
import { MockChainAdapter, type ChainAdapter } from "@handoff/schema";
import { HttpContentStore, InMemoryContentStore, type ContentStore } from "../content";
import type { ExpertConnection } from "../session/connect";
import type { WebChainConfig } from "./config";

export type ExpertChain = Pick<ChainAdapter, "network" | "submitMessage" | "readMessages" | "getTransaction">;

interface Connected {
  /** The account this chain signs as. From the connect screen, never the environment. */
  readonly expertAccountId: string;
  /** Signs as the expert, and as nobody else. */
  readonly chain: ExpertChain;
  readonly content: ContentStore;
  /** Idempotent. Drops whatever the adapter holds, including the key. */
  disconnect(): void;
}

export interface MockWebChain extends Connected {
  readonly mode: "mock";
  /** MOCK ONLY. The whole adapter, for the stand-in requester and platform. */
  readonly mock: MockChainAdapter;
}

export interface TestnetWebChain extends Connected {
  readonly mode: "testnet";
}

export type WebChain = MockWebChain | TestnetWebChain;

export class ConnectionMismatch extends Error {
  constructor(configured: string, connected: string) {
    super(`The app is configured for ${configured} but the connection is for ${connected}.`);
    this.name = "ConnectionMismatch";
  }
}

export function createWebChain(config: WebChainConfig, connection: ExpertConnection): WebChain {
  if (config.mode !== connection.mode) throw new ConnectionMismatch(config.mode, connection.mode);

  switch (connection.mode) {
    case "mock": {
      const mock = new MockChainAdapter();
      // The expert's chain signs as the expert, so what it publishes is paid
      // by the expert's account. The bare adapter stamps "MOCK-payer", and a
      // verdict paid by nobody in particular is nobody's verdict: the inbox
      // never saw a signed order as signed on the mock.
      const chain: ExpertChain = {
        network: mock.network,
        readMessages: (topicId, options) => mock.readMessages(topicId, options),
        getTransaction: (transactionId) => mock.getTransaction(transactionId),
        submitMessage: (topicId, contents) => mock.publishClaim(topicId, connection.accountId, contents),
      };
      return {
        mode: "mock",
        expertAccountId: connection.accountId,
        chain,
        mock,
        content: new InMemoryContentStore(),
        disconnect() {},
      };
    }
    case "testnet": {
      if (config.mode !== "testnet") throw new ConnectionMismatch(config.mode, connection.mode);
      const { accountId, credential, accountPublicKey } = connection;

      // The one read of the key. It goes straight into the factory's closure
      // and is checked against the account's public key before a client
      // exists, so a wrong paste fails here with a plain message rather than
      // at the first signature.
      const expert = credential.key.useOnce((privateKeyDer) =>
        createExpertChain({
          accountId,
          privateKeyDer,
          keyType: credential.keyType,
          mirrorNodeUrl: config.mirrorNodeUrl,
          ...(accountPublicKey === null ? {} : { expectedPublicKey: accountPublicKey }),
        }),
      );

      let closed = false;
      return {
        mode: "testnet",
        expertAccountId: accountId,
        chain: expert,
        content: new HttpContentStore(config.contentUrl),
        disconnect() {
          if (closed) return;
          closed = true;
          expert.close();
        },
      };
    }
  }
}

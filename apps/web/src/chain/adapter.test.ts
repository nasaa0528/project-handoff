import { describe, expect, expectTypeOf, it } from "vitest";
import type { ExpertConnection } from "../session/connect";
import { SecretKey } from "../session/secret";
import { ConnectionMismatch, createWebChain, type ExpertChain } from "./adapter";
import type { WebChainConfig } from "./config";

const ACCOUNT = "0.0.12345";
const mockConfig: WebChainConfig = {
  mode: "mock",
  expertAccountIdPrefill: null,
  accountsApiUrl: null,
  ordersTopicId: "MOCK-topic-orders",
  mock: { requesterAccountId: "MOCK-requester", priceHbar: "100" },
};
const testnetConfig: WebChainConfig = {
  mode: "testnet",
  expertAccountIdPrefill: null,
  accountsApiUrl: null,
  ordersTopicId: "0.0.4242",
  mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  contentUrl: "https://content.example",
  escrowAccountId: "0.0.999",
  apiUrl: "https://api.example",
};

// A fabricated key. The bytes are a pattern, not a key to anything.
const FIXTURE = `3030020100300706052b8104000a04220420${"c7".repeat(32)}`;

function testnetConnection(key: SecretKey, accountPublicKey: string | null = null): ExpertConnection {
  return {
    mode: "testnet",
    accountId: ACCOUNT,
    credential: { kind: "key", keyType: "ECDSA_SECP256K1", key },
    accountPublicKey,
  };
}

describe("createWebChain", () => {
  it("on the mock, signs as the connected account and exposes the whole adapter once, as the mock", () => {
    const web = createWebChain(mockConfig, { mode: "mock", accountId: ACCOUNT });
    expect(web.mode).toBe("mock");
    expect(web.expertAccountId).toBe(ACCOUNT);
    if (web.mode !== "mock") throw new Error("unreachable");
    expect(web.mock).toBe(web.chain);
    expect(() => web.disconnect()).not.toThrow();
    expect(() => web.disconnect()).not.toThrow();
  });

  it("refuses a connection for the other mode", () => {
    expect(() => createWebChain(testnetConfig, { mode: "mock", accountId: ACCOUNT })).toThrow(ConnectionMismatch);
    const key = SecretKey.fromInput(FIXTURE);
    expect(() => createWebChain(mockConfig, testnetConnection(key))).toThrow(ConnectionMismatch);
  });

  it("on testnet, reads the key once into the expert's slice, and closes it on disconnect", () => {
    const key = SecretKey.fromInput(FIXTURE);
    const web = createWebChain(testnetConfig, testnetConnection(key));
    expect(web.mode).toBe("testnet");
    expect(web.expertAccountId).toBe(ACCOUNT);
    expect(web.chain.network).toBe("testnet");
    expect(key.spent).toBe(true);
    // The key is in a closure, not on the object the app will put in state.
    expect(Object.getOwnPropertyNames(web.chain).some((n) => /key|secret|private/i.test(n))).toBe(false);
    expect(JSON.stringify(web.chain)).not.toContain(FIXTURE.slice(-16));
    expect(() => web.disconnect()).not.toThrow();
    expect(() => web.disconnect()).not.toThrow();
  });

  it("on testnet, refuses a key that does not belong to the account, without quoting it", () => {
    const key = SecretKey.fromInput(FIXTURE);
    const someoneElse = `02${"ab".repeat(32)}`;
    let caught: unknown;
    try {
      createWebChain(testnetConfig, testnetConnection(key, someoneElse));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("KeyMismatchError");
    expect((caught as Error).message).toContain(ACCOUNT);
    expect((caught as Error).message).not.toContain(FIXTURE.slice(-16));
    expect(key.spent).toBe(true);
  });
});

// These assertions are checked by `pnpm typecheck` (tsc over the test files),
// not by `vitest run`, which passes them regardless. CI runs typecheck first.
describe("the shapes that hold the rules", () => {
  it("has no key slot on the mock connection", () => {
    expectTypeOf<Extract<ExpertConnection, { mode: "mock" }>>().not.toHaveProperty("credential");
    expectTypeOf<Extract<ExpertConnection, { mode: "testnet" }>>().toHaveProperty("credential");
  });

  it("gives the sign path no way to touch a schedule or lock funds", () => {
    expectTypeOf<ExpertChain>().not.toHaveProperty("signSchedule");
    expectTypeOf<ExpertChain>().not.toHaveProperty("createSchedule");
    expectTypeOf<ExpertChain>().not.toHaveProperty("deleteSchedule");
    expectTypeOf<ExpertChain>().not.toHaveProperty("lockFunds");
    expectTypeOf<ExpertChain>().toHaveProperty("submitMessage");
    expectTypeOf<ExpertChain["network"]>().toEqualTypeOf<"testnet">();
  });
});

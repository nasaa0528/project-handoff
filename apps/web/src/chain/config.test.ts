import { describe, expect, it } from "vitest";
import { ConfigError, configFromEnv } from "./config";

const expert = "0.0.12345";

describe("configFromEnv", () => {
  it("defaults to the mock and gives mock ids to what it cannot know yet", () => {
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert })).toEqual({
      mode: "mock",
      expertAccountId: expert,
      ordersTopicId: "MOCK-topic-orders",
      requesterAccountId: "MOCK-requester",
    });
  });

  it("requires the expert account, in account-id form", () => {
    expect(() => configFromEnv({})).toThrow(ConfigError);
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: " " })).toThrow(ConfigError);
    // An EVM alias is the same account, but it is not the id the SDK signs with.
    expect(() =>
      configFromEnv({ VITE_EXPERT_ACCOUNT_ID: "0x00000000000000000000000000000000000abcde" }),
    ).toThrow(ConfigError);
  });

  it("refuses any mode that is not mock or testnet", () => {
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_CHAIN: "previewnet" })).toThrow(
      ConfigError,
    );
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_CHAIN: "" })).toThrow(ConfigError);
  });

  it("requires a real topic on testnet", () => {
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_CHAIN: "testnet" })).toThrow(
      /VITE_HANDOFF_ORDERS_TOPIC_ID/,
    );
    expect(
      configFromEnv({
        VITE_EXPERT_ACCOUNT_ID: expert,
        VITE_CHAIN: "testnet",
        VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242",
      }).ordersTopicId,
    ).toBe("0.0.4242");
  });
});

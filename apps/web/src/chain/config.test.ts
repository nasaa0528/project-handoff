import { describe, expect, it } from "vitest";
import { ConfigError, configFromEnv } from "./config";

const expert = "0.0.12345";

describe("configFromEnv", () => {
  it("defaults to the mock and gives mock ids to what it cannot know yet", () => {
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert })).toEqual({
      mode: "mock",
      expertAccountId: expert,
      ordersTopicId: "MOCK-topic-orders",
      mock: { requesterAccountId: "MOCK-requester", priceHbar: "200" },
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

  it("takes the mock price from the environment and refuses one that is not money", () => {
    const priced = configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_MOCK_PRICE_HBAR: "150.5" });
    expect(priced.mode === "mock" && priced.mock.priceHbar).toBe("150.5");
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_MOCK_PRICE_HBAR: "2e2" })).toThrow(
      ConfigError,
    );
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_MOCK_PRICE_HBAR: "0.123456789" })).toThrow(
      ConfigError,
    );
  });

  it("refuses a mock price that is not a price, as the envelope would, but in its own words", () => {
    for (const value of ["0", "0.0", "-5"]) {
      expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_MOCK_PRICE_HBAR: value })).toThrow(
        /VITE_MOCK_PRICE_HBAR/,
      );
    }
  });

  it("requires a real topic on testnet, and carries nothing the mock needs", () => {
    expect(() => configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_CHAIN: "testnet" })).toThrow(
      /VITE_HANDOFF_ORDERS_TOPIC_ID/,
    );
    expect(
      configFromEnv({
        VITE_EXPERT_ACCOUNT_ID: expert,
        VITE_CHAIN: "testnet",
        VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242",
        VITE_MOCK_PRICE_HBAR: "1",
      }),
    ).toEqual({ mode: "testnet", expertAccountId: expert, ordersTopicId: "0.0.4242" });
  });
});

import { describe, expect, it } from "vitest";
import { ConfigError, configFromEnv } from "./config";

const expert = "0.0.12345";

describe("configFromEnv", () => {
  it("defaults to the mock and gives mock ids to what it cannot know yet", () => {
    expect(configFromEnv({})).toEqual({
      mode: "mock",
      expertAccountIdPrefill: null,
      accountsApiUrl: null,
      ordersTopicId: "MOCK-topic-orders",
      mock: { requesterAccountId: "MOCK-requester", priceHbar: "100" },
    });
  });

  it("takes the expert account as a prefill only, and only in account-id form", () => {
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: ` ${expert} ` }).expertAccountIdPrefill).toBe(expert);
    expect(configFromEnv({ VITE_EXPERT_ACCOUNT_ID: " " }).expertAccountIdPrefill).toBeNull();
    // An EVM alias is the same account, but it is not the id the SDK signs with.
    expect(() =>
      configFromEnv({ VITE_EXPERT_ACCOUNT_ID: "0x00000000000000000000000000000000000abcde" }),
    ).toThrow(ConfigError);
  });

  it("refuses to boot with a VITE_ variable whose name says secret, without reading it", () => {
    for (const name of [
      "VITE_PRIVATE_KEY",
      "VITE_EXPERT_SECRET",
      "VITE_MNEMONIC",
      "VITE_SEED_PHRASE",
      "VITE_operator_private",
      "VITE_SUPABASE_SERVICE_KEY",
      "VITE_SUPABASE_SERVICE_ROLE",
      "VITE_OPERATOR_ID",
      "VITE_SIGNING_KEY",
    ]) {
      let message = "";
      try {
        configFromEnv({ [name]: "302e0201003005" });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).toContain("bundled into the browser build");
      expect(message).not.toContain("302e");
    }
    // A public key for the content store is a legitimate VITE_ variable.
    expect(() => configFromEnv({ VITE_SUPABASE_ANON_KEY: "eyJ" })).not.toThrow();
    // Only VITE_ names are bundled; the rest never reach the browser.
    expect(() => configFromEnv({ OPERATOR_PRIVATE_KEY: "x" })).not.toThrow();
  });

  it("refuses a value shaped like a private key under any VITE_ name, without repeating it", () => {
    // A fabricated key: a pattern behind the ECDSA DER prefix, not a key to anything.
    const fixture = `3030020100300706052b8104000a04220420${"c7".repeat(32)}`;
    for (const value of [fixture, "c7".repeat(32), `0x${"c7".repeat(32)}`]) {
      let message = "";
      try {
        configFromEnv({ VITE_EXPERT_KEY: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("VITE_EXPERT_KEY holds what looks like a private key");
      expect(message).not.toContain("c7c7");
    }
    // Ids, topics and prices are not keys.
    expect(() =>
      configFromEnv({ VITE_EXPERT_ACCOUNT_ID: expert, VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242", VITE_MOCK_PRICE_HBAR: "100" }),
    ).not.toThrow();
  });

  it("refuses any mode that is not mock or testnet", () => {
    expect(() => configFromEnv({ VITE_CHAIN: "previewnet" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VITE_CHAIN: "" })).toThrow(ConfigError);
  });

  it("takes the mock price from the environment and refuses one that is not money", () => {
    const priced = configFromEnv({ VITE_MOCK_PRICE_HBAR: "150.5" });
    expect(priced.mode === "mock" && priced.mock.priceHbar).toBe("150.5");
    expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: "2e2" })).toThrow(ConfigError);
    expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: "0.123456789" })).toThrow(ConfigError);
  });

  it("refuses a mock price that is not a price, as the envelope would, but in its own words", () => {
    for (const value of ["0", "0.0", "-5"]) {
      expect(() => configFromEnv({ VITE_MOCK_PRICE_HBAR: value })).toThrow(/VITE_MOCK_PRICE_HBAR/);
    }
  });

  const testnet = {
    VITE_EXPERT_ACCOUNT_ID: expert,
    VITE_CHAIN: "testnet",
    VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242",
    VITE_CONTENT_URL: "https://content.example/store/",
    VITE_HANDOFF_ESCROW_ACCOUNT_ID: "0.0.999",
    VITE_HANDOFF_API_URL: "https://api.example",
  };

  it("requires the topic, the content URL and the escrow account on testnet, and carries nothing the mock needs", () => {
    expect(() => configFromEnv({ VITE_CHAIN: "testnet" })).toThrow(/VITE_HANDOFF_ORDERS_TOPIC_ID/);
    expect(() => configFromEnv({ VITE_CHAIN: "testnet", VITE_HANDOFF_ORDERS_TOPIC_ID: "0.0.4242" })).toThrow(/VITE_CONTENT_URL/);
    expect(() => configFromEnv({ ...testnet, VITE_HANDOFF_ESCROW_ACCOUNT_ID: "" })).toThrow(/VITE_HANDOFF_ESCROW_ACCOUNT_ID/);
    expect(configFromEnv({ ...testnet, VITE_MOCK_PRICE_HBAR: "1" })).toEqual({
      mode: "testnet",
      expertAccountIdPrefill: expert,
      accountsApiUrl: null,
      ordersTopicId: "0.0.4242",
      mirrorNodeUrl: "https://testnet.mirrornode.hedera.com/api/v1",
      contentUrl: "https://content.example/store",
      escrowAccountId: "0.0.999",
      apiUrl: "https://api.example",
    });
  });

  it("takes a mirror node from the environment, and refuses one that is not https or mentions mainnet", () => {
    const custom = configFromEnv({ ...testnet, VITE_HEDERA_MIRROR_NODE_URL: "https://mirror.example/api/v1/" });
    expect(custom.mode === "testnet" && custom.mirrorNodeUrl).toBe("https://mirror.example/api/v1");
    expect(() => configFromEnv({ ...testnet, VITE_HEDERA_MIRROR_NODE_URL: "https://mainnet-public.mirrornode.hedera.com/api/v1" })).toThrow(/mainnet/);
    expect(() => configFromEnv({ ...testnet, VITE_CONTENT_URL: "http://content.example" })).toThrow(/https/);
    expect(() => configFromEnv({ ...testnet, VITE_CONTENT_URL: "not a url" })).toThrow(/not a URL/);
  });

  it("takes an accounts API only when named, on either chain, and refuses one that mentions mainnet", () => {
    expect(configFromEnv({}).accountsApiUrl).toBeNull();
    expect(configFromEnv({ VITE_ACCOUNTS_API_URL: "http://localhost:8788/" }).accountsApiUrl).toBe("http://localhost:8788");
    expect(configFromEnv({ ...testnet, VITE_ACCOUNTS_API_URL: "https://accounts.example" }).accountsApiUrl).toBe("https://accounts.example");
    expect(() => configFromEnv({ VITE_ACCOUNTS_API_URL: "https://mainnet.example" })).toThrow(/mainnet/);
  });

  it("allows plain http for a content server on localhost, for development", () => {
    const dev = configFromEnv({ ...testnet, VITE_CONTENT_URL: "http://localhost:8787/content" });
    expect(dev.mode === "testnet" && dev.contentUrl).toBe("http://localhost:8787/content");
  });
});

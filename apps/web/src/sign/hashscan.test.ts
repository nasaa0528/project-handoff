import { describe, expect, it } from "vitest";
import { HASHSCAN_TESTNET_BASE, hashscanAccountUrl, hashscanTransactionUrl, isMockId } from "./hashscan";

describe("hashscan links", () => {
  it("links a real transaction id on testnet", () => {
    expect(hashscanTransactionUrl("0.0.12345@1757000000.000000000")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.12345@1757000000.000000000",
    );
  });

  it("links a real account on testnet", () => {
    expect(hashscanAccountUrl("0.0.12345")).toBe("https://hashscan.io/testnet/account/0.0.12345");
  });

  it("refuses to link a mock id, because mock ids 404 and must never be on camera", () => {
    expect(isMockId("MOCK-tx-1")).toBe(true);
    expect(hashscanTransactionUrl("MOCK-tx-1")).toBeNull();
    expect(hashscanAccountUrl("MOCK-escrow-ord_demo")).toBeNull();
  });

  it("has no other network", () => {
    expect(HASHSCAN_TESTNET_BASE).toContain("/testnet");
    expect(HASHSCAN_TESTNET_BASE).not.toContain("mainnet");
  });
});

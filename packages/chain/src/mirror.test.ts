import { describe, expect, it } from "vitest";
import { hashscanAccountUrl, hashscanScheduleUrl, hashscanTopicUrl, hashscanTransactionUrl, toMirrorTransactionId } from "./mirror.js";

describe("mirror + Hashscan link building", () => {
  it("converts SDK @ format to mirror/Hashscan dash format", () => {
    expect(toMirrorTransactionId("0.0.1234@1699000000.000000000")).toBe("0.0.1234-1699000000-000000000");
  });

  it("rejects an unrecognizable transaction ID", () => {
    expect(() => toMirrorTransactionId("not-a-tx-id")).toThrow();
    expect(() => toMirrorTransactionId("0.0.1234-1699000000-000000000")).toThrow();
  });

  it("builds testnet-only Hashscan links", () => {
    expect(hashscanTransactionUrl("0.0.1234@1699000000.000000000")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.1234-1699000000-000000000",
    );
    expect(hashscanAccountUrl("0.0.1234")).toBe("https://hashscan.io/testnet/account/0.0.1234");
    expect(hashscanTopicUrl("0.0.5678")).toBe("https://hashscan.io/testnet/topic/0.0.5678");
    expect(hashscanScheduleUrl("0.0.9012")).toBe("https://hashscan.io/testnet/schedule/0.0.9012");
  });
});

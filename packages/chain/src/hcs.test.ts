import { describe, expect, it } from "vitest";
import { assertWithinHcsMessageLimit, HCS_MESSAGE_MAX_BYTES, HcsMessageTooLargeError } from "./hcs.js";

describe("HCS message bounds", () => {
  it("accepts a small payload and returns its canonical form", () => {
    const canonical = assertWithinHcsMessageLimit({ b: 2, a: 1 });
    expect(canonical).toBe('{"a":1,"b":2}'); // sorted keys — canonical.ts, RFC 8785-ish
  });

  it("throws before letting a payload reach the auto-chunking size", () => {
    const oversized = { defects: Array.from({ length: 200 }, (_, i) => `defect-code-${i}`) };
    expect(() => assertWithinHcsMessageLimit(oversized)).toThrow(HcsMessageTooLargeError);
  });

  it("the limit matches the verified single-message ceiling, not the 6KB transaction ceiling", () => {
    expect(HCS_MESSAGE_MAX_BYTES).toBe(1024);
  });
});

describe("assertWithinHcsMessageLimit, what actually goes on the wire", () => {
  it("passes an already-encoded string through untouched, so readers get an object and not a quoted string", async () => {
    const { decodeEnvelope, encodeEnvelope, ReviewOrder, SCHEMA_VERSION } = await import("@handoff/schema");
    const envelope = ReviewOrder.parse({
      order_id: "ord_wire",
      class: "review",
      spec_hash: "a".repeat(64),
      artifact_hash_in: "b".repeat(64),
      cert_tag: "cpa-us",
      price_tinybars: "10000000000",
      deadline: "2026-09-14T00:00:00Z",
      claim_timeout_seconds: 1800,
      schema_version: SCHEMA_VERSION,
    });
    const body = encodeEnvelope(envelope);
    const wire = assertWithinHcsMessageLimit(body);
    expect(wire).toBe(body);
    expect(wire.startsWith("{")).toBe(true);
    expect(decodeEnvelope(wire)).toEqual(envelope);
  });

  it("still canonicalizes an object, which is what the probe scripts publish", () => {
    expect(assertWithinHcsMessageLimit({ probe: "orders" })).toBe('{"probe":"orders"}');
  });

  it("bounds a string by its bytes, not its characters", () => {
    expect(() => assertWithinHcsMessageLimit("é".repeat(HCS_MESSAGE_MAX_BYTES / 2 + 1))).toThrow(HcsMessageTooLargeError);
  });
});


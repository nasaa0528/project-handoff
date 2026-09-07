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

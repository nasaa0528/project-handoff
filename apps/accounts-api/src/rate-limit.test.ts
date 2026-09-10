import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

const rules = { "sign-in": { limit: 3, windowSeconds: 60 } };

class TestClock {
  #ms = 1_000_000;
  readonly now = (): number => this.#ms;
  advanceSeconds(seconds: number): void {
    this.#ms += seconds * 1000;
  }
}

describe("RateLimiter", () => {
  it("allows up to the limit and refuses after", () => {
    const limiter = new RateLimiter(rules, new TestClock().now);

    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(false);
  });

  it("reports seconds until the window resets, never zero when refusing", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(rules, clock.now);

    for (let i = 0; i < 3; i += 1) limiter.check("1.1.1.1", "sign-in");
    clock.advanceSeconds(59);

    const decision = limiter.check("1.1.1.1", "sign-in");
    expect(decision.allowed).toBe(false);
    // Retry-After must be at least 1: zero tells a client to retry immediately,
    // which is a loop.
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("counts refused requests too, so hammering does not earn a fresh window", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(rules, clock.now);

    for (let i = 0; i < 3; i += 1) limiter.check("1.1.1.1", "sign-in");
    // Refused, repeatedly, right up to the reset.
    for (let i = 0; i < 100; i += 1) expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(false);

    clock.advanceSeconds(61);
    // A new window, and only the limit again — not the limit plus the overflow.
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(false);
  });

  it("keeps clients apart", () => {
    const limiter = new RateLimiter(rules, new TestClock().now);
    for (let i = 0; i < 3; i += 1) limiter.check("1.1.1.1", "sign-in");

    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(false);
    expect(limiter.check("2.2.2.2", "sign-in").allowed).toBe(true);
  });

  it("keeps routes apart", () => {
    const limiter = new RateLimiter(
      { "sign-in": { limit: 1, windowSeconds: 60 }, register: { limit: 1, windowSeconds: 60 } },
      new TestClock().now,
    );

    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(true);
    expect(limiter.check("1.1.1.1", "sign-in").allowed).toBe(false);
    // Spending the sign-in budget must not close registration.
    expect(limiter.check("1.1.1.1", "register").allowed).toBe(true);
  });

  it("leaves a route with no rule unlimited", () => {
    // A limiter that quietly applied a default would throttle GET /health.
    const limiter = new RateLimiter(rules, new TestClock().now);
    for (let i = 0; i < 50; i += 1) {
      expect(limiter.check("1.1.1.1", "health").allowed).toBe(true);
    }
  });

  it("sweeps expired windows instead of growing without bound", () => {
    const clock = new TestClock();
    const limiter = new RateLimiter(rules, clock.now, 10);

    for (let i = 0; i < 10; i += 1) limiter.check(`10.0.0.${String(i)}`, "sign-in");
    expect(limiter.trackedWindows).toBe(10);

    // Every window is now stale, so the next arrival clears them rather than
    // letting one caller per address accumulate for the life of the process.
    clock.advanceSeconds(61);
    limiter.check("10.0.1.1", "sign-in");
    expect(limiter.trackedWindows).toBeLessThan(10);
  });

  it("does not forgive a limit that is currently doing its job", () => {
    // With the cap reached and every window live, exceeding the soft cap is the
    // right trade: dropping an entry would hand back an allowance.
    const limiter = new RateLimiter(rules, new TestClock().now, 3);

    for (let i = 0; i < 5; i += 1) limiter.check(`10.0.0.${String(i)}`, "sign-in");
    expect(limiter.trackedWindows).toBe(5);
    expect(limiter.check("10.0.0.0", "sign-in").allowed).toBe(true);
  });
});

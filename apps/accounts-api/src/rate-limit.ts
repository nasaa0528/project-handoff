/**
 * A fixed-window rate limiter, per client and per route.
 *
 * The email code is six digits and the sign-in endpoint takes a password. Both
 * are only as strong as the number of attempts allowed against them, and the
 * per-code attempt cap in `@handoff/accounts` does not stop someone registering,
 * abandoning, and registering again to get fresh codes. This is the other half.
 *
 * **In-process, so it is per-process.** Two instances behind a load balancer have
 * two independent budgets and the effective limit doubles. Said out loud here
 * rather than discovered later: for this build there is one process, and the
 * production answer is a shared counter in Redis or the proxy's own limiter.
 */

export interface RateLimitRule {
  /** How many requests are allowed inside one window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the window resets. Goes out as `Retry-After`. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAtMs: number;
}

/**
 * Budgets per route.
 *
 * Registration is the loosest of the three because a legitimate person may fumble
 * a form several times; sign-in and code confirmation are the ones an attacker
 * actually wants to repeat.
 */
export const DEFAULT_RULES: Readonly<Record<string, RateLimitRule>> = {
  register: { limit: 10, windowSeconds: 600 },
  "verification:request": { limit: 5, windowSeconds: 600 },
  "verification:confirm": { limit: 10, windowSeconds: 600 },
  "sign-in": { limit: 10, windowSeconds: 600 },
};

export class RateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #rules: Readonly<Record<string, RateLimitRule>>;
  readonly #now: () => number;

  /**
   * `maxKeys` bounds the map.
   *
   * Without it the limiter is itself a memory leak with a public trigger: every
   * distinct source address gets an entry, and nothing removes entries for
   * clients that never come back. Sweeping expired windows when the map grows
   * keeps it bounded without a timer.
   */
  constructor(
    rules: Readonly<Record<string, RateLimitRule>> = DEFAULT_RULES,
    now: () => number = () => Date.now(),
    private readonly maxKeys = 10_000,
  ) {
    this.#rules = rules;
    this.#now = now;
  }

  /**
   * Counts one request against `route` for `client` and says whether to serve it.
   *
   * A route with no rule is unlimited, deliberately: `GET /health` and profile
   * reads are not attack surface worth a counter, and a limiter that silently
   * applied a default to every new route would throttle things nobody meant to
   * throttle.
   */
  check(client: string, route: string): RateLimitDecision {
    const rule = this.#rules[route];
    if (rule === undefined) return { allowed: true, retryAfterSeconds: 0 };

    const nowMs = this.#now();
    const key = `${route}${client}`;
    const existing = this.#windows.get(key);

    if (existing === undefined || existing.resetAtMs <= nowMs) {
      if (this.#windows.size >= this.maxKeys) this.#sweep(nowMs);
      this.#windows.set(key, { count: 1, resetAtMs: nowMs + rule.windowSeconds * 1000 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));

    // Counted even when refused. Otherwise hammering the endpoint keeps the
    // count at the limit while the window rolls forward, and the caller gets a
    // fresh allowance the moment it expires.
    existing.count += 1;
    if (existing.count > rule.limit) {
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  #sweep(nowMs: number): void {
    for (const [key, window] of this.#windows) {
      if (window.resetAtMs <= nowMs) this.#windows.delete(key);
    }
    // Everything is still live and the cap is reached. Dropping the oldest is
    // wrong (it hands back an allowance), so the map is allowed to exceed the
    // soft cap rather than forgiving a limit that is currently doing its job.
  }

  /** Test-only view of how many windows are being tracked. */
  get trackedWindows(): number {
    return this.#windows.size;
  }
}

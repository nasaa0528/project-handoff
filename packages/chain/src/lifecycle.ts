/**
 * Pure state machine — no Hedera SDK calls, fully unit-testable without a testnet
 * connection. Transitions transcribed from CLAUDE.md's "Lifecycle" vocabulary entry.
 *
 * TODO(schema): `OrderState` belongs in @handoff/schema once its envelope/attestation
 * types land — this package defines it locally for now so it isn't blocked on that.
 */
export type OrderState = "POSTED" | "CLAIMED" | "DELIVERED" | "SETTLED" | "CLAIM_TIMEOUT" | "TIMEOUT" | "VIOLATION";

export type OrderEvent =
  | { type: "CLAIM"; claimant: string }
  | { type: "DELIVER"; attestationTxId: string }
  | { type: "SETTLE"; paymentTxId: string }
  | { type: "CLAIM_TIMEOUT_EXPIRE" }
  | { type: "REOPEN" }
  | { type: "ORDER_DEADLINE_EXPIRE" }
  | { type: "SCHEMA_VIOLATION"; reason: string };

export interface OrderContext {
  state: OrderState;
  /** Claim-timeout and order-deadline expiry are DIFFERENT events — never conflate the two timers. */
  reopenCount: number;
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: OrderState,
    public readonly event: OrderEvent["type"],
  ) {
    super(`Illegal lifecycle transition: ${event} from ${from}`);
    this.name = "IllegalTransitionError";
  }
}

const ALLOWED_EVENTS: Record<OrderState, ReadonlyArray<OrderEvent["type"]>> = {
  POSTED: ["CLAIM", "ORDER_DEADLINE_EXPIRE"],
  CLAIMED: ["DELIVER", "CLAIM_TIMEOUT_EXPIRE"],
  DELIVERED: ["SETTLE", "SCHEMA_VIOLATION"],
  SETTLED: [],
  CLAIM_TIMEOUT: ["REOPEN"],
  TIMEOUT: [],
  VIOLATION: [],
};

/**
 * Applies one event. Throws on anything not in the table above — in particular there
 * is no event representing a bare disagreement, so VIOLATION is reachable only via an
 * explicit SCHEMA_VIOLATION from DELIVERED (hard rule 4). REOPEN is legal only from
 * CLAIM_TIMEOUT, and only once per order — a second REOPEN throws even though the
 * table allows the transition, because `reopenCount` is checked explicitly.
 */
export function applyOrderEvent(ctx: OrderContext, event: OrderEvent): OrderContext {
  const allowed = ALLOWED_EVENTS[ctx.state];
  if (!allowed.includes(event.type)) {
    throw new IllegalTransitionError(ctx.state, event.type);
  }

  if (event.type === "REOPEN") {
    if (ctx.reopenCount >= 1) {
      throw new Error(`Order already re-opened once at claim-timeout; a second re-open is not allowed`);
    }
    return { state: "POSTED", reopenCount: ctx.reopenCount + 1 };
  }

  const nextState: OrderState = (() => {
    switch (event.type) {
      case "CLAIM":
        return "CLAIMED";
      case "DELIVER":
        return "DELIVERED";
      case "SETTLE":
        return "SETTLED";
      case "CLAIM_TIMEOUT_EXPIRE":
        return "CLAIM_TIMEOUT";
      case "ORDER_DEADLINE_EXPIRE":
        return "TIMEOUT";
      case "SCHEMA_VIOLATION":
        return "VIOLATION";
    }
  })();

  return { ...ctx, state: nextState };
}

export function newOrderContext(): OrderContext {
  return { state: "POSTED", reopenCount: 0 };
}

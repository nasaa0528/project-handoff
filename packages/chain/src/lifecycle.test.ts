import { describe, expect, it } from "vitest";
import { applyOrderEvent, IllegalTransitionError, newOrderContext } from "./lifecycle.js";

describe("lifecycle", () => {
  it("happy path: POSTED -> CLAIMED -> DELIVERED -> SETTLED", () => {
    let ctx = newOrderContext();
    expect(ctx.state).toBe("POSTED");

    ctx = applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1001" });
    expect(ctx.state).toBe("CLAIMED");

    ctx = applyOrderEvent(ctx, { type: "DELIVER", attestationTxId: "0.0.1@1" });
    expect(ctx.state).toBe("DELIVERED");

    ctx = applyOrderEvent(ctx, { type: "SETTLE", paymentTxId: "0.0.1@2" });
    expect(ctx.state).toBe("SETTLED");
  });

  it("SETTLED accepts no further events", () => {
    let ctx = newOrderContext();
    ctx = applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1001" });
    ctx = applyOrderEvent(ctx, { type: "DELIVER", attestationTxId: "0.0.1@1" });
    ctx = applyOrderEvent(ctx, { type: "SETTLE", paymentTxId: "0.0.1@2" });

    expect(() => applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1002" })).toThrow(IllegalTransitionError);
  });

  it("unclaimed order times out at deadline", () => {
    const ctx = applyOrderEvent(newOrderContext(), { type: "ORDER_DEADLINE_EXPIRE" });
    expect(ctx.state).toBe("TIMEOUT");
  });

  it("claim-timeout re-open goes back to POSTED, exactly once", () => {
    let ctx = newOrderContext();
    ctx = applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1001" });
    ctx = applyOrderEvent(ctx, { type: "CLAIM_TIMEOUT_EXPIRE" });
    expect(ctx.state).toBe("CLAIM_TIMEOUT");

    ctx = applyOrderEvent(ctx, { type: "REOPEN" });
    expect(ctx.state).toBe("POSTED");
    expect(ctx.reopenCount).toBe(1);

    ctx = applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1002" });
    ctx = applyOrderEvent(ctx, { type: "CLAIM_TIMEOUT_EXPIRE" });
    expect(() => applyOrderEvent(ctx, { type: "REOPEN" })).toThrow(/re-opened once/);
  });

  it("schema violation from DELIVERED is the only path to VIOLATION", () => {
    let ctx = newOrderContext();
    ctx = applyOrderEvent(ctx, { type: "CLAIM", claimant: "0.0.1001" });
    ctx = applyOrderEvent(ctx, { type: "DELIVER", attestationTxId: "0.0.1@1" });
    ctx = applyOrderEvent(ctx, { type: "SCHEMA_VIOLATION", reason: "missing artifact_hash_out for execution class" });
    expect(ctx.state).toBe("VIOLATION");
  });

  it("no event claws back directly from CLAIMED — must go through DELIVERED", () => {
    const ctx = applyOrderEvent(newOrderContext(), { type: "CLAIM", claimant: "0.0.1001" });
    expect(() => applyOrderEvent(ctx, { type: "SCHEMA_VIOLATION", reason: "no attestation yet" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("claim-timeout does not fire on a POSTED order — the two timers are independent", () => {
    const ctx = newOrderContext();
    expect(() => applyOrderEvent(ctx, { type: "CLAIM_TIMEOUT_EXPIRE" })).toThrow(IllegalTransitionError);
  });
});

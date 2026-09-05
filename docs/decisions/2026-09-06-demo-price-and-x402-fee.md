# The two prices, committed

**Decision.** The demo order price is **100 HBAR** (`10000000000` tinybars). The x402
per-call fee is **0.5 HBAR** (`50000000` tinybars). Both are committed once and never
changed on camera. Closes NAS-8 and open item 4 in the brief.

## Why 100 rather than the proposed 200

The faucet decides this, not taste. Measured limits: **100 HBAR per call, 100 HBAR per
rolling 24 hours** tied to a portal account, and **one funding per destination account per
24 hours**, a cooldown shared between the web faucet and the API.

So 200 HBAR is one person waiting two days, or two people pooling. That is an operational
dependency in front of a recording already scheduled for Sep 9, in exchange for a number
nobody reads literally. The brief already narrates the figure as a stablecoin-denominated
stand-in, so the HBAR amount was never carrying the credibility.

100 HBAR is exactly one faucet call by one person. If an account gets into a bad state, a
fresh one is funded the same day rather than two days later.

## Why 0.5 for the fee

A fee is legible on camera at half an HBAR and invisible at a thousandth. The ratio is
**1:200**, which makes the two money flows obvious in a transaction list without anyone
narrating the difference: the service fee is plainly a charge for a call, the order value
is plainly the product.

## The thing that is easy to get wrong

**The order value circulates; it is not consumed.** It moves requester → escrow → expert.
Between recording takes the expert account sends it back and the next take runs on the same
balance. Only gas is actually spent, and gas is sub-cent. We are funding the price once,
not once per take, which is what makes a 100 HBAR budget comfortable rather than tight.

## Consequences

- **Fund the requester account before Sep 9, not on the day.** The faucet's 24-hour
  cooldown means a mistake on the morning of a recording costs a day.
- **Each teammate funds from their own portal account.** Everybody has an independent 100
  HBAR daily allowance; queuing behind one person's allowance wastes three of them.
- The x402 receiver stays a **separate account from the escrow**, so the two flows are also
  separate on Hashscan and a judge can see it.
- Both figures live in the schema package's money module as tinybar strings. Nothing
  re-derives them from a float.

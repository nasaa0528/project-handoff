# apps/mcp — handoff_verify, and the x402 gate in front of it

**Owner: P2 Tseegii.** This lane carries the prize qualification requirement.

## What this app owns

- The `handoff_verify` MCP tool: an agent orders a review from any session.
- **The x402 payment gate in front of it.** This is the qualifying requirement and
  nothing substitutes for it.
- Order packaging, and the fund lock: building it at the 402, signing it client-side,
  and submitting the signed bytes.

## The gate, implemented from this

0. The body is parsed **before** the gate runs, because the 402 carries a fund lock and
   a lock needs a price, a requester and an order id. A malformed body is a 400, not a
   402, and an unknown cert tag is refused before a price is ever quoted.
1. Client calls the tool. Server answers **HTTP 402** with payment requirements, plus —
   in the JSON body, never the `PAYMENT-REQUIRED` header — an unsigned fund lock and the
   order id it was minted for. `accepts` is `@x402/core`'s shape and not ours to extend.
2. Client builds a Hedera `TransferTransaction`, partially signs with its own **ECDSA**
   key, and pays no gas.
3. Client retries with the base64 payload in the **`PAYMENT-SIGNATURE`** header.
   `X-PAYMENT` is the x402 version 1 name and appears in older documents; version 2 also
   moves the 402 challenge into a `PAYMENT-REQUIRED` header and returns the settlement
   receipt as `PAYMENT-RESPONSE`. Go through `@x402/core` and never hand-roll a header.
   Verified names and shapes: `../../docs/research/x402-blocky402-wire-verified.md`.
4. Server posts it to the facilitator's `/verify` and serves on success. The paid retry
   also carries `order_id` and `signed_fund_lock`; the server validates those bytes
   against what it asked for and submits them. **The escrow is funded by the requester's
   own signature — this app never holds their key.** See
   `../../docs/decisions/2026-09-08-requester-signs-the-fund-lock.md`.
5. Facilitator co-signs as designated fee payer and `/settle` submits it. Settlement is
   asynchronous and returns a Hedera receipt.

Facilitator is `https://api.testnet.blocky402.com`, network `hedera:testnet`. Never
`api.blocky402.com`, which is mainnet.

## Settling: POST /orders/:id/settle

The escrow release. Ungated — the gate covers order posting only — because it sells
nothing: it moves money the requester already locked, to the expert who already signed,
on facts that are already public.

Three rules decide whether money moves, and each has a file-level comment saying so:

- **Only the claimant's own attestation pays.** The attestations topic has no submit key.
  A stray attestation is noise, not a violation — it must not pay and must not shadow the
  holder's real one.
- **The verdict is never read.** A reject is a delivered product and gets paid. There is
  deliberately no `if (verdict === ...)` in `settle.ts`.
- **A violation is mechanical or it is not one.** Class mismatch, an artifact hash the
  order never named, the wrong credential tag. Never a disagreement about the work.

**Never turn this into a watcher.** `PendingPayoutStore` is in-memory, so a loop that
re-scans the attestations topic pays twice after any restart. The guarantee that survives
a restart is the payout memo on the mirror node, which is what makes a *retry* safe —
that is a reason to let a caller retry, not a reason to poll for them.

## What this app must never do

- **Never confuse the two money flows.** The x402 micropayment is the service fee for
  calling the tool. The order value is the price of the judgment and it goes to escrow.
  Different rails, different accounts, different sizes. Tool replies are a designed
  surface: use the copy blocks in `docs/design-system.md` so 0.5 HBAR and 100 HBAR
  cannot read as one payment.
- **Never reuse the escrow threshold key as the x402 receiver.** Separate accounts.
- **Never use USDC.** HBAR is native and needs no token association.
- **Never import the Hedera SDK.** Go through `@handoff/chain`.

## Reference

A complete working x402 flow, including a facilitator, lives on the
`templates/x402-pay-per-use` branch of `hedera-dev/scaffold-hbar`. Read
`../../docs/research/x402-reference-implementations.md` for the two adaptations we need,
then `../../docs/research/x402-blocky402-wire-verified.md` for the verified wire.

Its facilitator is **not** Blocky402 — it is a different program speaking the same
protocol — so take the plumbing and point at the hosted testnet facilitator. Settled in
`../../docs/decisions/2026-09-05-hosted-blocky402-not-the-scaffold-facilitator.md`.

Hedera Agent Kit is optional here, not required. If it competes with the gate for your
time, the gate wins.

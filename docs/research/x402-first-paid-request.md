# The first real paid x402 request, and the two things that nearly stopped it

Measured 2026-09-08 by running the MCP process against the hosted Blocky402 testnet
facilitator with the configured payer, and reading the result back off the mirror node.
Conclusions and gotchas only.

## It completed

`handoff_verify`, called over stdio by an MCP client, answered:

```
Service fee settled · 0.5 HBAR
Order posted · #ord_e227a57df9f2438ba1e2a6c661646f49
```

Transaction `0.0.7162784@1788872048.359217143`, `SUCCESS` on the mirror node:

```
0.0.10376659   −50000000   the payer
0.0.10376656   +50000000   the x402 receiver
0.0.7162784      −249217   the facilitator, paying the gas
```

**The payer paid no gas**, which is the whole point of the designated-fee-payer
arrangement, and it is visible in the transfer list rather than taken on faith.

The order leg was `MockChainAdapter` in that first run. It is not any more — see below.

## Then the whole money path, on testnet

Re-run at 21:22 with `HANDOFF_CHAIN=testnet`, the three topic ids from P1, a dev escrow
and a live Supabase project. **No mock ids.** Three transactions, all `SUCCESS` on the
mirror node:

| Leg | Transaction | Effect |
|---|---|---|
| Service fee | `0.0.7162784@1788873716.876972888` | `0.0.10376659` → `0.0.10376656`, 0.5 HBAR |
| Fund lock | `0.0.10376667@1788873717.947151972` | `0.0.10376667` → `0.0.10422187`, 100 HBAR |
| Envelope | `0.0.10376667@1788873720.134390016` | `CONSENSUSSUBMITMESSAGE`, topic `0.0.10421643`, seq 3 |

Read back off the topic, the envelope is hashes and nothing else:

```json
{"artifact_hash_in":"1259dbcf75e0…","cert_tag":"cpa-us","claim_timeout_seconds":1800,
 "class":"review","deadline":"2026-09-14T00:00:00Z","order_id":"ord_1a89aded…",
 "price_tinybars":"10000000000","schema_version":1,"spec_hash":"1903285c8141…"}
```

Keys in alphabetical order, so canonical serialization is doing its job, and neither the
spec text nor the artifact appears — hard rule 1, verified from the chain rather than
from the code that wrote it.

**Two of the four proof rows are now real**: the fee and the lock. The verdict and the
payout rows wait on an expert publishing an attestation to `0.0.10421645`.

**The escrow in that run was a dev account**, `0.0.10422187`, made by
`packages/chain/scripts/provision-dev-escrow.ts`. It decodes on chain as ThresholdKey
2-of-3 — the operator's ECDSA key in the requester slot, two ED25519 platform keys —
which is the real structure, but it is one laptop's escrow and not the shared one. Swap
in P1's account before recording.

## A raw private key has no curve, and the SDK guesses wrong

The first attempt refused to start a payer at all:

```
x402 payer unavailable: the x402 signer needs an ECDSA key, and this one is ED25519.
```

The account was right — `0.0.10376659` is `ECDSA_SECP256K1` on testnet with 1000 HBAR —
and the key was right. The key is stored **raw**: 64 hex characters, optionally `0x`
prefixed. `PrivateKey.fromString` reads raw hex as **ED25519**, so the key-type guard
was doing its job on a key that had already been parsed as the wrong curve.

`apps/web/src/session/keyShape.ts` states the same fact from the other side: DER carries
a curve prefix, raw does not, "so it is the adapter's to decide."

**Rule.** Never parse an x402 payer key with the generic `PrivateKey.fromString`. Raw
hex must go through `fromStringECDSA`, because the x402 scheme is secp256k1 and ECDSA is
the only reading that can be correct. DER names its own curve and is parsed as it
stands. Implemented in `packages/chain/src/compose.ts`.

**It was in two places, and the second one was worse.** `loadChainEnv` in
`packages/chain/src/config.ts` parsed the *operator* key the same way, and every testnet
operation in every lane goes through it — the cutover would have failed there for
everybody. The configured operator `0.0.10376667` is `ECDSA_SECP256K1`; its raw key
derives `037177c9e37d…` under `fromStringECDSA`, matching the account on chain, and
`78ffacd97393…` under the generic parser. Correct account, correct key, and
`INVALID_SIGNATURE` on everything.

This is the class of bug unit tests do not catch: every test built a `PrivateKey` object
directly, so no test ever exercised the string the environment actually holds. Both call
sites now choose the curve; `config.ts`, which had no tests at all, has five.

**Rule, stated once for the whole repo.** Never hand a raw hex key to
`PrivateKey.fromString`. Either the text is DER and names its curve, or somebody has to
decide — and a wrong decision surfaces as a signature error that names neither the key
nor the file.

## `/verify` can pass and `/settle` still fail

An earlier probe signed with a throwaway ECDSA key that did **not** control the payer
account. Blocky402's `/verify` returned valid, the resource was served and the order
posted; `/settle` then came back `transaction_failed`.

So Blocky402's verification does not fully bind the signature to the account. It is a
payload check, not a settlement rehearsal.

**Consequences, and none of them are a code change.** Our sequencing already survives
this: `/verify` gates serving, settlement happens last, and a failed settlement is
reported rather than hidden — the reply says `Service fee not settled · transaction_failed`
and the order still stands, which is the honest outcome for a service that was in fact
delivered.

What it does change is what anyone may **say**. "The facilitator verified the payment"
does not mean the payment will land. In the video and in front of a judge, the claim is
that the fee **settled**, evidenced by the transaction id and the mirror-node transfer
list — never that verification succeeded.

## Our own gate accepted our own payer

Worth recording because it was broken until this week. A payload built by `X402Signer`
now decodes in `apps/mcp/src/x402/gate.ts` and reaches the facilitator, which answers
with its own verdict. The earlier failure mode was a **local** rejection —
`payment header is not an exact-scheme x402 payload` — caused by this repository
expecting x402 version 1's top-level `scheme` and `network`. See
`x402-blocky402-wire-verified.md`, which was itself wrong about that shape and is now
corrected.

## The payer must be the operator, until the requester-signed lock ships

Measured 2026-09-09, running the stdio MCP process against a local resource server on
`HANDOFF_CHAIN=testnet`. Every teammate about to test `handoff_verify` from their own
machine hits this, and the error names none of it.

`lockFunds` debits `params.requesterAccountId` and signs with the adapter's client — the
server's operator (`packages/chain/src/escrow.ts`, `fundEscrow`). Since PR #27 the
requester account is the x402 payer, taken from the payment rather than from our env. So
whenever the payer and the operator are different accounts, the escrow transfer is
debited from an account that never signed it:

```
the order did not post: receipt for transaction 0.0.10376667@1788952250.864262800
contained error status INVALID_SIGNATURE
```

**Nothing was charged.** The order posts before settlement, so a lock that fails returns
502 and the fee is left unsettled — verified in `apps/mcp/src/server.ts`, which returns
without calling `settle` when `postReviewOrder` throws.

**Two shapes follow, and only one of them works today.**

- **One shared resource server, many payers: impossible on `main`.** A teammate pointing
  `HANDOFF_SERVICE_URL` at somebody else's server fails at the lock every time. This is
  what `buildFundLock`/`submitFundLock` exists to fix — the requester signs the transfer
  on their own machine — and porting `apps/mcp` to it is the open P2 task from
  `../decisions/2026-09-08-requester-signs-the-fund-lock.md`.
- **Each teammate runs their own resource server, with the payer equal to the operator:
  works.** Set `X402_PAYER_ACCOUNT_ID` = `HEDERA_ACCOUNT_ID` and `X402_PAYER_PRIVATE_KEY`
  = `HEDERA_PRIVATE_KEY`. The account must be **ECDSA** — the x402 signer refuses ED25519
  and the portal's default is ED25519.

Proved end to end under the second shape, all three on the mirror node:

| Leg | Transaction | Effect |
|---|---|---|
| Service fee | `0.0.7162784@1788952342.542783001` | `0.0.10376667` → `0.0.10376656`, 0.5 HBAR, facilitator paid the gas |
| Fund lock | `0.0.10376667@1788952343.193594087` | `0.0.10376667` → escrow `0.0.10422187`, 1 HBAR |
| Envelope | `0.0.10376667@1788952344.655781678` | topic `0.0.10421643`, seq 4, hashes only |

That escrow is still the **dev** account from `provision-dev-escrow.ts`, not P1's shared
one. Four laptops each holding a different `HANDOFF_ESCROW_ACCOUNT_ID` means four
escrows and an expert app reading orders it cannot be paid from: agree one id before
anyone tests.

## Two wiring bugs the unit tests could not see

Both were found by driving the real tool over a real transport rather than by reading it.

1. **`handoff_verify` posted no `requester_account_id` at all**, so every order came back
   `400 invalid order`. `main.ts` read the payer and `client.ts` sent the field, and the
   tool handler in between built its `postOrder` deps by hand and left it out. Each half
   was tested alone and both were green. `apps/mcp/src/mcp/server.test.ts` now drives the
   tool over an `InMemoryTransport` and reads the body that would go on the wire.
2. **An empty `HANDOFF_SERVICE_URL` is a set variable.** `.env.example` ships the key
   empty, and `main.ts` read it with `??`, so the default never fired and the base url
   became `""` — every call failing with `Failed to parse URL from /tags`, a message
   naming neither the variable nor the file. `config.ts` had always used `||`; the two
   halves had drifted apart under a comment claiming one variable moved both.

**Rule.** For any env var `.env.example` ships with an empty value, read it with `||`,
never `??`. `??` defends against unset; the file makes it set.

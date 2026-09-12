# packages/chain — the only Hedera SDK importer

**Owner: P1 Khishgee.** Everyone queues behind this lane.

## What this package owns

- The escrow account and its 2-of-3 threshold key.
- The early-execute payout path — **not** via `ScheduleCreate`/`ScheduleSign`/
  `ScheduleDelete` as of 2026-09-08; see the callout below.
- HCS topics: creation, message submission, and the submit-key decision per topic.
- Mirror-node reads for settlement state.
- The real `ChainAdapter`, implementing the same interface as `MockChainAdapter`.
- The **x402 payer signer**, `X402Signer`: builds the service-fee `TransferTransaction`
  and partially signs it with the requester's ECDSA key. Exported beside `ChainAdapter`,
  never inside it, so the treaty and the mock do not change. `@x402/hedera` is a
  dependency of this package only. Tseegii authors the file, Khishgee reviews it; the
  package owner does not change. See
  `../../docs/decisions/2026-09-07-x402-signer-lives-in-packages-chain.md`.

## What this package must never do

- **Never define the shapes.** Types, schemas, bounds and the adapter interface live in
  `@handoff/schema`. This package implements against them.
- **Never convert money.** Import from the money module.
- **Never swallow a transaction ID.** Every call returns one and it gets threaded
  through to the UI. Settlement state is read from a mirror node, never inferred from
  "we sent it."
- **Never touch mainnet.** Not an endpoint, not an account ID, not in a comment.
- Never let a platform key reach a browser build. This package is server-side only.
- **Never store a key.** `createTestnetAccount` hands its caller a freshly generated
  key and keeps nothing. Encrypting it is `packages/accounts`' job, under
  `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md`.

## `ScheduleCreate` does not work for this escrow — read before touching payout

**`ScheduleCreateTransaction` rejects any transaction that debits a `KeyList`
(threshold) account with `INVALID_SIGNATURE`** — verified on real testnet, 8
isolated runs, root cause not found even after a `hedera-docs` search. Full
writeup: `../../docs/research/schedule-create-keylist-blocker.md`. **Do not
re-introduce `ScheduleCreateTransaction`/`ScheduleSignTransaction` into
`HederaChainAdapter` without re-reading that file first** — `schedule.ts` still
contains that implementation, unused, kept only in case Hedera's team confirms a
fix or a missing construction detail later.

**What runs instead, as of 2026-09-08** (`pending-payout.ts` + `direct-payout.ts`,
decision: `../../docs/decisions/2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md`):
`createSchedule` tracks the payout's parameters locally, no chain call.
`signSchedule` builds one `TransferTransaction` debiting escrow and co-signs it with
**both** the verifier and schedule-admin keys in the same call, submitting it
directly — real money movement, verified end to end against testnet
(`scripts/live-happy-path.ts`). This works because both platform keys already live
in the same trusted process (Known limits) — Hedera's Schedule Service solves a
problem (signers acting at different times, different processes) we don't have.

Facts that still hold regardless of which mechanism executes the payout:

- **The payee must be known before payout can be built** — schedule (record) at
  claim, not at post. See `../../docs/research/hedera-primitives-verified.md`.
- **Topic submit keys differ by topic.** Orders and attestations have none, because
  experts submit from their own accounts. The registry has one.
- **Idempotency is still guaranteed, just locally now.** `derivePendingPayoutId`
  hashes the payout's params deterministically — identical params always resolve to
  the identical id, mirroring what `IDENTICAL_SCHEDULE_ALREADY_CREATED` gave us for
  free from the network. `signSchedule` on an already-executed payout returns
  success without re-submitting; never double-pay still holds.
- **New honest limitation:** pending-payout state is in-memory, per-process. A
  restart between `createSchedule` and `signSchedule` loses that bookkeeping.
  Fine for today's demo (one session, no restart); needs a durable backing store
  before it's more than that.

## The cutover

Mon Sep 7 night. P2 and P3 run against this adapter before check-in 1. Drive it.

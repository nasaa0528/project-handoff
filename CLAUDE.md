# Handoff — agent working agreement

**Agents do the work. A certified human stands behind it.**

On-chain protocol for buying human judgment. Funds lock up front, a credentialed human
signs an attestation, payment releases on the signature. Settled on Hedera. **Testnet
only, always.** Built for ETHOnline 2026 (event Sep 4–16 UB, submissions due Mon
Sep 14 12:00 AM UB, Hedera AI & Agentic Payments prize).

**Doc precedence.** `docs/project-brief-v2.md` is the source of truth for scope; where
this file disagrees with it, the brief wins and this file gets fixed.
`docs/decisions/` overrides both — it is where settled questions go, and a decision
there is not up for re-litigation. In anything public (README, video, slides) the
brief's **Known limits** section wins over every other document.

## Where things live

Three homes, chosen by who needs the information. Anything decided in chat, Gemini Notebook
or Drive gets written back into one of them or it does not exist.

| Home | What lives there |
|---|---|
| **This repo** | Everything an agent session needs to build correctly: the brief, schemas, per-lane CLAUDE.md files, decision log, architecture, MCP config |
| **Linear** | Everything a human needs to coordinate: the event calendar, check-in deadlines, issues, cycles, blockers, who is doing what. Agents may read and update it; agents never depend on it at build time |
| **Vault** | Operator key and Supabase service key. Nowhere else, ever |

Map of the repo docs:

| File | What it is |
|---|---|
| `docs/project-brief-v2.md` | Scope, lifecycle, attestation, x402 gate, known limits |
| `docs/project-brief-v1.md` | History only. Not authoritative |
| `docs/team-seats.md` | Who owns which seat, cross-cutting duties, collapse rules |
| `docs/operating-plan.md` | How the team works |
| `docs/decisions/` | One dated file per settled decision, README is the index |
| `docs/architecture.md` | Mermaid diagrams, kept current in the same PR as the change |
| `docs/links.md` | Every URL anyone needs |
| `docs/research/` | Conclusions and gotchas only, never documentation summaries |

The event calendar, check-in deadlines and the todo list live on the Linear board. They
are not in this repo and an agent never needs them to build.

## Hard rules — breaking one breaks the product

1. **Hashes only on-chain.** Task content, artifacts, and the expert's written notes
   never go on-chain. The notes go to the content store; only `notes_hash` is published.
2. **No secrets in the repo.** No keys, seeds, or operator IDs, ever. `.env` only,
   `.env.example` committed. Per-dev testnet accounts for development; the shared
   operator key is vault-only and touches shared infra only. gitleaks runs pre-commit
   and in CI. Never `--no-verify` on a commit that touches money-path code.
3. **Payment default is PAY, not refund.** A reject verdict is a delivered product and
   gets paid. The only clawback path is a mechanical, provable schema violation.
4. **Never slash on a single disagreement.** AMBIGUOUS penalizes nobody.
5. **Testnet only. No mainnet, ever.** No mainnet endpoints, no mainnet account IDs, not
   even in comments or examples.
6. **Commit small and often. This is an eligibility requirement, not hygiene.**
   ETHGlobal treats a repository that arrives as single commits without proper history as
   unqualified by default until proven otherwise, and names repo history as the evidence
   for building from scratch. One commit per package, per config concern, per meaningful
   step. Never force-push and never rewrite history. AI disclosure is **not** required by
   ETHGlobal; `AI-USAGE.md` is our own choice, one honest paragraph before submission.
   The `ai-usage/` session log stays as evidence that the work happened during the event.
   See `docs/research/ethglobal-rules-verified.md`.
7. **Demo artifacts are fabricated only** — never real contracts, filings, PII, or
   anything readable as a genuine professional opinion. Labeled FAKE on screen, and they
   live in `assets/`.

## Scope ladder — do not build past your tier

- **Tier 1 (build):** **x402 payment gate on `handoff_verify`** settled through the
  Blocky402 testnet facilitator, plus the demo requester agent completing one real paid
  request end to end — this is the prize qualification requirement and nothing
  substitutes for it; escrow + fund lock; scheduled payment + early execute; HCS
  envelopes; content store behind an adapter; lifecycle state machine; shared schema
  package with `MockChainAdapter`; `handoff_verify` MCP tool; expert web app (inbox →
  review → sign); attestation format; allowlist registry with on-HCS events and cert
  gating; mirror-node settlement reads with tx IDs threaded through.
- **Tier 2 (only after Tier 1 is green):** expert-side fleet pre-analysis; plain web
  requester form; second-opinion audit; reject-rate reputation signal; budget prompt.
- **Tier 3 (never build this week):** dispute jury and its UI; reject→RFQ fix market;
  a working `execution` demo path; redline class; custodial web2 wrap; fiat rails;
  World ID; any token; general MCP-to-MCP negotiation.

If a task would land in Tier 3, stop and say so rather than building it. Tier 3 items
exist as schema fields and slides, not code.

**No oracle work.** `execution` acceptance proofs need a trusted fetcher. Do not write
one this week — not a DNS lookup, not an HTTP 200 check.

## Vocabulary — use these words exactly

- **Class** is declared at order time and never changes. `review` returns a signed
  verdict. `execution` returns the outcome itself. The class describes what the expert
  returns, not what the requester sent.
- **Lifecycle:** `POSTED → CLAIMED → DELIVERED → SETTLED`, with three exits:
  `CLAIM_TIMEOUT` (idle claimant, delete that schedule, reopen once, fresh schedule for
  the new claimant), `TIMEOUT` (unclaimed at the order deadline, schedule expires, funds
  return), `VIOLATION` (mechanical schema failure, the only clawback).
- **Claim-timeout and order-deadline expiry are different events.** Never collapse them.
  Claim-timeout is short relative to the deadline so a lazy claimant cannot hold funds.
- **Consensus timestamp is the truth** for who won a claim. UIs may render optimistically
  but must handle losing the race when the mirror node confirms an earlier claim.
- **The expert's key signs the HCS message only.** It is never a schedule key. Payout is
  the platform verifier plus the schedule admin co-signing after validating the
  attestation.
- **Payout is an idempotent retry.** Never double-pay. If the service is down when the
  expert signs, the attestation stands on HCS and payment lands on recovery.
- **Two money flows, never conflated.** The **service fee** is the x402 micropayment to
  call `handoff_verify` and post an order. The **order value** is the price of the human
  judgment, held in escrow. Different rails, different accounts, different sizes. The
  service fee is what qualifies us for the prize; the order value is the product.

## The attestation — implement from this, not from memory

An HCS message submitted from the expert's own Hedera account. The account signature is
the attestation signature.

```
{ order_id, class, verdict, defects[], notes_hash,
  artifact_hash_in?, artifact_hash_out?,
  cert_tag, schema_version, prior_attestation_ref? }
```

- `review` sets `artifact_hash_in` only, never `artifact_hash_out`.
- `execution` sets `artifact_hash_out`, plus `artifact_hash_in` when an input existed.
- A missing or extra hash for the class is a schema violation. Model this as a
  discriminated union so the wrong shape cannot be constructed.
- HCS messages are size-limited, roughly 1KB practical and 6KiB hard. `defects[]` is a
  bounded array of short structured codes with enforced max items and max bytes per
  item. The bound lives in the schema package and both the UI and the verifier use it.
- Registry changes (add, remove, cert grant) are HCS messages on a registry topic, so
  gating is auditable.

## The x402 gate — implement from this, not from memory

**We speak x402 version 2.** Header names below are read out of the published
`@x402/core` bundle, not inferred. **Go through `@x402/core` and never hand-roll a
header** — the names are here so nobody debugs one that was never wrong.

1. Client calls `handoff_verify`. Server answers **HTTP 402**, stating the price in a
   **`PAYMENT-REQUIRED`** header, with the body as the version 1 fallback.
2. Client builds a Hedera `TransferTransaction`, partially signs with its own **ECDSA**
   key, and does not pay gas.
3. Client retries with the base64 payload in the **`PAYMENT-SIGNATURE`** header.
   `X-PAYMENT` is the version 1 name and appears in older documents.
4. Server posts it to the facilitator's `/verify`, and serves on success. **Verification
   gates serving and settlement happens last**, so an order that fails to post leaves the
   caller's money untouched.
5. Facilitator co-signs as designated fee payer and `/settle` submits it. The receipt
   reaches the client as **`PAYMENT-RESPONSE`**. Settlement is asynchronous.

Facilitator is `https://api.testnet.blocky402.com`, network id `hedera:testnet`. Never
`api.blocky402.com` — that is mainnet and hard rule 5 forbids it. **`extra.feePayer` is
discovered from `/supported` at startup, never hard-coded**, because a rotated account
fails verification silently.

Verified wire shapes and the measurements behind them:
`docs/research/x402-blocky402-wire-verified.md`.

Three things that will bite if ignored. The x402 signer must be an **ECDSA** account, so
check the key type rather than assuming the portal default. **Pay in HBAR, not USDC**,
because HBAR is native and USDC on testnet needs a token association on both accounts
first. The x402 receiver is a **separate account from the escrow**, never the escrow
threshold key.

## Engineering agreements

- TypeScript strict everywhere. No `any` and no `@ts-ignore` anywhere near money,
  verdicts, hashing, or key composition.
- **Money is never a float.** Tinybars as `bigint` internally, strings at every
  boundary. All tinybar, HBAR, and display conversion lives in one tested module in the
  schema package. Nothing else converts.
- Money-path code has unit tests: hashing, envelope validation, escrow key composition,
  tinybar conversion, class-hash rules, HCS size bounds.
- Every envelope and attestation carries `schema_version`. Breaking changes bump it and
  old versions stay parsable. Design additively.
- Every Hedera call surfaces its transaction ID. Thread it through, never swallow it.
  Settlement state is read from a mirror node, never inferred from "we sent it."
- Hashscan is a viewer, not a dependency. Apps read mirror nodes directly.
- Canonical serialization before hashing, so two implementations produce the same hash.
- Lockfile committed, `.nvmrc` pinned. Four laptops, one dependency truth.
- One CI workflow: typecheck, unit tests, gitleaks. If it is red, fix forward. Never
  push to `main` to dodge it.
- Lane branches, PR into `main`. Prefer boring and observable.
- UI is React, Tailwind and shadcn/ui. Screens get sketched as throwaway HTML artifacts,
  not in a design tool.

## Repo layout

One pnpm workspace. Libraries in `packages/`, deployables in `apps/`.

```
packages/schema     P4 Nasaa      types, envelopes, attestation, money, hashing, ChainAdapter + MockChainAdapter
packages/chain      P1 Khishgee   escrow, schedule + early-execute, HCS, mirror reads
packages/content    P1 Khishgee   Supabase adapter behind a storage interface
apps/web            P3 Jack       expert app: inbox, review workspace, sign
apps/mcp            P2 Tseegii    handoff_verify server
apps/requester      P2 Tseegii    demo requester session via Hedera Agent Kit
```

Two constraints that hold regardless of how anything else moves:

- **`packages/schema` is the treaty and the cutover seam.** It owns the zod schemas, the
  `schema_version` constant, the money module, canonical hashing, the `ChainAdapter`
  interface, and `MockChainAdapter`. The real Hedera adapter implements the same
  interface. **Nothing else in the repo imports the Hedera SDK directly.**
- **Platform keys never enter a workspace with a browser build.** The verifier key and
  the schedule-admin key live server-side only.

Each package and app carries a short CLAUDE.md naming what it owns, its contract with
the schema package, and what it must never do. Read yours before touching the lane.

`.mcp.json` is checked in with four remote servers. Cloning the repo is the whole
setup, apart from two one-time steps below.

| Server | What it is for |
|---|---|
| `hedera` | The official hosted Agent Kit, testnet. Builds transaction bytes; it never signs, never submits, and never sees a private key |
| `hedera-docs` | Hedera's own documentation search |
| `linear` | The board. Read and update issues; never depend on it at build time |
| `context7` | Live docs for everything that is not Hedera: Next.js, Tailwind, shadcn, Supabase, the MCP SDK, zod, vitest |

**Never recall a Hedera SDK call from memory.** Look it up through `hedera-docs` or
`context7` first. Hallucinated SDK calls are the failure mode the audits flagged, and
these two servers exist specifically to close it.

Two one-time steps after cloning:

1. Export your testnet account in your shell profile, not just `.env`, because
   `.mcp.json` expands from the environment: `export HEDERA_ACCOUNT_ID=0.0.xxxxxx`.
2. Run `/mcp` once and authenticate Linear.

Signing stays in `packages/chain`. The Hedera server hands back unsigned bytes on
purpose, so no agent session can move funds on its own.

## Seats

| Seat | Who | Owns |
|---|---|---|
| P1 | **Khishgee** | Escrow, schedule and early-execute, HCS, Supabase project, lifecycle, mirror and Hashscan threading. Everyone queues behind this seat |
| P2 | **Tseegii** | `handoff_verify` MCP tool **and its x402 gate**, the x402 client in the demo requester session, order packaging and the fund-lock call. Heaviest lane, and it carries the prize requirement |
| P3 | **Jack** | Expert web app: inbox, review workspace, verdict editor with `defects[]` bounds, sign action, lost-claim-race UX |
| P4 | **Nasaa** | Schema package and `MockChainAdapter`, attestation format, registry and gating, README, video, rubric, scope-cut authority |

Lane ownership by path, cross-cutting duties and the collapse rules are in
`docs/team-seats.md`. **Scope-cut authority is Nasaa's alone.** Nobody quietly builds
past the tier line.

**Hedera Agent Kit is optional, not required.** The prize page lists it under resources,
never under qualification requirements. It stays on the build path because it pairs
naturally with x402, but if it competes with the x402 gate for P2's time, the gate wins.

## Build order and the cutover

Everything queues behind `packages/schema`. It ships first, with `MockChainAdapter`, so
P2 and P3 can build from hour one against a mock that satisfies the same interface P1's
real adapter will.

**Mock to testnet cutover deadline: Mon Sep 7 night.** Khishgee drives it, all four
present. Tseegii and Jack run against the real adapter before the first check-in. After cutover the mock is a test fixture only and
never appears in a demo or a recording.

**Deadlines, Ulaanbaatar local:** check-in 1 Tue Sep 8 11:59 AM, check-in 2 Fri Sep 11
11:59 AM, submissions due **Mon Sep 14 12:00 AM**, judging round 1 asynchronous Mon Sep 14,
**judging round 2 live** Tue Sep 15. We freeze Sep 11 anyway and bank the slack as buffer,
not as scope.

**Recording rule:** the judged video shows real testnet transactions or is explicitly
labeled a simulation. It must show the paid x402 request executing, which is a stated
prize requirement, and it must run five minutes or less. Mock transaction IDs never appear on camera — they 404 on
Hashscan. Record a clean testnet run early in the week. The Sep 11 recording is the
polish pass, not the first attempt.

## Working rhythm

- Async by default, one fixed 15-minute sync a day. Agenda is always blockers, then
  interface changes, then cut decisions.
- **Interface changes are a PR to `packages/schema` first**, tagged `breaking`, and
  announced at the sync. That package is the treaty between four people; nothing else
  needs coordination overhead.
- **A decision lands in `docs/decisions/` within the hour**, one dated file, and the
  folder README index gets the line. If it is not there, it is not decided.
- Co-located time goes to the seams, not the lanes: the day-1 spike and schema birth,
  and the Monday-night cutover.
- Recordings and big assets go to shared Drive, not the repo.
- **Tool meta-rule:** if it needs more than 15 minutes of setup, or its absence does not
  block the demo, it is out.

## Honesty rules for anything public

These are said out loud before a judge asks. Do not let marketing copy contradict them.

- Certification is an allowlist this week. The issuers are not here and the scarcity is
  not here; the interface is. Never claim an attacker burns a scarce credential — it is
  a row we delete.
- Disputes are stubbed. A rubber-stamp attestation gets paid in this build. It is
  attributable forever on HCS, and m-of-n jury plus bonds is the production answer.
- The platform is trusted this week. The verifier key and the schedule-admin key are
  both ours, so payout liveness and schema adjudication are custodial. Two Node
  processes on one team are not two custodians.
- The `execution` class is schema and architecture, demoed as roadmap.
- Content availability is centralized behind one vendor. The on-chain hash is the
  commitment; parties keep their own copies.
- Protocol fee is zero this week.
- Incentive symmetry is a **production thesis, not a shipped claim**. Only pay-on-any-
  verdict ships. Never say the incentive system is closed, and keep the symmetry slogan
  out of the 90-second hook.

## Project tooling for sessions

Checked in, so cloning gets them. Nothing here restates a rule that is already above;
these carry the depth or the chore.

| What | Kind | For |
|---|---|---|
| `/decision` | command | Writes the dated file in `docs/decisions/` and the index line. The log rule dies to friction otherwise |
| `/scoped-commit` | command | Commits the tree as small related commits with the trailers. Granularity is an eligibility requirement, and agents batch by default |
| `hedera-primitives` | skill | Verified Hedera facts and the never-recall-from-memory rule. Loads when you touch the SDK, HCS, schedules, keys or mirror reads |
| `money-path` | skill | Invariants and the required tests for money, hashing and validation. Loads when you touch code where a bug costs real money |
| `rules-auditor` | agent | Audits a diff against the seven hard rules and the tier ladder. Run it before opening a PR |

Skills load themselves when relevant, so you do not need to invoke them. Run the auditor
as a subagent so the diff stays out of your session.

## Session protocol

- Read `docs/project-brief-v2.md` and your lane's CLAUDE.md before touching scope,
  wording, or the lifecycle. Skim `docs/decisions/` for anything already settled.
- Work on a lane branch, open a PR into `main`.
- Anything you settle goes into `docs/decisions/` before you move on.
- `ai-usage/<seat>.md` is appended automatically at session end. It is event-timeline
  evidence, not AI disclosure. Root `AI-USAGE.md` is one honest paragraph, written once
  before submission.
- If you hit an open decision below, ask rather than guess. Guessing on these costs a
  rebuild.

## Open decisions — ask, do not assume

- [ ] **ScheduleCreate with an unknown payee.** **The docs answer this: the inner
      transaction must be fully formed, so the payee must be known and schedule-at-claim
      wins.** See `docs/research/hedera-primitives-verified.md`. Khishgee's spike is now
      a short empirical confirmation rather than an open question, with Tseegii sitting
      in because it fixes the MCP calls. If Hedera requires a
      fully formed inner transfer, the fallback is: funds lock at `POSTED`, the schedule
      is created at claim time, and the post-to-claim window is protected by the
      threshold key alone. Decide by end of hour 1, then update the brief's lifecycle,
      `docs/architecture.md`, and the demo narration to match. Until this is settled, do
      not hard-code either shape.
- [ ] **Who presents at live judging round 2**, Tue Sep 15. Not in `team-seats.md` yet.
- [ ] **Does the x402 gate cover only order posting**, or reads as well?

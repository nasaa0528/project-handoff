# Handoff — Project Brief v2 (2026-09-05, post dashboard read)

> **Source of truth for ETHOnline 2026** (event Sep 4–16 UB, Hedera AI & Agentic
> Payments prize). Supersedes v1, which is kept for history.
>
> **v2 changes.** The ETHGlobal dashboard and the Hedera prize page were read on
> 2026-09-05 and three assumptions in v1 were wrong. The prize does **not** require
> Hedera Agent Kit; it requires a live **x402-gated service settled through the
> Blocky402 facilitator**, plus an agent that completes a real paid request end to end.
> `handoff_verify` becomes that service — see **The x402 service gate** below and
> `decisions/2026-09-05-x402-gates-handoff-verify.md`. The submission deadline is
> **Mon Sep 14, 12:00 AM UB**, not Sep 12 or 13. Judging round 2 is **live**, which v1
> did not plan for. The protocol fee is no longer zero, because the x402 call charge is
> the fee and it now does something. Open human items 1, 2, 3, 5 and 6 are closed.
>
> **Provenance of v1.** Three pre-hackathon drafts iterated on the idea before any code
> existed. This document is the content of that final pre-hackathon draft, dated
> 2026-09-04 after round-2 audits (grok-v2, gemini-v2, gpt-oss), adopted unchanged as
> **repo v1**. The audit triage itself is not carried into the repo; every conclusion
> that survived it is already in Known limits. Version numbers restart here, so from now on a bump
> means a change made during the build week. It wins on *scope* over the earlier
> `handoff-project-plan.md` and `two-track-scope.md`.
>
> **What the round-2 audits changed** (kept for context): corrected ScheduleSign
> mechanics (expert key is HCS-only); claim-timeout split from schedule expiry; Insight 3
> demoted to production thesis; platform-custody admission; HCS size limits on the
> attestation; class-specific hashes; mock→testnet cutover rule; recording rule; Agent
> Kit on the build path; fee = 0 this week; allowlist wording honesty; registry events
> on HCS.

## One-liner

**Agents do the work. A certified human stands behind it.**

Handoff is an on-chain protocol for buying human judgment and human capability — funds
locked up front, a credentialed identity on the other end, and a signed, permanent
attestation as the deliverable. Settled on Hedera: sub-cent fees, 3-second finality.
Testnet only, always.

## The problem

Agent fleets now produce most of the work — reports, filings, translations, code, whole
apps. Nobody accountable has looked at it, and nobody accountable does the risky last
step. The last mile of trust is human, and there is no protocol for ordering it,
pricing it, or proving it happened.

Real demand, unprompted (Facebook ad, Sep 2026): *"I've designed and coded my app (web
and mobile). I need someone to integrate the APIs and deploy."* That ad is our **demand
evidence** — this week ships the `review` class; the ad's `execution` class is schema +
labeled roadmap (see Known limits).

## Core insight 1 — modality-agnostic endpoints

The protocol does not care whether either end is a human, a human steering an agent, or
an autonomous fleet. **Agents are optional at both ends. Accountability is not.** What
is non-negotiable is what goes on-chain: the order, the locked funds, the credentialed
identity, and the signed attestation.

| Requester side | Expert side | Example |
|---|---|---|
| Fleet, automatic (via MCP) | Person + their own fleet | Report built in a coding session (fabricated demo artifact); expert's agents pre-analyze; the human signs |
| Person steering an agent | Person, no agent at all | The "fixer": knows the way around a bureaucracy, makes two calls, attests it's done |
| Person, plain web app | Fleet-as-a-service | Non-technical user orders from a form; expert has productized their agents |

## Core insight 2 — one rail, two deliverable classes, any input state

**The class defines what the expert returns, not what the requester sends.**

| Class | Expert returns | Attestation pins |
|---|---|---|
| `review` | Signed verdict (approve / approve-with-changes / reject) + structured notes | `artifact_hash_in` (the reviewed artifact) — no output hash |
| `execution` | The outcome itself, done in the expert's own environment | `artifact_hash_out` (+ `artifact_hash_in` when an input existed), plus schema-defined proof |

The input artifact is a separate, optional, completeness-agnostic field of the order:

| Input state | Class | Example |
|---|---|---|
| Nothing | `execution` | "Register the domain, set up the DNS" — from zero |
| Half-baked | `execution` | The Facebook ad — expert *finishes* it |
| Finished | `review` | The report — expert signs off |

Rules:
- Class is **declared at order time and never switched mid-order**. A `review` order
  never silently becomes an edit (redline delivery is a roadmap class).
- `execution` acceptance evidence is **schema-defined per order**. Examples like "URL
  returns 200" or "DNS record exists" are *illustrative only* — execution proofs need a
  trusted oracle (who fetches the DNS?). **Do not implement a fetcher this week.**
- Dual hashes make the two blobs identifiable forever; they do **not** decide "already
  broken vs expert broke it" — that stays semantic (jury territory, stubbed).
- **Access handover is out of protocol.** We do not escrow credentials. Protection =
  certification, bond, and attributable signature — noting bonds and disputes are
  stubbed this week (Known limits). Roadmap: scoped-credential escrow, and a signed
  hand-over receipt whose hash rides in the attestation.

## Core insight 3 — incentive symmetry (production thesis, NOT a this-week claim)

> Production thesis: pay-on-any-verdict removes the incentive to approve dishonestly;
> broadcast-the-fix removes the incentive to reject dishonestly. In the full protocol,
> the expert's only profitable strategy is being right.

**Only the first half ships this week.** Do not use the symmetry slogan in the
90-second hook, and never claim the incentive system is closed — Known limits
(rubber-stamp) is the honest weekly statement, and the two must never contradict on
camera. This section is README/theory and a roadmap slide, **not a build prompt** —
nobody implements "just one quote message."

- **Payment releases on the signed attestation, whatever the verdict** (Tier 1). You
  bought judgment, not approval — a reject is a delivered product. If payment depended
  on approval, every expert would shade toward approve (the audit-firm failure mode).
  The only clawback is a provable schema violation.
- **A reject doubles as an RFQ** (Tier 3 / roadmap). The reject attestation's defect
  list + input hash convert one-click into a new `execution` order broadcast to experts
  on the same cert tag; peers quote on-chain; the client sees the **median**; the
  accepted quote becomes a normal order. The market, not the rejector, prices the fix.
  Open game theory (Sybil quotes, collusion, fee-farming loops) is acknowledged, not
  solved.
- **Three backstops against reject-farming** (ship tiers marked):
  1. Rejector may bid on the fix but is **flagged as the rejector** (needs the RFQ
     market — Tier 3).
  2. **Reject-rate as reputation signal** feeding second-opinion audits (Tier 2).
  3. **The fix order is always optional** — the client can take the verdict and walk
     (Tier 1; this is the only backstop live in the demo).
- Schema cost now: `defects[]` + optional `prior_attestation_ref`. Two fields, the full
  market later.

## Stakeholders

1. **Requester** — person or agent (or both). Orders a review or an outcome, sees the
   price, locks the funds. Surface: `handoff_verify` MCP tool from any agent session
   (Claude Code, Cursor, desktop), or a plain web form calling the same API.
2. **Expert / provider** — a certified human. Sells *judgment and standing behind their
   signature* — never access-peddling or influence. Works bare-handed or with their own
   fleet. Claims gated by certification tags. Deliverable: signed attestation per class.
3. **Dispute jurors** — the same expert class, empaneled m-of-n on challenge, paid for
   the poll. (Hackathon: stub/architecture.)
4. **Certification issuers** — professional bodies, employers, World ID for personhood
   (personhood ≠ professional credential; distinct tag types in the registry).
   (Hackathon: allowlist stub behind the real issuer interface.)
5. **The protocol** — charges a **per-call service fee over x402** to post an order,
   settled on Hedera testnet through the Blocky402 facilitator. This replaces v1's
   fee = 0 position: the fee is no longer money sitting in an account doing nothing, it
   is the price of the gated service and it is the thing the agent pays for. Larger fee
   mechanics (dispute pool, bonds) stay roadmap. No new token, ever, pitched in HBAR
   terms.

## The order lifecycle (state machine)

```
POSTED        order envelope on HCS (spec + class + cert tag + price + deadline
              + acceptance schema + optional input artifact hash + schema_version)
              funds locked in escrow; scheduled payment created (PAY is the default)
CLAIMED       first valid claim from a certified account wins; CONSENSUS TIMESTAMP
              is the truth — UIs display optimistically but must handle "you lost
              the race" when the mirror confirms an earlier claim. Claimant gets a
              claim-timeout that is SHORT relative to the order deadline (a lazy
              claimant must not be able to hold funds hostage to the deadline)
DELIVERED     expert publishes the signed attestation on HCS. The expert's key
              signs the HCS message ONLY — it is NOT a schedule key. The escrow
              service validates the attestation against the order schema, then
              platform verifier + schedule-admin ScheduleSign → payment fires.
              The payout step is an IDEMPOTENT RETRY (never double-pay): if the
              service is down when the expert signs, the attestation stands on
              HCS and payment lands on recovery
SETTLED       payment executed; mirror-node confirmation in-app; Hashscan link
— CLAIM-TIMEOUT claimant idle past claim-timeout → ScheduleDelete the payment to
              that claimant → re-open ONCE → new claimant gets a FRESH schedule.
              (Claim-timeout and order-deadline expiry are DIFFERENT events.)
— TIMEOUT     unclaimed at order deadline → schedule expires unexecuted → funds
              return to requester
— VIOLATION   provable (mechanical) schema violation → ScheduleDelete — the only
              clawback path. The check script is open-source, so a false clawback
              is auditable; the expert keeps HCS proof; appeal = stubbed jury
```

**Escrow keys (2-of-3 threshold), assigned:** (1) requester session key, (2) platform
verifier key, (3) schedule-admin key. Early-execute = verifier + admin co-sign after
validating the expert's attestation; clawback = requester + platform after a mechanical
schema-fail. **Honest admission (also in Known limits): verifier and admin are both
operated by us this week — payout liveness and schema adjudication are trusted-platform.
A compromised backend has quorum.** Decentralizing the verifier is the production
roadmap; two Node processes on one team are not two custodians and we don't pretend
otherwise.

**Day-1 spike (P1, hour 1):** validate ScheduleCreate with payee unknown at post time —
Hedera's Schedule Service normally wants a fully formed inner transfer, so **expect the
fallback**: funds still lock into the escrow account at POSTED and the payee-less HCS
envelope still publishes; the schedule is created *at claim time* (payee known),
preserving pay-by-default from the moment of claim; the post→claim window is protected
by the threshold key alone (trusted-platform, admitted). If the fallback is the
architecture, the lifecycle above and the demo narration both say "committed at claim"
— decide by end of hour 1, not at 3am, and update this diagram to match reality.

## The attestation, byte-for-byte

An HCS message submitted **from the expert's own Hedera account** (the account
signature is the attestation signature — the expert's key never touches the schedule).
Payload:

```
{ order_id, class, verdict, defects[], notes_hash,
  artifact_hash_in?, artifact_hash_out?,
  cert_tag, schema_version, prior_attestation_ref? }
```

- **Class rule (implement from this line, not from guesses):** `review` sets
  `artifact_hash_in` only; `execution` sets `artifact_hash_out`, plus `_in` when an
  input artifact existed. A missing/extra hash is a schema violation, so this must be
  unambiguous.
- **HCS message size is limited (~1KB, 6KiB hard max).** `defects[]` is a bounded array
  of short structured codes (UI-enforced: max items, max bytes per item); the full
  written review lives in the content store and only `notes_hash` goes on-chain — the
  hash-only rule applies to the expert's notes exactly as it applies to the artifact.
- **Registry changes are HCS messages too** (add/remove/cert-grant on a registry
  topic), so gating is auditable. Key rotation/revocation is roadmap — a compromised
  expert key is identity theft until the registry row is removed (Known limits).
- Verdict + cert_tag + volume are public on a permanent topic: scrapeable metadata
  (an enterprise's reject rate is visible). Known limit; roadmap: hash-committed
  verdicts with reveal-to-parties.

## Money

- HBAR. Price derives from **liability and credential scarcity** (and for execution,
  the requester's stall cost) — not a labor rate. High prices are a feature: the
  signature carries the risk.
- Money is a string, never a float; tinybar/HBAR/display conversions live in ONE shared
  tested module in the schema package.
- **The two prices, committed 2026-09-06 and never changed on camera:** the order price
  is **100 HBAR** (`10000000000` tinybars) and the x402 per-call fee is **0.5 HBAR**
  (`50000000` tinybars). 100 rather than the proposed 200 because the faucet gives 100 per
  call and 100 per rolling 24 hours, so 200 would mean pooling two people or waiting two
  days ahead of a recording. The figure is narrated as a stablecoin-denominated stand-in,
  so the HBAR amount was never carrying the credibility. The 1:200 ratio makes the two
  money flows legible on camera without narration. See
  `decisions/2026-09-06-demo-price-and-x402-fee.md`.
- **Currency defense** (one line in the close, labeled roadmap): experts in
  weakening-currency economies settle in seconds into a globally liquid digital asset.
  Stablecoin rail + fiat off-ramps: roadmap, with per-rail rules and minimums.

## The x402 service gate

Two distinct money flows, and they must never be confused on camera or in code.

| Flow | What it is | Rail | Size |
|---|---|---|---|
| **Service fee** | The requester agent pays to call `handoff_verify` and post an order | x402 over HTTP, settled on `hedera:testnet` | Micropayment |
| **Order value** | The price of the human judgment being bought | Escrow account plus scheduled transfer | The demo price |

The service fee is what qualifies us for the prize. The order value is the product.

**The flow, implement from this:**

We speak **x402 version 2**. The header names below were read out of the published
`@x402/core` bundle rather than inferred, and the implementation goes through that
library rather than hand-rolling a header.

1. The requester agent calls the `handoff_verify` endpoint.
2. The resource server answers **HTTP 402**, stating the price in a **`PAYMENT-REQUIRED`**
   header, with the body carried as the version 1 fallback.
3. The client builds a Hedera `TransferTransaction` and partially signs it with its own
   ECDSA key. It does not pay gas.
4. The client retries the call with the base64-encoded payload in the
   **`PAYMENT-SIGNATURE`** header. `X-PAYMENT` is the version 1 name and appears in
   earlier drafts of this document.
5. The resource server posts it to the facilitator's `/verify`, and on success serves
   the resource, meaning the order is posted and funds lock as normal. Verification gates
   serving and settlement happens last, so an order that fails to post leaves the
   caller's money untouched.
6. The facilitator co-signs as the designated fee payer, covers gas, and submits via
   `/settle`. The receipt reaches the client as **`PAYMENT-RESPONSE`**. Settlement is
   asynchronous.

**Facilitator:** the hosted Blocky402 testnet facilitator at
`https://api.testnet.blocky402.com`, network identifier `hedera:testnet`, endpoints
`/verify` and `/settle`. Blocky402 mainnet is not available yet and we would not use it
if it were — hard rule 5 stands. The `extra.feePayer` account is discovered from
`/supported` at startup and never hard-coded, because a rotated account fails
verification silently. See `research/x402-blocky402-wire-verified.md`.

**Operational constraints that will bite if ignored:**

- The x402 signer must be an **ECDSA** account. Check the key type when creating testnet
  accounts on the portal; do not assume the default.
- **Pay in HBAR, not USDC.** HBAR is native and needs no token association. USDC on
  Hedera testnet requires an association on both the payer and the receiver account
  before any payment can flow, which is setup we do not need.
- The x402 gate is a **separate account** from the escrow. Never reuse the escrow
  threshold key as the x402 receiver.

## Web2 wrap — roadmap, not build scope

Blockchain is the backend, not the homework: custodial accounts, fiat off-ramps, nobody
excluded for not understanding wallets. **None of it is built this week** beyond the
expert web app itself; custodial key management is a weeks-scale project.

## Known limits (say them before the judges do — these win over any other doc)

- **Certification is an allowlist this week.** Say exactly: *issuers aren't here;
  scarcity isn't here; the interface is.* Do NOT claim an attacker "burns a scarce
  credential" — this week it's a row we delete.
- **Disputes are stubbed.** The rubber-stamp / auto-reject-bot attack (claim, sign a
  schema-valid garbage attestation, get paid) is real in the hackathon build. Honest
  answer: the attack is attributable forever on HCS; second-opinion audits (Tier 2)
  catch it probabilistically; m-of-n jury + bonds are the production answer,
  architecture shown. Never slash on a 1-1 disagreement; AMBIGUOUS penalizes nobody.
- **The platform is trusted this week** — for payout liveness (expert signed, our
  service must be awake for money to move) and for schema adjudication (false clawback
  is possible; auditable via the open-source check script + the expert's HCS proof).
  Verifier + admin keys are both ours: custodial, admitted, decentralization roadmap.
- **Execution class is schema + architecture**, demoed as roadmap; its proofs need an
  oracle story presented honestly as a trusted-verifier stub.
- **Content availability is centralized** (Supabase). Signed URLs are access control —
  they re-issue; the object persists — but the store itself is one vendor. Pinning /
  replication (IPFS) is roadmap. The on-chain hash is the commitment; parties keep
  their own copies.
- **Hashscan is a viewer, not a dependency** — attestations live on HCS, retrievable
  from any mirror node; the apps read mirror nodes directly.
- **Known limits win in public copy** over every other document, including this brief's
  own theory sections.

## Scope ladder (do not build past your tier)

- **Tier 1 (demo dies without):** **x402 payment gate on `handoff_verify`**, settled
  through the Blocky402 testnet facilitator, plus the demo requester agent completing at
  least one real paid request end to end — this is the prize qualification requirement
  and nothing else substitutes for it; escrow + fund-lock; scheduled pre-committed payment +
  early-execute (as specified above); HCS envelopes (hash-only, `class` +
  `schema_version` + `prior_attestation_ref`); content store (**Supabase behind an
  adapter** — P1 owns the project, service key vault-only, signed-URL TTL > claim-timeout
  + review time); lifecycle state machine; shared versioned schema package **shipping
  day 1 with `MockChainAdapter`**; `handoff_verify` MCP; expert web app (inbox → review
  → sign, `defects[]` bounds enforced); attestation format; allowlist registry (on-HCS
  events) + cert gating; mirror-node settlement reads + Hashscan links threaded.
- **Tier 2:** expert-side fleet pre-analysis (Run 2 — optional, cut first); plain-web
  requester form; second-opinion audit; reject-rate reputation signal; budget/approval
  prompt before an agent spends.
- **Tier 3 (stub/slide only, never build):** dispute m-of-n + UI; reject→RFQ fix
  market; `execution` demo path; redline class; custodial web2 wrap; fiat rails;
  token; general MCP↔MCP negotiation. **World ID is Tier 3 until the Sep 9 gate**, and
  Tier 2 only if that gate passes — see
  `decisions/2026-09-05-world-selfie-check-gated.md`.

## Demo arc

Run 1 (the hook, ~90s, **recorded**): agentic requester orders a `review` from a coding
session → funds lock on screen → human expert reviews and signs on camera → settlement
confirmed via **mirror-node query in the expert app** (Hashscan link as garnish — its
indexing lag can exceed the 90s). The demo expert is **staged**; claim-timeout is never
exercised on camera; all artifacts fabricated and labeled FAKE (hard rule 7).
Run 2 (Tier 2, optional): the expert's own fleet pre-analyzes before the human signs.
Close (labeled **roadmap**): modality matrix, `execution` class + the Facebook ad as
demand evidence, reject→RFQ market, one line of currency defense.

**The video must show the paid request executing.** That is a stated prize
qualification requirement, not a nice-to-have, and the cap is **five minutes**. The 90s
hook sits inside that budget with room to spare.

**Recording rules:** the judged recording shows **real testnet transactions or is
explicitly labeled simulation — mock tx IDs never appear in the video** (they 404 on
Hashscan). Record a clean testnet run EARLY in the week; the Sep 11 recording is the
polish pass, not the first attempt. Fallback for a flaky testnet on the 11th = the
earlier real-testnet recording, never `MockChainAdapter` output.

**Dates, confirmed from the dashboard on 2026-09-05, all Ulaanbaatar local:** check-in 1
Tue Sep 8 11:59 AM, check-in 2 Fri Sep 11 11:59 AM, **submissions due Mon Sep 14
12:00 AM** (midnight entering Monday, so end of Sunday the 13th), judging round 1
asynchronous Mon Sep 14 03:00 AM, **judging round 2 live** Tue Sep 15 12:00 AM, finale
Thu Sep 17. Round 1 is asynchronous, so **the video IS the submission** for it. Round 2
is live and needs a person able to present and answer questions.

**We freeze on Sep 11 anyway and bank the two spare days** as buffer for testnet
flakiness and for rehearsing the live round. Freezing early is the decision; the slack
is not scope.

## Team seats + day-1 sequence

| Seat | Owns |
|---|---|
| P1 Protocol/chain | Escrow, schedule + early-execute, HCS, Supabase project, lifecycle, mirror/Hashscan threading |
| P2 Requester integration | `handoff_verify` MCP **and its x402 payment gate**, the x402 client in the demo requester session, budget prompt (Tier 2 only). This seat carries the prize-qualifying work and is the heaviest lane in v2 |
| P3 Expert surface | Expert web app: inbox, review workspace, verdict editor with `defects[]` bounds, sign action |
| P4 Trust, registry & story | Schema package + `MockChainAdapter`, attestation format, registry + gating, README/video/rubric |

**Hedera Agent Kit is optional, not required.** The prize page lists it under resources,
never under qualification requirements. It stays on the build path because the reference
implementation pairs it with x402 naturally and it costs little, but if it competes with
the x402 gate for P2's time, **the x402 gate wins**. That is the requirement; Agent Kit
is not.

**Day 1, in order:** (0) `AI-USAGE.md` in the same commit as the first source file;
(1) P1 runs the ScheduleCreate spike against the pre-written fallback tree; (2) P4
ships the schema package + `MockChainAdapter` **first, pairing with P2 if needed — the
mock is tiny and everything queues behind it**; (3) CI action (`tsc --noEmit` + unit
tests on PR) + gitleaks hook with the first scaffolding; (4) P2/P3 build against the
mock from hour one; (5) **mock→testnet cutover deadline: Mon Sep 7 night — P2/P3 run
against P1's real adapter before Check-in #1 (Tue 11:59am)**; after cutover the mock is
a test fixture only.

## Hard rules (breaking these breaks the product)

1. Task/artifact content NEVER goes on-chain — hashes only (this includes the expert's
   notes: `notes_hash`, never the text).
2. Never commit keys, seeds, or operator IDs; `.env` only; rotate if leaked. Per-dev
   testnet accounts for development; the shared operator key (vault-only) touches only
   shared infra. gitleaks hook from day 1 (and no `--no-verify` on money-path commits).
3. Payment default is PAY, not refund.
4. Never slash on a single disagreement.
5. Testnet only. No mainnet, ever. This includes the x402 facilitator: Blocky402's
   hosted testnet endpoint only, never `api.blocky402.com`.
6. From Scratch: no project code before kick-off, and **commit small and often, which is
   an eligibility requirement rather than hygiene.** ETHGlobal treats repositories that
   arrive as single commits without proper history as unqualified by default until proven
   otherwise, and names repo history as the evidence. One commit per package, per config
   concern, per meaningful step; never force-push or rewrite history. AI disclosure is not
   required by ETHGlobal — `AI-USAGE.md` is our own choice, one honest paragraph before
   submission, and the per-seat log in `ai-usage/` is event-timeline evidence. See
   `research/ethglobal-rules-verified.md`.
7. **Demo artifacts are fabricated only** — never real contracts, filings, PII, or
   anything that could read as a real professional opinion; label them FAKE on screen.

## Engineering agreements

- TypeScript strict; no `any` and **no `@ts-ignore`** near money or verdicts.
  Money-path code (hashing, envelope validation, escrow key composition, tinybar
  conversion) has unit tests.
- Minimal CI: one GitHub Action, typecheck + unit tests on PR. If it's red, fix
  forward — never push to `main` to dodge it.
- Lockfiles committed + `.nvmrc` — four laptops, one dependency truth.
- Schema versioning: every envelope/attestation carries `schema_version`; breaking
  changes bump the version and old versions stay parsable (additive-first design).
- Every Hedera call surfaces its tx ID; thread it, never swallow it. Settlement state
  is read from mirror nodes, not from "we sent it."
- Lane branches → PR into `main`. Prefer boring and observable.

## Tooling

- **Git repo** = anything an agent session needs to build correctly. **Linear** =
  human coordination (issues, cycles on check-ins, decision log) via Linear MCP —
  agents never depend on Linear at build time. **Gemini Notebook** (one shared notebook) for
  human study; conclusions written back to the repo. **Telegram/Discord** + ETHGlobal
  Discord. **Vault** for the operator + Supabase service keys. Architecture diagrams are
  Mermaid in `architecture.md`, not a drawing tool. **OBS/Loom** recording. **Hashscan + mirror-node REST** bookmarked day 1.
- Skipped: shared SSH host, Notion, anything beyond the one CI action.

## Open human items

Closed on 2026-09-05 from the ETHGlobal dashboard and `team-seats.md`:

1. ~~Confirm all four teammates applied.~~ All four are on the project "HandOff".
2. ~~Names on the four seats.~~ In `team-seats.md`.
3. ~~Submission deadline.~~ **Mon Sep 14, 12:00 AM UB.**
5. ~~Video owner.~~ Nasaa.
6. ~~Agent Kit required?~~ No. **x402 through Blocky402 is required instead.**

7. ~~Someone presents at live judging round 2.~~ **Nasaa**, claimed 2026-09-05. v1
   assumed judging was asynchronous throughout and planned no rehearsal; that happens in
   the slack after the Sep 11 freeze.

Still open:

4. ~~Ratify the demo price point and the x402 per-call fee.~~ **Committed 2026-09-06:
   100 HBAR and 0.5 HBAR.**

Also closed on 2026-09-05: the ETHGlobal track is **Building from Scratch**, so the
Continuity prize is not available to us, and the public repo required by the prize is
`https://github.com/nasaa0528/project-handoff`, linked on the ETHGlobal project.

The event calendar and check-in deadlines live on the Linear board, not in this repo.

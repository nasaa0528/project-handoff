# Decision log

One decision per file, so four people never conflict on the same lines.

**Filename:** `YYYY-MM-DD-short-slug.md`, using the **Ulaanbaatar local date**, matching
how the brief and the event schedule talk about days.

**Body:** four short sections. Decision, Why, Consequences, and Supersedes when it
overturns something.

**Rule:** a decision lands here within the hour of being made. The point is to stop four
parallel agent sessions from re-litigating a settled question. If it is not in this
folder, it is not decided.

## Index

Newest last.

### 2026-09-05

- [Brief renumbered to repo v1](2026-09-05-brief-renumbered-to-v1.md)
- [pnpm workspace, packages and apps](2026-09-05-pnpm-workspace-packages-apps.md)
- [Decision log is a folder of dated files](2026-09-05-decision-log-as-folder.md)
- [Architecture diagrams in Mermaid](2026-09-05-architecture-in-mermaid.md)
- [MCP stack is three servers](2026-09-05-mcp-stack-three-servers.md)
- [AI usage logged per seat](2026-09-05-ai-usage-per-seat-logs.md)
- [Timeline lives in Linear, audit triage dropped](2026-09-05-timeline-lives-in-linear.md)
- [MCP servers, verified and checked in](2026-09-05-mcp-servers-checked-in.md) — supersedes the three-server decision above
- [x402 gates handoff_verify](2026-09-05-x402-gates-handoff-verify.md) — **changes Tier 1**
- [Confirmed schedule, and we freeze on Sep 11 anyway](2026-09-05-schedule-and-track.md)
- [Brief bumped to v2](2026-09-05-brief-v2.md)
- [No Gemini Notebook MCP server](2026-09-05-no-notebooklm-mcp.md)
- [Hard rule 6 reworded: commit granularity is the eligibility requirement](2026-09-05-hard-rule-6-reworded.md) — amends the AI usage decision above
- [World Selfie Check: option bought, build gated on x402](2026-09-05-world-selfie-check-gated.md) — amends the Tier 3 ladder
- [The hosted Blocky402 testnet facilitator, not the scaffold's](2026-09-05-hosted-blocky402-not-the-scaffold-facilitator.md)
- [The x402 gate covers order posting only](2026-09-05-gate-covers-order-posting-only.md) — closes the last open x402 question
- [The 402 lives in an HTTP resource server, and the MCP tool pays it](2026-09-05-402-lives-in-an-http-resource-server.md)

### 2026-09-06

- [The two prices, committed](2026-09-06-demo-price-and-x402-fee.md)
- [UX philosophy and design system for this week](2026-09-06-ux-philosophy-and-design-system.md)
- [UX fixes from the persona review and the Laws of UX](2026-09-06-ux-fixes-from-persona-and-laws.md) — amends the entry above

### 2026-09-07

- [Notes for the close: the content package owns the hash-verified read](2026-09-07-notes-read-lives-in-content-package.md) — moves NAS-39 part 2 into NAS-37
- [One shared escrow account this week, per-order escrow is roadmap](2026-09-07-one-shared-escrow-account-this-week.md) — closes the open question on NAS-14
- [The x402 payer signer lives in packages/chain, beside the ChainAdapter](2026-09-07-x402-signer-lives-in-packages-chain.md) — closes NAS-35, **unblocks the prize path**

### 2026-09-08

- [P1 signs off on @hiero-ledger/sdk 2.85.0](2026-09-08-p1-signs-off-on-hiero-sdk-2.85.0.md)
- [Requester copy claims no check that did not run; NAS-36 closes with its scope moved](2026-09-08-copy-claims-no-check-that-did-not-run.md) — amends the MCP replies in the design system; **its three open consequences closed out 2026-09-12**
- [Direct co-signed payout replaces ScheduleCreate for the KeyList escrow](2026-09-08-direct-cosigned-payout-replaces-schedulecreate.md) — **unblocks the live demo path**
- [Platform-key env names live in the app, chain exports a string-taking factory](2026-09-08-platform-key-env-names-live-in-the-app.md) — closes the layout-rule gap the cutover hit
- [Custody, email onboarding and non-Hedera wallets stay out](2026-09-08-custody-onboarding-and-wallets-stay-out.md) — three already ruled, one open question for **Nasaa**

### 2026-09-09

- [World Selfie Check: go, but after the Sep 11 freeze](2026-09-09-world-selfie-check-goes-ahead-post-freeze.md) — supersedes the Sep 5 gate, World ID is now Tier 2
- [The requester signs the fund lock; the platform stops funding the escrow](2026-09-08-requester-signs-the-fund-lock.md) — closes a gap the one-shared-escrow decision left open, **breaking change to `ChainAdapter`**
- [Content reads and writes are by-hash and unauthenticated](2026-09-09-content-reads-are-by-hash-and-unauthenticated.md) — unblocks the expert app's document, adds a clause to Known limits

### 2026-09-10

- [One hosted resource server, and a client published to npm](2026-09-10-one-hosted-resource-server-and-a-published-client.md) — supersedes the Sep 8 "nothing needs deploying" finding; ordering no longer needs a clone
- [Registration exists, keyed on the Hedera account id](2026-09-10-registration-keyed-on-the-hedera-account.md) — supersedes item 2 of the Sep 8 custody ruling, two open questions for **Nasaa**

### 2026-09-12

- [handoff_status reports CLAIMED, read off the orders topic with the treaty's resolveClaims](2026-09-12-handoff-status-reports-claimed.md) — retires the design system's "must not invent the middle state" note; **adds a state to `OrderStatus`**
- [Platform creates and stores the expert's key, encrypted with the password](2026-09-12-platform-creates-and-stores-expert-key.md) — scope exception by P4, overrides the custody clause in Sep 8 and Sep 10 decisions; **demo-scoped, expires after the event**
- [Settle is an explicit endpoint, not a watcher, and never-double-pay lives on the mirror node](2026-09-12-settle-is-an-explicit-endpoint-and-idempotency-lives-on-the-mirror.md) — closes the payer-equals-claimant gap the status decision left open; **the lifecycle reaches SETTLED**

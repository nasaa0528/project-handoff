# Handoff — Design system (hackathon)

> Mechanical implementation of `docs/ux-philosophy.md`.
> Stack: React, Tailwind, shadcn/ui. Sketch screens as throwaway HTML, then build.
> If a token fights clarity, delete the token.

This is a **five-day system**, not a brand book. Ship the expert app and the MCP copy.
Do not invent a component library beyond what shadcn already is.

## Surfaces this week

| Surface | Owner | Viewport |
|---|---|---|
| Expert web app | P3 Jack | **Desktop first (1280×800 recording).** Mobile functional, not redesigned. The workspace is a document + a verdict column. |
| `handoff_verify` replies | P2 Tseegii | Chat. Markdown blocks. Same words as the web app. |
| Requester web UI | — | **Out.** Tier 2. |
| Wallet / seed / key UI | — | **Out.** The attestation publishes under the expert’s account through the chain adapter; the platform holds that key for the staged expert this week (a stated known limit). Own-wallet signing is roadmap. |

English is the source of truth this week (judges). No i18n pass.

## Hierarchy of the screen

```
[ what happened ]     ← sentence, largest
[ the money ]         ← HBAR, labeled as fee or escrow
[ the proof ]         ← quiet: event + View on Hashscan
[ the action ]        ← one button
```

Nothing else competes with that stack.

---

## Color

Professional paper, not crypto neon. Warm neutrals so it looks chosen.

| Token | Light | Use |
|---|---|---|
| `--paper` | `#FAF7F2` | App background |
| `--ink` | `#1C1917` | Text, primary buttons |
| `--ink-muted` | `#57534E` | Secondary text, proof rows |
| `--line` | `#E7E5E4` | Rules, card edges |
| `--surface` | `#FFFFFF` | Cards on paper |
| `--proof` | `#1D4E89` | On-chain confirmation, Hashscan links, “recorded” |
| `--fee` | `#78716C` | Service fee — smaller, quieter than order value |
| `--escrow` | `#1C1917` | Order value — full ink, tabular figures |
| `--confirming` | `#A16207` | “Confirming” (mirror lag). Warning, not error |
| `--paid` | `#166534` | Paid / published success |
| `--reject` | `#9A3412` | Reject *stamp* (product). Not `--error` |
| `--error` | `#B91C1C` | Only real failures: could not submit, schema blocked |
| `--fake` | *neutral*: `--line` band, `--ink` text, dashed edge | FAKE banner on the artifact. Always on. **Deliberately no hue.** It is a label, not a state, and it must never share a family with `--reject` or `--error` — it sits on screen at the exact moment the Reject stamp appears. |

Dark mode is **not** the recording target. If Jack has slack: warm near-black
`#111110`, lift surfaces, keep `--proof` / `--paid` / `--reject` hues. Prefer
`prefers-color-scheme` over a toggle this week.

**Two money treatments (non-negotiable).**

- Service fee: `--fee`, label **“Service fee · to place this order”**, one decimal
  (0.5 HBAR), smaller type, **rendered as a labeled receipt line with its own hairline**
  so it reads as money-but-small, not as proof-row metadata that shares the same gray.
- Order value: `--escrow`, label **“Held for the work”** or **“Paid to the expert”**,
  integer (100 HBAR), larger type, tabular nums.

Never place them in identical chips side by side. Weight is the differentiator.

Semantic mapping (Tailwind / shadcn): map `--ink` to primary, `--paper` to background,
`--proof` to a custom `proof` color — do not use default shadcn `destructive` for
reject-as-verdict.

---

## Type

| Role | Face | Weight | Size |
|---|---|---|---|
| UI / body | Inter (shadcn default is fine) | 400 / 500 / 600 | 16px base |
| Screen title / status sentence | Inter | 600 | 24–30px |
| Money | Inter, `tabular-nums` | 600 | fee 14px, order 20–24px |
| Proof row | Inter | 400 | 13px, `--ink-muted` |
| Attestation stamp (“Published · attributable forever”) | **Source Serif 4** | 600 | 22–28px |

Source Serif 4 is the only extra font. It exists for the one magic moment. Do not use
it on buttons or the inbox.

Scale: 14 / 16 / 20 / 24 / 30. Line length in the notes field ≤ 65ch. Body never in
viewport units; rem only, respect system scaling.

---

## Space, shape, motion

- 4px base. Gap, not margin soup. Card padding 16–24px.
- Radius: buttons 6px, cards 10px, dialogs 16px. Nested child one step tighter.
- Shadow: one quiet elevation on cards (`0 1px 2px rgb(0 0 0 / 0.06)`). No glow.
- Motion: 150ms opacity/transform on status change. **No spinners that look broken.**
  Confirming is a labeled state with a still layout. `prefers-reduced-motion`: cut to
  instant.
- Icons: Lucide, 1.5px stroke, 20–24px, `currentColor`, one family. No extra icon pack.

---

## Copy dictionary

Use these strings. Do not improvise synonyms on camera.

| Internal | On screen |
|---|---|
| `POSTED` | Posted |
| `CLAIMED` | Claimed · yours to review |
| reviewing (local) | Under review |
| attestation submitted | Published · attributable forever |
| waiting on mirror | Confirming |
| `SETTLED` | Paid |
| `CLAIM_TIMEOUT` | Claim expired · back in the inbox |
| `TIMEOUT` | Deadline passed · funds returned |
| `VIOLATION` | Could not pay out · schema did not match |
| lost claim race | Someone else claimed this |
| x402 fee | Service fee · to place this order |
| escrow lock | 100 HBAR locked in escrow |
| payout | Paid · 100 HBAR |
| `cert_tag` | Required credential: {tag} |
| `notes_hash` | Notes fingerprint (one click) |
| `artifact_hash_in` | Committed fingerprint of the work |
| Hashscan | View on Hashscan |
| FAKE artifact | **FAKE — demo document, not a real opinion** |

Banned on default screens: tinybar, `schema_version`, `ScheduleSign`, threshold,
facilitator, ECDSA, `PAYMENT-SIGNATURE`, `MockChainAdapter`, “burn,” “slash,”
“dispute,” “gas,” raw 64-char hashes as the hero.

---

## Proof row (component)

Every on-chain event uses the same quiet pattern:

```
Funds locked · 100 HBAR · confirmed
View on Hashscan                    ← --proof link, new tab, testnet Hashscan
```

One click reveals the transaction id in a `<code>` of muted 12px, copyable.
Never a wall of hex. Four instances must exist in the demo:

| Beat | Event label |
|---|---|
| 2 | Service fee settled · 0.5 HBAR |
| 3 | Funds locked · 100 HBAR |
| 8 | Attestation published |
| 9 | Paid · 100 HBAR |

If any of the four is missing, that claim becomes faith. Hashscan URL uses testnet
only. Never a mainnet host.

---

## Expert screens (Jack)

One primary action. Build the exits even if they are not filmed.

### 1. Inbox

**Need:** “Here is paid work I am qualified for.”

- Row: what the work is (title), **100 HBAR** (escrow treatment), deadline in local
  time, cert tag as a plain pill (“Licensed reviewer”), status sentence.
- Empty: “No work right now.” Not an illustration essay.
- Action: open the order. Claim lives on the order, not as a bulk control.

### 2. Order / claim

**Need:** take it, or learn I lost.

- Same facts as the row, plus the artifact title.
- Primary: **Claim**.
- After optimistic claim: “Claimed · yours to review” + a calm claim clock.
- Lost race: replace the button with “Someone else claimed this.” No retry-as-error.
  No red.
- No “release claim” this week (Tier 2). A mis-claimed order returns to the inbox on
  claim-timeout; say so in the claim clock’s helper text.

### 3. Workspace (the one worth mocking)

**Need:** judge *this* document.

- Left: artifact. FAKE banner cannot scroll off.
- Right: notes (content store, not chain) + defects editor.
- Defects: remaining budget as they type (`N` items, `N` bytes — bounds from
  `@handoff/schema`, never invented). When over budget, block Sign with an instruction
  (“Shorten this defect code”), not a toast code.
- No Hashscan chrome here. The work is the document.

### 4. Verdict

**Need:** say what I think, knowing I will be paid anyway.

- Three equal choices: Approve · Approve with changes · Reject.
- **No “we recommend.”** A recommended verdict is a bias toward approve — the failure
  mode the product exists to avoid.
- On camera: **Reject** (or approve-with-changes). Bland approve hides pay-on-any-verdict.
- Reject uses `--reject` as a stamp, not `--error`. Helper line: “A reject is paid.
  You are delivering a judgment.”

### 5. Sign

**Need:** put my name on it, forever.

- One button: **Sign & publish**.
- Helper: “Your account publishes the verdict and a fingerprint of your notes.
  The notes themselves stay off-chain.”
- On press the same button becomes the one confirmation beat: **Publish forever? ·
  Confirm**. No modal — one deliberate second click, because this cannot be undone
  (ground rule 5). Claim never asks twice; Sign always asks once.
- Then the serif stamp: **Published · attributable forever** + proof row (beat 8).

### 6. Paid

**Need:** the money landed.

- Stay on the same screen. Status becomes **Confirming** (~6s), then **Paid · 100 HBAR**
  with proof row (beat 9). Layout must not jump.
- Do not show “Paid” until the mirror read succeeds.

### Unfilmed exits (must not look broken)

| Exit | Screen reads |
|---|---|
| Lost race | Someone else claimed this |
| Claim-timeout | Claim expired · this order is back in the inbox |
| Order deadline | Deadline passed · funds returned to the requester |
| Schema violation | Could not pay out · the attestation did not match the schema |

---

## MCP replies (Tseegii)

The agent’s UI is this copy. Keep it short enough to read on camera. Same dictionary.

**Beat 2 — payment required (prize beat)**

```
To post this order there is a service fee of 0.5 HBAR.
That fee is a charge to place the order, not the price of the review.
The review itself holds 100 HBAR in escrow until a certified reviewer signs.
```

After pay: proof row for the fee (0.5, `--fee` weight in text: call it small).

**Beat 3 — posted**

```
Order posted.
100 HBAR locked in escrow for the review.
```

Proof row for the lock. If both ids appear in one message, two labeled lines, fee
first and smaller, escrow second and heavier. Never “paid 100.5 HBAR.”

**Beats 4–9 — the wait (status reply, only if a status query exists)**

```
Posted · waiting for a certified reviewer.
```
then, once claimed:
```
Claimed by a certified reviewer · under review.
```
If the tool has no status query, the agent reports at close and this block is skipped.
Do not build a polling tool for it this week.

**Beat 10 — close**

```
Verdict: Reject
The reviewer was paid 100 HBAR. You bought a judgment, not an approval.
```

Proof row for settlement. Optional one-click: committed fingerprint of the work.

**Artifact hash.** Default copy is “your work, submitted.” Layer 1: “Committed
fingerprint” + short hash + Hashscan/topic if we have it. Do not lead with the hash.

**Wrapping level this week:** structured markdown in the tool result. Not a custom
rich card in the MCP client (unknown client chrome, extra P2 time). If the client
renders markdown well, that is enough.

---

## Accessibility (the amount we can actually ship)

- Contrast: ink on paper, proof blue on paper — check both.
- Sign / Claim targets ≥ 44px tall.
- Status is text, not color alone (reject stamp includes the word Reject).
- Focus ring visible; keyboard can Claim, tab through verdict, Sign.
- FAKE banner is text, not only a color bar.

WCAG 2.1 AA is the bar; do not spend the week on a full audit.

---

## Out of scope (do not “just add”)

- Requester SPA, onboarding carousel, wallet connect, seed phrase, gas UI
- Dark-mode marketing toggle, illustration system, custom logo animation
- Dispute, RFQ, second-opinion, budget prompt, session keys
- Recommended verdict, tooltip tours, “learn more about Hedera”
- Showing tinybars “in advanced mode” as a second layout — Layer 1 is a disclosure
  row, not a second app

## Check before a recording

- [ ] Four proof rows, four Hashscan links, testnet, real ids
- [ ] 0.5 and 100 cannot be misread as the same payment
- [ ] Status sentences, no enums
- [ ] FAKE visible on the artifact
- [ ] Reject (or approve-with-changes) on camera; Paid still follows
- [ ] Confirming appears; Paid waits for the mirror
- [ ] Lost-race copy exists even if unfilmed
- [ ] No mock adapter, no mainnet URL, no key material on screen

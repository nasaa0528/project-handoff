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
| attestation submitted | Published · signed by you, attributable forever |
| waiting on mirror | Confirming |
| payout delayed (~60s) | Published · payment pending |
| claim clock | Sign by 18:12 — a time, never a countdown |
| `SETTLED` | Paid |
| `CLAIM_TIMEOUT` | Claim expired · back in the inbox |
| `TIMEOUT` | Deadline passed · funds returned |
| `VIOLATION` | Could not pay out · failed the format check |
| lost claim race | Someone else claimed this |
| x402 fee | Service fee · to place this order |
| escrow lock | 100 HBAR locked in escrow |
| payout | Paid · 100 HBAR |
| `cert_tag` | Required credential: {tag} |
| `notes_hash` | Notes fingerprint (one click) |
| `artifact_hash_in` | Expert: “the exact document the requester committed to” · Requester: “fingerprint of the document you sent” |
| Hashscan | View on Hashscan |
| FAKE artifact | **FAKE — demo document, not a real opinion** |

Banned on default screens: tinybar, `schema_version`, `ScheduleSign`, threshold,
facilitator, ECDSA, `PAYMENT-SIGNATURE`, `MockChainAdapter`, “burn,” “slash,”
“dispute,” “gas,” raw 64-char hashes as the hero. Also banned, because a persona review
caught each one leaking: “attestation” (say *verdict published*), “consensus timestamp”
(say *the network’s clock decides*), “mirror node” (say *waiting for the network to
confirm*), “schema” (say *format check*), “bytes” (say *characters*), “fresh schedule.”

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
| 8 | Verdict published |
| 9 | Paid · 100 HBAR |

If any of the four is missing, that claim becomes faith. Hashscan URL uses testnet
only. Never a mainnet host.

---

## Expert screens (Jack)

One primary action. Build the exits even if they are not filmed.

### 1. Inbox

**Need:** “Here is paid work I am qualified for.”

- Row: what the work is (title), one line of what the requester is asking, **100 HBAR**
  (escrow treatment), **two clocks side by side** — “Open until 18:00” and “30 min to sign
  after you claim” — document length, cert tag as a plain pill (“Licensed reviewer”),
  status sentence. A reviewer decides on three facts: what it is, how big it is, how long
  they have. Give all three before Claim.
- **Only work the expert can take.** Orders claimed by someone else are hidden, with a
  muted count (“2 claimed by others”), because the inbox’s promise is work you can take.
- Empty: “No work right now.” Not an illustration essay.
- Action: open the order. Claim lives on the order, not as a bulk control.

### 2. Order / claim

**Need:** take it, or learn I lost.

- Same facts as the row, plus **“What the requester is asking”** — the task description
  from the content store (the envelope carries only `spec_hash`). The document itself
  opens after Claim; showing it to non-claimants would leak access-controlled content.
- Primary: **Claim**. It asks once; it is recoverable.
- **Claim is confirmed, not assumed.** After the click, status reads **Confirming** — the
  same labeled state as payout, a few seconds — then **Claimed · yours to review** or
  **Someone else claimed this**. The workspace opens only on a confirmed claim. This is
  what handling a lost race actually requires; a button swap on the previous screen is not
  it.
- The clock is a **time, never a countdown**: “Sign by 18:12”. Countdowns are
  trading-terminal energy. **The claim window never extends past the order deadline**; if
  the remaining window is too short to review, Claim is refused: “Too close to the
  deadline to review.”
- Lost race: replace the button with “Someone else claimed this.” No retry-as-error.
  No red.
- No “release claim” this week (Tier 2). Helper text under the clock: “Changed your mind?
  Do nothing — this returns to the inbox at 18:12. Your notes are kept.”

### 3. Workspace (the one worth mocking)

**Need:** judge *this* document.

- Left: artifact. FAKE banner cannot scroll off.
- Right column, top to bottom: **the brief** (“What the requester is asking”, carried in
  from the Claim screen — the expert judges against it and must never go back for it),
  **the clock** (“Sign by 18:12”), a **three-step mark** — Notes → Verdict → Sign — so the
  remaining stretch reads as short and unfinished work pulls to completion (Zeigarnik,
  Goal-Gradient), then notes (content store, not chain) and the defects editor.
- Defects: remaining budget as they type, shown in **characters, not bytes** (“2 of 8 ·
  35 characters left”). The bound comes from `@handoff/schema` and is never invented, but
  that sentence is a spec note, not UI — it does not appear on screen. Free text this
  week, uppercase convention stated in the placeholder (“e.g. NO_MONITORING”); a picklist
  per credential is roadmap. **Normalize, do not reject** (Postel): uppercase, trim,
  collapse spaces. Over budget blocks Sign with an instruction (“Shorten this defect
  code”), not a toast code.
- A **soft check, not a block**, when defects are listed and Approve is chosen: “You
  listed 2 defects and chose Approve — continue?”
- No Hashscan chrome here. The work is the document.

### 4. Verdict

**Need:** say what I think, knowing I will be paid anyway.

- Three equal choices: Approve · Approve with changes · Reject. **None preselected;
  Continue disabled until one is chosen.** A preselected verdict is a recommended verdict
  by another name.
- **No “we recommend.”** A recommended verdict is a bias toward approve — the failure
  mode the product exists to avoid. Hick’s Law would prefer fewer choices; equality
  outranks speed here, deliberately.
- On camera: **Reject** (or approve-with-changes). Bland approve hides pay-on-any-verdict.
- Reject uses `--reject` as a stamp, not `--error`. Helper line: “A reject is paid.
  You are delivering a judgment.”

### 5. Sign

**Need:** put my name on it, forever.

- **Signing as:** name or account, credential pill, on this screen and quietly in the
  header of every screen. This is the “put my name on it” moment; a screen with no name
  on it breaks its own frame.
- The last look is **structured, not prose**. People act, they do not read helper text
  (Paradox of the Active User), so what is public and what is private goes into the
  shape of the summary, in two chunks:
  - **Public forever, under your account:** the verdict; the defect codes, listed in full.
  - **Private:** your notes (a preview) and the document. *Delivered to the requester.*
  Fingerprints live one click down, never as the summary. Two unreadable hashes in place
  of the two things the expert can read is the wrong summary.
- The document fingerprint says what it does, not what it is: “This is the exact document
  the requester committed to. It cannot change after you sign.”
- One button: **Sign & publish**, full width at the natural end of the column (Fitts).
  On press it becomes the one confirmation beat: **Publish forever? · Confirm**. No modal
  — one deliberate second click, because this cannot be undone (ground rule 5). Claim
  never asks twice; Sign always asks once. **“Not yet” is small and set apart from
  Confirm**, never adjacent-and-equal, so a fast hand cannot hit the wrong one at the only
  permanent moment.
- A way back: “Change verdict” and “Back to the document” are always reachable from here.
- Then the serif stamp: **Published · signed by you, attributable forever** + proof row
  (beat 8). Receipt first, permanence second: it is the expert’s receipt and the camera’s
  line at once.

### 6. Paid

**Need:** the money landed.

- Stay on the same screen. Status becomes **Confirming** (~6s), then **Paid · 100 HBAR
  to your account 0.0.xxxx** with proof row (beat 9). A receipt names the payee. Layout
  must not jump; reserve the proof row’s space before it exists.
- Do not show “Paid” until the mirror read succeeds. Doherty wants feedback within
  400ms; Confirming *is* that feedback. The result waits for the truth.
- **If the mirror has not confirmed after ~60s:** never an endless pulse. Status becomes
  **Published · payment pending** — “Your verdict is recorded. Payment lands when the
  service recovers.” The attestation stands on-chain; payout is an idempotent retry.

### Unfilmed exits (must not look broken)

| Exit | Screen reads |
|---|---|
| Lost race | Someone else claimed this |
| Claim-timeout | Claim expired · this order is back in the inbox. Your notes are kept — claim it again if nobody else does |
| Order deadline | Deadline passed · funds returned to the requester |
| Payout delayed | Published · payment pending. Your verdict is recorded; payment lands when the service recovers |
| Schema violation | Could not pay out · your verdict was published but failed the format check, which should have been caught before signing. Contact us |

The violation copy carries a next step and correct blame. Without a recourse line it is
the screen that ends the relationship. The workspace prevents it upstream by refusing an
over-budget defect, so it should be nearly unreachable.

---

## MCP replies (Tseegii)

The agent’s UI is this copy. Keep it short enough to read on camera. Same dictionary.

**Beat 1 — the ask.** The agent declares the credential tag, the task, the price and the
deadline. **The tag is the routing.** There is no broadcast: the order sits on the public
topic and only certified inboxes holding that tag see it. Enumerate the available tags in
the tool description so the agent picks from a list, and reject an unknown tag at post
time — the wrong tag must be impossible, not merely discouraged. State consent once, in
the tool description: “Your agent pays the service fee and locks the order value
automatically from the configured account.”

**Beat 2 — payment required (prize beat)**

```
To post this order there is a service fee of 0.5 HBAR.
That fee is a charge to place the order, not the price of the review.
The review itself holds 100 HBAR in escrow until a certified reviewer signs.
```

After pay: **proof row for the fee** — “Service fee settled · 0.5 HBAR” — one of the four
required rows.

**Beat 2 — the failures a first-timer hits first.** Each ends “Nothing was charged.” The
tag failure happens before the fee settles; verify-before-settle guarantees it.

```
Your account 0.0.x uses an ED25519 key. The service fee needs an ECDSA account. Nothing was charged.
Your account holds 42 HBAR. Posting needs 0.5 HBAR for the fee plus 100 HBAR for escrow. Nothing was charged.
No reviewer holds the credential “X”. Available: Licensed reviewer. Nothing was charged.
```

**Beat 3 — posted**

```
Order posted · #{order_id}
100 HBAR locked in escrow for the review.
It pays the reviewer when they sign, whatever the verdict. If nobody claims it by 18:00, it returns to you.
Visible to reviewers holding: Licensed reviewer. Cannot be cancelled once posted.
```

“Locked” without “what unlocks it” reads as gone; the refund condition is the trust
anchor. Proof row for the lock. If both ids appear in one message, two labeled lines, fee
first and smaller, escrow second and heavier. Never “paid 100.5 HBAR.”

**Beats 4–9 — the wait.** A read-only `handoff_status(order_id)` **ships**. MCP is
request/response and nothing pushes, so without it the close never reaches a requester
who shut the laptop and the flow ends at beat 3. It is a query, not a polling tool, and
reads are ungated. An open loop with no way to close it is exactly what makes people poke
the agent (Zeigarnik).

```
Posted · waiting for a certified reviewer. Open until 18:00.
```
then, once claimed:
```
Claimed by a certified reviewer (account 0.0.x) · under review · sign by 18:12.
```

**Beat 10 — close.** The reasons come first, the money second, the slogan last where it
has earned its place. Without the reasons, “you bought a judgment” reads as “no refunds”
at the exact moment the requester is least receptive.

```
Verdict: Reject
Defects: NO_MONITORING, TOKEN_ROTATION_UNDOC
Reviewer’s notes: [inline text from the content store]
Signed by a Licensed reviewer, account 0.0.x · Published forever
The 100 HBAR held in escrow was paid to the reviewer. A reject is a delivered judgment.
```

“The 100 HBAR held in escrow was paid” — never “was paid 100 HBAR” — or the close reads as
a second 100 leaving. Proof row for settlement.

**The deliverable reaches the requester.** Defect codes are public on-chain and go inline.
Notes live in the content store and are delivered inline in the close, with a signed link
as the fallback if too long. If notes cannot be delivered this week, say so in one line
rather than omitting them silently. The expert is paid for a judgment; the requester must
receive it.

**Artifact hash.** Default copy is “your work, submitted.” Layer 1: “Fingerprint of the
document you sent” + short hash. Do not lead with it; it is a hash of their own document,
the one thing they already have.

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
- [ ] No verdict preselected; Continue disabled until chosen
- [ ] Sign summary shows the real defect codes and a name, never two hashes
- [ ] Beat 10 carries the defect codes and the notes, not one word
- [ ] Clocks are times (“Sign by 18:12”), never countdowns
- [ ] No mock adapter, no mainnet URL, no key material on screen

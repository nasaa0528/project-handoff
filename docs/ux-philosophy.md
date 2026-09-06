# Handoff — UX philosophy

> For ETHOnline 2026. Scope is the brief; this file is how the product *feels*.
> Tokens and screen recipes live in `docs/design-system.md`.
> Settled in `docs/decisions/2026-09-06-ux-philosophy-and-design-system.md`.

**One-liner.** The interface delivers the thing the user bought — a signed human
judgment, with proof it happened — and hides everything else until they ask.

## Who it is for this week

Three people sit in the room. Design for all three, because the demo is the product.

| Who | Surface this week | What they are here to get |
|---|---|---|
| **Requester** | MCP tool replies in chat (Claude Code / Desktop). No web page. | A licensed human looked at *this* work. Here is the verdict. Here is the proof. You paid a small fee to post, and 100 HBAR was held for the work. |
| **Expert** | `apps/web`, staged on camera. Most of the runtime. | Paid work I am certified for. I claimed it. I judged it. I signed my name. I got paid — including if I rejected. |
| **Hackathon judge** (silent third) | Watching both surfaces, five minutes max | The paid x402 request executing. Two money flows that are obviously different. Four real transaction ids that open on Hashscan. |

The requester web form is **Tier 2**: coverage for a human with no agent, not a second
version of the MCP tool. Do not build it this week. Custodial “smooth wallet” wrap is
**Tier 3**. Do not build it this week.

**Naming.** In this product a *juror* is the dispute role — Tier 3, stubbed. The silent
third here is the hackathon judge. Never use “Judge” for both; the collision costs clarity.

The demo expert arrives already certified and configured. Onboarding is roadmap: no
signup, no key setup, no wallet picker on camera.

## What each user must walk away with

If a screen does not advance one of these, it is noise.

**Requester**

1. The order was posted.
2. Two different payments happened: **0.5 HBAR to place the order**, **100 HBAR locked
   for the judgment**.
3. The verdict (approve / approve-with-changes / reject) — the product.
4. Settlement happened; the expert was paid even on reject.
5. A way to verify, not a lecture: a Hashscan link, not a hex dump.

**Expert**

1. This is work I am allowed to take (cert tag, price, deadline).
2. It is mine to review — or it is not, and that is ordinary.
3. The artifact, labeled FAKE, is the thing I am judging.
4. I can form a bounded, structured verdict.
5. Signing publishes *my* account’s attestation forever. Notes stay off-chain; only
   their hash is public.
6. Payment landed, confirmed by a mirror-node read, not by hope.

**Nobody this week needs** a seed phrase, a tinybar, a state-machine enum, a dispute
button, or a second expert filmed losing a race. Those either live one click down, or
they live in the roadmap.

## How it should feel (priority order)

1. **Confidence, not vertigo.** A professional service, not a trading terminal. Calm
   paper, one action, no dashboard chrome.
2. **This is real and permanent.** A signed attestation has weight. Surface it as
   gravity (“Published · attributable forever”), not as a hash.
3. **A human stands behind this.** The expert is signing their name to their work.
   The sign button is the product, not a submit.
4. **Never punished for the machine’s pace.** Mirror lag is “Confirming.” A lost claim
   race is an ordinary outcome. Neither is a red error.
5. **Nothing to learn.** Every screen borrows a frame the user already knows — email,
   a calendar invite, a document beside comments, a form, DocuSign, a receipt. See
   *Familiar frames* below. If a screen needs explaining, it is the wrong frame.

The SiteLab hierarchy still holds, and it is strict:

**Clarity > efficiency > consistency > beauty.**

If a serif stamp on “Paid” looks nicer but hides which 100 HBAR moved, cut the stamp.

## The one product principle

**Show the proof. Wrap the plumbing.**

The job lives on-chain. Hiding the lock, the attestation, or the settlement throws away
the pitch. Wrapping means: no keys on the default route, amounts in HBAR, status in
plain words, transaction id present but quiet — a human event plus “View on Hashscan.”

Per screen: *show that it happened on-chain, hide how the chain works.*

## Progressive disclosure — one app with depth

Not two products (“simple mode” / “pro mode”). One surface, layers. Onboarding (later)
picks the default; the user can always drop down.

| Layer | What they see | This week |
|---|---|---|
| **0 — Default** | Outcome language. “Order posted. 100 HBAR locked in escrow.” “Sign & publish.” Money in HBAR. | **Ship this.** |
| **1 — One click** | Order id, transaction id, Hashscan, artifact fingerprint (short hash), cert tag. Raw truth, still labeled. | **Ship this** on the four proof points. |
| **2 — Escape hatch** | Own keys, custom parameters, raw envelopes. | **Partly real this week.** The attestation publishes under the expert’s own account, but through the chain adapter, whose signing key the platform holds for the staged expert. That is the “platform is trusted this week” known limit, and it is said on camera. Do not add a seed-phrase screen, key paste, or wallet picker. |
| **3 — Smooth default (roadmap)** | Embedded wallet / passkey so a non-crypto expert never sees a key. Still their key, not ours. | **Tier 3.** Philosophy now, code later. |

**Inversion for the hackathon.** The power-user layer is what is real this week. The
custodial-feeling wrapper is the unfinished top. That is an honest story: we expose
crypto because that is what ships; we do not fake a bank.

## Ground rules (checkable)

1. **One primary action per screen.** Inbox: Claim. Workspace: Sign & publish. Never
   Claim + Sign + Dispute on the same view.
2. **Plain language by default; raw truth one click, never zero, never more than one.**
3. **Money in human units, always.** Conversion lives in `@handoff/schema`. The UI
   never formats tinybars.
4. **The two money flows never look like one number charged twice.** Service fee is a
   small *charge to place the order*. Order value is *money held for the work*. Different
   label, different visual weight, everywhere they co-occur (especially MCP replies).
5. **Irreversible actions take a beat, proportional to how irreversible.** Claim is
   recoverable — claim-timeout returns it — so it is one click with a clear label. Sign
   is forever, so it gets exactly one inline confirmation: the button itself becomes
   “Publish forever? · Confirm”, the way DocuSign makes you confirm. Never a nag modal;
   never a one-pixel button.
6. **Status is a sentence.** Posted, Claimed, Under review, Published, Confirming, Paid.
   Never `POSTED` / `DELIVERED` / `SETTLED` on a default screen.
7. **Confirming is a state, not a spinner of doom.** Budget ~6s for the mirror. Stay
   readable. Do not fake “Paid” before the mirror says so.
8. **Lost claim race is ordinary.** “Someone else claimed this.” Not an error toast.
9. **Reject is a delivered product.** Treat it like a stamp, not a failure. No dispute
   affordance — disputes are stubbed.
10. **Certification is a tag the account holds.** Never “you burned a credential.”
11. **FAKE is always visible** on the demo artifact. Hard rule 7.
12. **MCP replies are a designed surface.** Same vocabulary as the web app. Structured
    blocks in chat, not a custom MCP card widget this week (that is extra P2 work the
    prize does not need).
13. **Hashscan is garnish.** The app reads the mirror. The link is proof for a judge,
    not a runtime dependency.
14. **Known limits win on camera.** If a label would contradict `docs/project-brief-v2.md`
    Known limits, change the label.

## Familiar frames (what to steal, not invent)

| Moment | Feels like |
|---|---|
| Inbox | Email: list of jobs, one obvious open |
| Claim | Accepting a calendar invite — yours now, with a clock |
| Workspace | A document beside a comments column |
| Verdict | A form you submit, not a trading ticket |
| Sign | DocuSign / government e-sign: one deliberate act |
| Paid | A receipt, not a block explorer |

Do not steal: wallet connect modals, gas sliders, hex inspectors, token tickers.

## The requester does not need a web UI this week

When the requester is an agent, the tool *is* the interface. A page would be a second
place to keep in sync. Build the web form later for the row of the modality matrix that
has **no agent** — a person ordering from a form. Until then, spend the wrapping effort
on `handoff_verify` copy: fee named as a posting charge, lock named as escrow, verdict
and settlement in the same words the expert app uses.

## Magic moment (peak-end)

For the expert, and on camera: after Sign, the screen goes still.

**Published · attributable forever.** Then, without hurry, **Paid · 100 HBAR.**

That is the product. Everything upstream exists to reach it. Everything downstream
(Hashscan, ids) protects it. Do not follow it with a marketing banner or a “what’s next.”

For the requester, the matching close is the agent reporting the verdict **and** that
the expert was paid, especially on reject: *you bought judgment, not approval.*

## Honesty baked into the flow

- Payment default is pay. A reject is paid. Say so on both surfaces.
- Settlement is a mirror-node read.
- Nothing on camera uses `MockChainAdapter`. Mock ids 404 on Hashscan.
- No jury, no RFQ-from-reject, no “incentive system is closed.”

## What this file is not

Not a license to build embedded wallets, passkeys, session-key budget UX, or a requester
SPA. Those are named so the philosophy stays coherent when we have time. This week Jack
builds the expert screens in `docs/design-system.md`. Tseegii builds the MCP copy in
that same file. Nasaa cuts anything that is not on camera.

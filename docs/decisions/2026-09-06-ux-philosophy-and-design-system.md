# UX philosophy and design system for this week

**Decision.** Product UI this week follows `docs/ux-philosophy.md` and
`docs/design-system.md`. The job of every screen is to give the user the thing they
bought — a signed human judgment plus proof — and nothing else. Progressive disclosure
is the long-term rule (one app with depth: calm default, raw truth one click away,
escape hatch for people who want keys). **This week we ship layer 0+1 and the expert’s
existing own-account signing; we do not build custodial wrap, embedded wallets, seed
phrases, or a requester web UI.**

Settled from the open demo-journey questions:

1. **On-camera verdict is Reject** (approve-with-changes is the fallback). Bland approve
   hides pay-on-any-verdict.
2. **Requester wrapping is designed MCP copy**, structured markdown in the tool result,
   not a custom rich card and not a web page.
3. **Artifact hash is layer 1**, not the hero. Default: “your work, submitted.” One
   click: “Committed fingerprint.”
4. **One expert on camera.** Lost-claim-race UX is built; a second expert is not filmed.
5. **Sign has one inline confirmation; Claim has none.** Proportional to reversibility.
   DocuSign is the frame, and DocuSign confirms.
6. **The FAKE banner is a neutral label**, never a hue shared with Reject or error, because
   both are on screen at the climax and the tie-breaker is clarity.
7. **“Judge” means the dispute juror (Tier 3).** The silent third stakeholder is the
   hackathon judge, and the docs say so.
8. **This week the attestation publishes under the expert’s account through the chain
   adapter, whose key the platform holds for the staged expert.** That is the “platform is
   trusted” known limit, said on camera. Own-wallet signing is roadmap layer 3. Matches
   Jack’s PR #11, which signs through `ChainAdapter` with no wallet dependency.
9. **Nothing to learn is a principle.** Every screen borrows a frame the user already
   knows; the demo expert arrives pre-configured and onboarding is roadmap.

**Why.** The demo is five minutes. The prize beat is a paid x402 request. The product
claim is accountability made visible. A salon-app design system (mobile-first, no
learning, recommended defaults on every choice) would hide the proof and bias the
verdict. A wallet-infrastructure project would miss the recording. The requester this
week is an agent; a second web UI would double the surface without covering a new
persona until Tier 2.

**Consequences.**

- Jack implements expert screens from `docs/design-system.md` (inbox → claim →
  workspace → verdict → sign → confirming → paid), including unfilmed exits.
- Tseegii uses the MCP copy blocks in that file; the two money flows must not read as
  one amount.
- Copy dictionary is binding on camera. Internal enums stay in code.
- `CLAUDE.md` doc map points at the two new files. Brief scope is unchanged (no new
  tier items).
- Roadmap philosophy (embedded wallets / passkeys as a future default layer) is written
  so we do not re-litigate it; it is not a build prompt.

**Supersedes.** Nothing. Complements `2026-09-06-demo-price-and-x402-fee.md` (the
amounts these screens must make legible).

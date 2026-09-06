# UX fixes from the persona review and the Laws of UX

**Decision.** Six calls settled on 2026-09-06 after two persona reviews (an Expert and a
Requester, inhabited by separate agents) and a pass against the thirty Laws of UX. All
six are applied in `docs/ux-philosophy.md`, `docs/design-system.md` and the flow
artifact. Amends `2026-09-06-ux-philosophy-and-design-system.md`; nothing there is
reversed.

1. **The expert’s judgment reaches the requester.** Defect codes go inline in the close
   (they are public on-chain already). Notes are delivered inline from the content store,
   with a signed link as fallback. The close leads with the reasons, then the money, then
   the slogan. Both reviewers, from opposite seats, found this hole independently: the
   product proved a human signed and never handed over what they said.
2. **A read-only `handoff_status(order_id)` ships.** MCP is request/response and nothing
   pushes, so without it the close never reaches a requester who shut the laptop and the
   flow ends at beat 3. It is a query, not a polling tool; reads are already ungated by
   `2026-09-05-gate-covers-order-posting-only.md`.
3. **The claim window never extends past the order deadline**, and Claim is refused when
   the remaining window is too short to review. Two clocks were shown and never
   reconciled; this is the lifecycle rule that lets the UI show one honest time.
4. **The stamp reads “Published · signed by you, attributable forever.”** Receipt first,
   permanence second. The Expert read the old line as a threat after the click; the
   warning belongs before it (the Confirm beat), the receipt after. Both audiences served.
5. **Defect codes are free text this week**, bound shown in characters, uppercase
   convention in the placeholder, normalized rather than rejected. A picklist per
   credential is roadmap.
6. **Orders claimed by others are hidden from the inbox**, with a muted count. The inbox’s
   promise is work you can take.

**Also settled, because they follow from rules already written:** Claim is confirmed
through the same Confirming state as payout and the workspace opens only on a confirmed
claim (CLAUDE.md already requires handling a mirror-confirmed earlier claim); no verdict
is preselected; the Sign summary is structured into public and private with the real
defect codes and a name; clocks are times, never countdowns; the description shows
before Claim and the document after; a payment-pending state exists at ~60s; the
violation copy carries a recourse line; the requester’s first-contact failures each end
“Nothing was charged.”

**Why the laws changed little.** Twenty-six of thirty confirmed the design as written.
Four folded in — Paradox of the Active User and Chunking (structured Sign summary),
Postel (normalize input), Fitts (primary action placement, “Not yet” apart from
Confirm), Zeigarnik and Goal-Gradient (three-step mark, status query). Three are
deliberately overridden and named in the philosophy so nobody “fixes” them: Doherty
loses to honesty on Paid, Postel loses to the money path on amounts, Hick’s loses to
equality on the verdict.

**Consequences.**

- Tseegii: `handoff_status`, tag enumeration and unknown-tag rejection at post, the three
  failure replies, and the beat-10 close carrying codes, notes and signer.
- Jack: Confirming on claim, no preselected verdict, the structured Sign summary with an
  identity line, clocks as times, the brief and clock carried into the workspace, the
  payment-pending and violation-with-recourse states.
- Khishgee: the claim-window rule in the lifecycle, and notes delivery from the content
  store for the close.
- The copy dictionary gains six banned words a persona review caught leaking, with plain
  replacements.

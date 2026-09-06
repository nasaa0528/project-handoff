# apps/web — the expert app

**Owner: P3 Jack.** This app is on camera for most of the demo, so it is a product
surface before it is a codebase.

## What this app owns

- Inbox, review workspace, verdict editor, sign action.
- The `defects[]` editor, enforcing the bounds from `@handoff/schema` in the UI so an
  expert never writes something the verifier will reject.
- The lost-claim-race experience.

## What this app must never do

- **Never hold a platform key.** The verifier key and the schedule-admin key are
  server-side only. This is a browser build and its tsconfig deliberately has no Node
  types.
- **Never invent a bound.** Import `DEFECTS_MAX_ITEMS` and `DEFECT_CODE_MAX_BYTES` from
  the schema package so the UI and the verifier agree by construction.
- **Never send the expert's written notes on-chain.** They go to the content store and
  only `notes_hash` is published.
- **Never treat a claim as settled before the mirror says so.** Consensus timestamp
  decides who won. The button may acknowledge the click instantly, but the workspace
  opens only on a confirmed claim, and losing the race is an ordinary outcome rather
  than an error.

## Two timings that shape the UI

- The mirror node lags. Hedera's own tutorial waits six seconds after a submit. Design
  for that rather than spinning forever.
- Hashscan is a viewer, not a dependency. Read mirror nodes directly and treat the
  Hashscan link as garnish; its indexing can lag past the length of the demo.

Stack is React, Tailwind and shadcn/ui. Screens get sketched as throwaway HTML
artifacts, not in a design tool. The review workspace is the one worth mocking carefully.

Build from `docs/ux-philosophy.md` and `docs/design-system.md`. Copy dictionary and the
two money treatments are binding on camera. Do not add a wallet, seed phrase, or
requester UI.

## Sitemap — a funnel, not a dashboard

One spine per order. The failure mode is building an "app" (sidebar, settings, profile,
stats) when *nothing to learn* demands one path.

```
/                     Inbox       orders I am certified for; claimed-by-others hidden, muted count
/orders/:id           Order       the ask · the vault · Claim → Confirming → Claimed | Someone else claimed this
/orders/:id/review    Workspace   document on the left, stays put; the right column advances:
                                  notes & defects → verdict → sign → confirming → paid
```

Three routes. Everything else is **state rendered inside them**, never a page: lost
race, claim expired, deadline passed, payment pending, format-check failure.

- **The document never disappears once opened.** Verdict and Sign happen in the column
  beside it, not on separate routes. Splitting them means the expert loses sight of the
  thing they are judging at the moment they judge it. The column progresses; the paper
  stays.
- **Header:** wordmark, the expert's name and account with their credential pills, a
  Testnet badge, and the mode banner ("mock chain, never record this") until cutover.
  No nav menu, because there is nowhere else to go. No settings page; the account comes
  from config.
- **Order id in the URL.** Refresh anywhere lands where you were; a specific order is
  deep-linkable, which the recording will want. A tiny router; three routes do not
  justify a heavy one.

## Ten rules the app must feel like

The philosophy translated into behavior that is checkable in code, not vibes. Each maps
to a screen recipe in `docs/design-system.md`.

1. **State lives in the order, not the screen.** Refresh is never a loss. Back is never
   destructive; notes persist locally until signed.
2. **Every step is one click forward, with a way back always visible.** "Change verdict"
   and "Back to the document" are reachable from Sign. No dead ends. Paid is terminal,
   with a quiet link home and never a banner after it.
3. **Nothing spins.** A skeleton of the same shape while loading, or the labeled
   Confirming state. Reserve the proof row's space before it exists, so Published never
   shoves the layout.
4. **Claim confirms, Paid confirms.** Both wait on the mirror and both use the same
   Confirming state. The button acknowledges the click instantly; the *result* waits for
   the truth. After ~60s Confirming becomes "Published · payment pending", never an
   endless pulse.
5. **Prefetch the document the moment a claim confirms**, so the workspace opens with
   the paper already there. The single biggest smoothness win available.
6. **Reject costs the same clicks as Approve.** Measure it. No verdict is preselected;
   Continue is disabled until one is chosen.
7. **Only Sign asks twice.** Claim asks once. The second ask is the button itself
   becoming "Publish forever? · Confirm", with "Not yet" small and set apart.
8. **Keyboard end to end.** Tab and Enter through the whole funnel. A keyboard-driven
   take is calmer on camera than mouse hunting.
9. **Losing is ordinary.** Lost race replaces the button; it never toasts, never reddens.
   Same for claim expired and deadline passed. Only the format-check failure is an error,
   and it carries a next step.
10. **Empty and error states are sentences.** No illustrations, no codes, no engineering
    words: "attestation", "mirror node", "schema", "bytes" and "consensus timestamp" are
    banned on screen, with plain replacements in the copy dictionary.

Together with the design system and the flow walkthrough, this is the whole brief. If a
screen needs something not covered here, ask P4 before building it; scope-cut authority
sits there.

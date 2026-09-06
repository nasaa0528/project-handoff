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
- **Never treat an optimistic claim as settled.** Consensus timestamp decides who won.
  Render optimistically if you like, but handle losing the race when the mirror node
  confirms an earlier claim, and make losing feel like an ordinary outcome rather than
  an error.

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

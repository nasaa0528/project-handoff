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
two money treatments are binding on camera. Do not add a wallet or a seed phrase.

**The requester UI line was crossed on 2026-09-10, deliberately and not quietly.**
This file said "do not add a wallet, seed phrase, or requester UI", and
`docs/ux-philosophy.md` puts a plain web requester form in Tier 2 with "do not build it
this week". The seat owner asked for `/requests` three times and reaffirmed after the
blockers below were put to them, so it was built. **Scope-cut authority is Nasaa's, and
so is this: P4 rules on whether `/requests` stays, and the honest answer if it goes is to
delete the route, not to hide the tab.** What was built is narrower than the Tier 2 item:

- **No key was added, and no payment path.** The screen holds exactly the one key this
  app always held, the connected expert's, and never uses it here. Paying needs two
  signatures from a requester's own spending key and the panel does not have one.
- **The create panel makes only the first, free, unpaid call** to `POST /orders`, which
  needs no key, and hands the finish to `handoff_verify` with the arguments filled in.
- **The list is a read of the network, not of a server's opinion.** A row exists because
  this account's own transfer funded the escrow, memoed with the order id.

Two things still block a browser from finishing an order, and both are outside this lane:
the hosted service sends no `Access-Control-Allow-Origin` on `/tags`, `/orders/{id}` or
`POST /orders`, and answers `OPTIONS` with 405, so the browser drops every answer — the
first visible symptom is an empty reviewer list and a "Choose who should review it." that
nothing can satisfy (P2's lane, or Jack's nginx; the server-side change is in
`apps/mcp/src/server.ts` and waits on a redeploy); and `X402Signer` lives server-side by
decision and uses Node's `Buffer`, so it does not run in a browser build (P1's lane).

## Email sign-in, as built (2026-09-12)

`apps/accounts-api` exists (`docs/decisions/2026-09-10-registration-keyed-on-the-hedera-account.md`)
and this app consumes it through `@handoff/accounts-client`, never `@handoff/accounts`.
Configured by `VITE_ACCOUNTS_API_URL`; **absent, the connect screen offers the key path
only** and nothing below renders. What a session is and is not:

- **A session is who is at the keyboard. It is not a key.** Signing a verdict still
  needs the key pasted into `SecretKey`, once, on the **key step** — the connect card
  with the account locked and only the key field live. On the mock there is no key, so
  an email session boots straight to the inbox.
- **The register form does not ask for the Hedera account.** Since
  `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md` the account is
  the service's to create, so the field is hidden and the flow takes whatever account
  the service's answer names. Until the service can create one it refuses with
  `field: hederaAccountId`; the form then comes back with the field revealed and a plain
  sentence, and a typed id is checked on the testnet mirror as a first setup step. When
  the service creates accounts that branch never fires and nothing here changes.
- **The token lives in App state, in memory only.** Never `localStorage`; a reload is a
  sign-in, like the key. Disconnect calls `signOut` best-effort. The password lives in
  `AuthFlow`'s state for the length of the flow so the person is signed in the moment
  the mailbox is confirmed, and dies with the component.
- **The credential card is static.** Domain and license number are not stored, not sent,
  and the caption says so: certification is an allowlist row set by the platform. The
  card never says "verified". The setup card lists real steps only — a mirror lookup,
  the register call, the code send — each lit when its call returns; nothing waits on a
  timer to look busy, and nothing says "secure signing" was set up, because nothing was.
- **Errors branch on `AccountsApiError.code`, never on the message**
  (`src/session/accounts.ts`). `email_not_verified` is a route to the code screen, not
  an error; `invalid_credentials` never says which of password or account was wrong.
- **No `<form>` anywhere in the flow**, for the same reason as the key field: a
  submitted form with a password asks the browser to save it, and that prompt must never
  appear on camera.
- **The three "Welcome" panes are an onboarding carousel**, which `docs/design-system.md`
  lists under "do not just add". Built at the seat owner's request on 2026-09-12, as its
  own commit so P4 can drop it cleanly; every line on it is something the build does.

Screens: `src/screens/auth/AuthCards.tsx` (every state a prop), `AuthFlow.tsx` (the
calls), and the email form and locked step on `ConnectScreen.tsx`.

## Who signs, and how the key gets here

- The account and, on testnet, the private key come from the **connect screen**, not
  the environment. `VITE_EXPERT_ACCOUNT_ID` is an optional prefill and nothing more.
- The key is pasted into a masked field that no password manager treats as a credential
  (a password field where the masking CSS is missing), wrapped in `SecretKey`
  (`src/session/secret.ts`), read exactly once by `createWebChain`, and handed to the
  adapter as a plain string. The holder never enters React state, `localStorage`, an
  error message, or a log. `scrubHex` redacts anything the adapter says back on the
  connect path. The adapter P1 returns must keep the key the same way: in a closure or
  a WeakMap, never as an own property, because the adapter itself does sit in state.
- Mock mode has no key field. The mock signs nothing, and the mock member of
  `ExpertConnection` has no key slot, so a key in mock mode cannot be constructed.
- `ExpertChain` is the slice of `ChainAdapter` the sign path may call: no
  `signSchedule`, `createSchedule`, `deleteSchedule`, `lockFunds`. Only the mock
  member of `WebChain` carries the whole adapter, under `mock`, for the stand-ins.
- Before the key is typed, the app reads `GET /api/v1/accounts/{id}` on the **testnet**
  mirror node to confirm the account and its curve. Never in mock mode.
- `vite build` and `vite dev` refuse a `VITE_` variable whose name says secret or whose
  value is shaped like a private key, before any bundle exists (`vite.config.ts`,
  `src/chain/secretNames.ts`). The runtime check in `config.ts` is the second line.

## Sitemap — a funnel, not a dashboard

One spine per order. The failure mode is building an "app" (sidebar, settings, profile,
stats) when *nothing to learn* demands one path.

```
/                     Inbox       orders I am certified for; claimed-by-others hidden, muted count
/requests             My requests orders this account paid the escrow for; New request prices one
/orders/:id           Order       the ask · the vault · Claim → Confirming → Claimed | Someone else claimed this
/orders/:id/review    Workspace   document on the left, stays put; the right column advances:
                                  notes & defects → verdict → sign → confirming → paid
```

Four routes. Everything else is **state rendered inside them**, never a page: lost
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

## Testnet wiring, as built

- `createWebChain`'s testnet branch calls `createExpertChain` from
  `@handoff/chain/expert`, the only thing this app imports from the chain package. It
  is a subpath export on purpose: the barrel drags in the platform adapter and the x402
  signer, which have no business in a browser bundle. The key goes from `SecretKey` into
  the factory's closure in one read, checked against the mirror node's public key first,
  so a wrong paste is a `KeyMismatchError` at connect rather than a failed signature on
  camera.
- Orders come off the topic through `TestnetOrderSource` (`src/chain/testnetOrders.ts`)
  and claims are decided by the treaty's `resolveClaims`; the app has no winner rule of
  its own. A claim is `submitMessage` on the expert's chain, so the payer is the expert.
- The payout is found, never told: `mirrorPayoutLocator` reads the expert's transfers
  since the verdict's consensus timestamp and matches the one that moves the order value
  from the escrow. Read directly from the mirror node, which is allowed; Hashscan is not.
- Content is `HttpContentStore`: `GET {VITE_CONTENT_URL}/{sha256}` for the ask and the
  document, `PUT` for the notes, every read checked against its hash. The Supabase
  service key never reaches this app, so something server-side answers that URL: it is
  `apps/mcp`, at `/content/{sha256}`, so `VITE_CONTENT_URL=http://localhost:4021/content`
  against a local resource server. Free, unauthenticated and CORS-open, decided in
  `../../docs/decisions/2026-09-09-content-reads-are-by-hash-and-unauthenticated.md`; a
  `PUT` is refused unless the body hashes to the path, and capped at 256KB.
- The requests screen reads `GET {api}/orders/{id}` and `GET {api}/tags`, both free and
  unauthenticated, from `VITE_HANDOFF_API_URL`. It defaults to `VITE_CONTENT_URL` without
  its trailing `/content`, since one process answers both, and refuses to guess when the
  content URL is shaped otherwise.
- Testnet needs `VITE_HANDOFF_ORDERS_TOPIC_ID`, `VITE_CONTENT_URL` and
  `VITE_HANDOFF_ESCROW_ACCOUNT_ID`; `VITE_HEDERA_MIRROR_NODE_URL` is optional and
  defaults to the public testnet mirror. A URL that mentions mainnet refuses to boot.


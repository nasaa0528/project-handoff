# Registration exists, keyed on the Hedera account id, in MongoDB behind its own REST API

**Decision.** There is now a registration surface: `packages/accounts` and
`apps/accounts-api`. It stores email, username, first and last name, and the
**primary key is the Hedera account id**. Password auth with scrypt, email
verification by one-time code, opaque server-side sessions. MongoDB, behind an
`AccountStore` interface with an in-memory implementation for tests.

Requested directly by **Khishgee (P1)** on Sep 10, twice, after the Sep 8 decision
had ruled it out — and the third message is what changed the answer: *"unique id
is: hedera account."*

## Why, when Sep 8 said no

`2026-09-08-custody-onboarding-and-wallets-stay-out.md` refused this, and the
stated reason was specific:

> **Email/password registration with a one-time email code is not in any tier,
> because there is no user model to attach it to.** Identity in this design *is*
> the Hedera account [...] Email OTP means mail transport, a token store, rate
> limiting and sessions, and then a mapping from email to Hedera account — which
> drags custody back in through the side door.

Making the Hedera account id the primary key **answers that objection rather than
overriding it.** There is no mapping from email to a Hedera account, because the
account *is* the row's identity — email and username are profile fields hanging
off it, and the unique index Mongo always builds on `_id` is what enforces one row
per account. The side door the old decision was worried about is the direction the
mapping ran; reversed, it does not exist.

The custody argument is untouched and still binding. **Nothing here creates a
Hedera account, and nothing here holds a key.** That is the actual Tier 3 line —
`CLAUDE.md`'s "custodial web2 wrap" — and this stays on the safe side of it. The
account arrives already existing, made by its owner. On the expert side this
matters more than scope: an attestation signed by a platform-held key proves the
platform pressed a button, not that a certified human reviewed anything, and that
is the product's central claim.

What remains true from Sep 8 is the *cost* it named: mail transport, a token store,
rate limiting and sessions. All four are now built, which is the honest price of
this decision and is why it needed to be P1's call to spend it — three days before
freeze, on a Tier-1-complete lane.

## What was built

- **`packages/accounts`** — schemas and normalisation, scrypt passwords, six-digit
  codes and session tokens stored as keyed HMAC fingerprints, the `AccountStore`
  interface, a Mongo implementation, an in-memory one, and one contract suite that
  **both** run so the test double cannot drift from the database. 174 tests, 38 of
  them against a real mongod.
- **`apps/accounts-api`** — eight routes, an exhaustive error-code-to-status map, a
  per-route rate limiter, and a CORS allowlist. Routes are a pure function of a
  request, so they test without binding a port. 45 tests.
- Verified running: against the in-memory store and against a real mongod, every
  endpoint driven end to end with curl.

## What was deliberately not built

Said out loud so nobody assumes otherwise:

- **Proof of control.** A row is a *claim* to a Hedera account, not proof of one.
  The only check is a mirror-node read asking whether the account exists, which
  catches a typo and nothing else — someone can register an id they do not hold and
  squat the username on it. The fix is challenge–response (issue a nonce, the client
  signs, verify against the mirror's public key); it needs the SDK, so it belongs in
  `packages/chain` and injects here. **Until it exists, nothing that spends money
  may treat this collection as authority.** The cert gate stays the HCS registry
  topic (NAS-27), which is on-chain and auditable.
- **A mail vendor.** `consoleEmailSender` prints the code. The flow — issue, store a
  fingerprint, expire in ten minutes, cap at five attempts, single use — is real and
  complete; only the transport is a stub, and it is one injected function.
- **Custody, key storage, account creation, wallets.** Unchanged from Sep 8.
- **Any link to the order lifecycle.** No route here touches orders, escrow, HCS or
  money, and `apps/mcp` does not need this process to run.

## The mirror-node read is not oracle work

Flagged by the rules auditor and worth settling here so nobody re-opens it.
`CLAUDE.md` says: *"No oracle work. `execution` acceptance proofs need a trusted
fetcher. Do not write one this week — not a DNS lookup, not an HTTP 200 check."*
`mirrorAccountCheck` is mechanically an HTTP status check against an external
service, so it deserves the second look.

It is not what that rule forbids, on three counts. The rule is scoped to
**`execution` acceptance proofs** — deciding whether work was delivered, which is
what needs a fetcher nobody can lie to. This read decides whether a string a
person typed into a registration form is an account that exists. Nothing consumes
its result to release money, or to gate a claim, or to validate an attestation. And
it **fails open**: unreachable or non-2xx returns `unknown` and registration
proceeds, so it cannot even be the load-bearing step in its own flow.

It is input validation that catches a typo. If that ever changes — if any code path
starts treating its answer as authority — the rule applies and this stops being
acceptable.

## Consequences

- **MongoDB is now a second database, beside Supabase.** Worth naming rather than
  discovering: Supabase (Postgres + object storage) holds artifacts and notes,
  Mongo holds accounts. Two datastores for one week's build is a real cost, and the
  reason it is acceptable is that they share nothing — no join, no transaction, no
  migration crossing them.
- **A new required secret.** `HANDOFF_ACCOUNTS_CODE_PEPPER` keys the HMAC over
  codes and session tokens; without it a stolen dump is a pile of live credentials,
  because six digits is a million values and a bare SHA-256 of one is reversible in
  about a second. The process refuses to start without it, which is the correct
  failure.
- **Tier 1 is unaffected.** Nothing was cut or deferred for this. Escrow, topics,
  the co-signed payout, the x402 gate and the content store were all complete and
  merged before it started.
- The in-memory store default is loud on boot, for the same reason `apps/mcp`
  shouts about the mock chain: an expert who registers during a demo and cannot
  sign in afterwards is a failure nobody diagnoses in the moment.

## Still open — **Nasaa's** call, deliberately not made here

Two questions, both scope and story rather than engineering, and both are Nasaa's
under the scope-cut authority in `docs/team-seats.md`:

1. **Does this appear in the demo and the pitch, or does it stay in the repo?** It
   is not on the Tier 1 ladder and it is not a prize requirement. The argument for
   showing it is the one Khishgee made on Sep 8 and which the Sep 8 decision left
   open for Nasaa: a demo where both sides already hold funded Hedera accounts is
   not a product anyone can buy, and a judge may well ask who onboards the expert.
   The argument against is that five minutes is short and the money path is what
   qualifies us.
2. **Does the missing proof-of-control get said on camera if registration is
   shown?** P1's position: if it is shown, it is said — "this is a profile keyed on
   an account you already own; proving you own it is the next commit" is a fine
   sentence, and the Known limits section in the brief already wins over every
   other document in anything public. Showing it while implying the binding is
   proven would be the one version of this that costs credibility.

Whichever way both go, the answer gets appended to this file rather than a new one.

## Supersedes

Partly supersedes `2026-09-08-custody-onboarding-and-wallets-stay-out.md`, **item
2 only** — email/password registration with a one-time code, which that file placed
outside every tier. Items 1 and 3 of that decision (platform-created custodial
accounts; MetaMask and other chains) stand unchanged, as does its open question
about the onboarding roadmap slide, which question 1 above now folds into.

# packages/accounts — P1 Khishgee

Registration and sign-in for humans: email, username, first and last name, keyed
on the Hedera account id.

**The Hedera account id is the identity.** Not a generated uuid, not the email. It
is Mongo's `_id`, so the uniqueness of an identity is enforced by the index the
database always builds. Root `CLAUDE.md` and
`docs/decisions/2026-09-08-custody-onboarding-and-wallets-stay-out.md` both already
say identity in this design *is* the Hedera account; this package is that sentence
with a profile attached.

## What this package must never do

These are the line between a profile store and the Tier 3 "custodial web2 wrap".

- **Never create a Hedera account.** The account arrives already existing, made by
  its owner at the portal or in a wallet.
- **Never hold a private key**, and never sign anything. Nothing here imports the
  Hedera SDK; the one ledger interaction is a mirror-node GET that asks whether an
  account exists.
- **Never let a row here authorise money.** A registration is a *claim* to an
  account, not proof of control — see below. The cert gate is the HCS registry
  topic (NAS-27), which is on-chain and auditable.
- **Never store a secret in plaintext.** Passwords are scrypt; email codes and
  session tokens are stored as keyed HMAC fingerprints and never as themselves.

The second rule is the load-bearing one. If the platform held an expert's key, the
product's central claim would stop being true: an attestation signed by a
platform-held key proves the platform pressed a button, not that a certified human
reviewed anything.

## Proof of control — the seam, and what is honestly missing

Registering `0.0.5005` does not demonstrate control of `0.0.5005`. Today the only
check is `mirrorAccountCheck`, which asks the mirror node whether the account
**exists** — that catches a typo, and nothing else. Someone could register an
account id they do not hold and squat the username attached to it.

The real fix is challenge–response: issue a nonce, the client signs it with the
account's key, the server verifies against the public key the mirror node reports.
That belongs behind `AccountExistenceCheck`'s neighbour — a `ProofOfControl`
interface — and it needs the SDK, so the verification would live in
`packages/chain` and be injected here. It is **not built**, it is written down in
`docs/decisions/2026-09-10-registration-keyed-on-the-hedera-account.md`, and until
it exists nothing downstream may treat a row here as authority over funds.

## The contract with @handoff/schema

None, deliberately. This package does not touch envelopes, attestations, money or
hashing, so it takes no dependency on the treaty package and cannot drift from it.
If a profile ever needs to appear inside an envelope, the type belongs in
`packages/schema` and this package implements it — not the other way round.

## Layout

| File | What it owns |
|---|---|
| `account.ts` | The schemas, normalisation, and `publicProfile` — the one place an account becomes something a client may see |
| `password.ts` | scrypt hashing, the acceptability rules, and the constant-time compare |
| `secrets.ts` | Six-digit codes, session tokens, and the peppered HMAC both are stored as |
| `store.ts` | The `AccountStore` interface and its errors |
| `memory-store.ts` | In-memory implementation. Tests only — never a demo |
| `mongo-store.ts` | MongoDB implementation. `_id` is the Hedera account id |
| `store-contract.ts` | The suite **both** stores run, so the double cannot drift from the database |
| `service.ts` | The use cases. No HTTP; status codes are the API's job |
| `hedera-account.ts` | The mirror-node existence check. No SDK import |

## Things that will bite if ignored

- **`InMemoryAccountStore` must never be more permissive than Mongo.** The service
  tests run against it, so any difference is a suite that passes while the product
  is broken. That is what `store-contract.ts` is for — add behaviour there, not to
  one store's own test file.
- **Mongo's TTL index is cleanup, not enforcement.** Its monitor wakes about once a
  minute, so a code can outlive its `expiresAt`. Both stores re-check the time on
  every read, and that is what actually makes expiry work.
- **The attempt counter must stay atomic.** `$inc` server-side, not
  read-then-write: six digits is only strong while guessing is bounded, and a lost
  increment is a lost bound.
- **Two duplicate-reporting orders must agree.** Mongo checks `_id` first, then
  indexes in creation order, so `email_unique` is created before
  `username_unique` and the in-memory store checks in the same order.
- **The mirror check fails open.** An unreachable mirror node returns `unknown` and
  registration proceeds, matching `assertOperatorKeyMatches` in `@handoff/chain`.
  Being unable to check is not evidence of a bad id, and taking registration down
  with a third party would be the worse failure.
- **Mail transport is injected and nothing real is wired.** `consoleEmailSender`
  prints the code. Swapping in a vendor is one function and no change here.

## Tests

`pnpm test` runs 174, including 38 against a real mongod via
`mongodb-memory-server`. The first run downloads a binary (~150MB) and caches it
under `~/.cache/mongodb-binaries`; `SKIP_MONGO_TESTS=1` skips those and keeps
everything else.

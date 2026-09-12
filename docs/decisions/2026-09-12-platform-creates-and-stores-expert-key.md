# The platform creates the expert's Hedera account and stores the key, encrypted with the expert's password

**Decision.** The registration flow creates a Hedera testnet account for the
expert and stores the ECDSA private key encrypted with the expert's password.
The expert never sees or manages a raw key. The platform decrypts at sign time
using the password (held in the session), signs the HCS attestation, and
discards the plaintext.

Scope exception granted by **Nasaa (P4)**, overriding the custody line in
`2026-09-08-custody-onboarding-and-wallets-stay-out.md` and the "nothing here
creates a Hedera account, and nothing here holds a key" clause in
`2026-09-10-registration-keyed-on-the-hedera-account.md`.

## Why

The demo needs a smooth expert onboarding. A first-time user — the judge —
should not have to create a Hedera account, fund it, export a private key, and
paste it into a web app. That friction kills the demo before it starts.

The existing registration decision explicitly left this door closed for a good
reason: an attestation signed by a platform-held key proves the platform pressed
a button, not that a human reviewed anything. That concern is real and stays in
the Known Limits section. But for a hackathon demo, a smooth UI that shows the
full flow matters more than key sovereignty. The judge needs to *feel* the
product, not debug key management.

In production, this becomes client-side signing or a hardware wallet. This week,
it is custodial — and we say so on camera.

## What changes

### `packages/chain`

`createTestnetAccount(operatorId, operatorKey)` — generates an ECDSA key pair,
submits `AccountCreateTransaction` with a small initial balance from the
operator, returns `{ accountId, privateKey, transactionId }`. The SDK stays
where the rules put it; no other package imports it.

### `packages/accounts`

Gains two fields on the account record: `encryptedPrivateKey` (the key encrypted
with the user's password via AES-256-GCM) and `hederaAccountId` (already the
primary key). A `decryptKey(password)` method returns the plaintext key for the
session; the plaintext is never persisted.

### `apps/accounts-api`

When `POST /v1/accounts` receives a registration without a Hedera account id,
the server:
1. Calls `createTestnetAccount` using the operator from the vault
2. Encrypts the private key with the user's password
3. Stores the encrypted blob
4. Returns `{ accountId }` — the private key is **never** in the response

The operator key is read from `/etc/handoff/handoff.env`, never the repo.

### `apps/web`

The onboarding provisioning steps become real:
1. "Creating your Hedera account" — calls the accounts API
2. "Setting up secure signing" — server encrypts the key
3. "Saving your security settings" — server stores the encrypted blob
4. "Ready" — shows the assigned account id

No "save this key" screen. No key export. The expert signs verdicts through the
app; the app decrypts with their session password.

## Consequences

- **Custody is real.** The platform holds encrypted keys. A compromised database
  plus a compromised password yields the expert's signing key. This is custodial.
- **Honesty cost.** The demo video needs one sentence: *"The platform encrypts
  and stores the expert's signing key with their password. This is custodial —
  production would use client-side signing."* Add to Known Limits in the brief.
- **Operator key on the server.** `apps/accounts-api` needs the shared operator
  to fund new accounts. Vault-only, never the repo. Hard rule 2 applies.
- **Lane ownership.** `packages/chain` gains the `createTestnetAccount` function
  (P1 Khishgee authors, P4 reviews). `packages/accounts` gains the encryption
  fields (P1 authors). `apps/web` onboarding becomes real (P3 Jack). `apps/accounts-api`
  wires it together (P1).

## Supersedes

Overrides the "nothing here creates a Hedera account, and nothing here holds a
key" clause in `2026-09-10-registration-keyed-on-the-hedera-account.md`. The
rest of that decision (registration keyed on Hedera account id, MongoDB, scrypt
passwords, sessions) remains in force.

Overrides item 3 of `2026-09-08-custody-onboarding-and-wallets-stay-out.md`
("the platform does not hold keys").

Does **not** override the production thesis: client-side signing remains the
target architecture. This is a demo-scoped exception with an explicit expiry.

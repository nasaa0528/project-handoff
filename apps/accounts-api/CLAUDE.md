# apps/accounts-api — P1 Khishgee

The REST API over `@handoff/accounts`. Registration, email verification, sign-in,
sign-out and the caller's own profile.

**A separate process from `apps/mcp` on purpose.** `apps/mcp` is P2's lane and is
the x402-gated order surface; putting registration routes in it would put two
seats in one file and one deploy. Nothing here touches orders, escrow, HCS or
money, and nothing in `apps/mcp` needs this to run.

## Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | |
| POST | `/v1/accounts` | — | 201. Never returns the code, and never the private key |
| POST | `/v1/accounts/verification/request` | — | 202, resend |
| POST | `/v1/accounts/verification/confirm` | — | 200 |
| POST | `/v1/sessions` | — | 200 with a bearer token |
| DELETE | `/v1/sessions/current` | bearer | 204, idempotent |
| GET | `/v1/accounts/me` | bearer | |
| PATCH | `/v1/accounts/me` | bearer | `firstName`, `lastName` (`null` clears) |

**There is deliberately no route that looks an account up by username or email.**
It would be a public "is this person registered" oracle, and the one thing this
service knows is which Hedera accounts belong to named humans.

## Status codes

Mapped from the domain's `AccountErrorCode` by `statusForCode` in `routes.ts`, and
the mapping is **exhaustive** — a `never` in the default case means adding an error
code without a status fails to compile instead of quietly becoming a 500.

| Code | Status |
|---|---|
| `validation_failed`, `weak_password`, `reserved_username`, `unknown_hedera_account`, `code_invalid`, `malformed_json` | 400 |
| `unauthenticated`, `invalid_credentials` | 401 |
| `email_not_verified` | 403 |
| `account_not_found`, `not_found` | 404 |
| `method_not_allowed` | 405 |
| `account_exists` | 409 |
| `code_expired` | 410 |
| `body_too_large` | 413 |
| `too_many_attempts`, `rate_limited` | 429 |

Every body is `{ "error": { "code", "message", "field"? } }`. Clients branch on
`code`, never on the message text.

`410` rather than `400` for an expired code is intentional: the code was real and
is not any more, which is a different thing for a client to show than "that code is
wrong".

## Creating accounts for people

Off unless `HANDOFF_ACCOUNTS_PROVISION=true`. When it is on, a registration that
omits `hederaAccountId` makes this process create a testnet account from the
operator and store its key encrypted under the registering password — custody,
granted by `docs/decisions/2026-09-12-platform-creates-and-stores-expert-key.md`
and conditional on it being said out loud. The process shouts about it on boot for
the same reason it shouts about the in-memory store.

| Variable | Default | What it does |
|---|---|---|
| `HANDOFF_ACCOUNTS_PROVISION` | `false` | `true` lets this process create accounts and hold keys |
| `HANDOFF_ACCOUNTS_NEW_BALANCE_HBAR` | `1` | What each created account is funded with |
| `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY` | — | The operator that pays. Read via `loadChainEnv`, which refuses any network but testnet |

The operator key is vault-only (hard rule 2) and this is the only part of the API
that touches it. With provisioning off, the service is constructed with no
provisioner at all, so the capability is absent rather than merely unused.

## Things that will bite if ignored

- **`handle()` is a pure function of a request.** `http.ts` only moves bytes. Keep
  it that way — it is why the whole API is tested without binding a port.
- **The account id comes from the token, never from the body.** Taking it from the
  body on `PATCH /v1/accounts/me` would let any signed-in caller edit anyone's
  profile. The strict schema also refuses the key outright.
- **Sign-in must stay indistinguishable.** A wrong password and an unknown account
  return byte-identical bodies, and the service burns the same scrypt time for
  both. Anything that differentiates them turns this endpoint into an
  account-existence oracle for the platform's experts.
- **CORS is an allowlist and must never become `*`.** The sign-in response body
  carries a bearer token, so `*` would let any page the user visits read it.
- **`X-Forwarded-For` is only read when `HANDOFF_ACCOUNTS_TRUST_PROXY=true`.** The
  header is client-supplied; trusting it with nothing in front of the process lets
  one caller present a new address per request and bypass the rate limiter
  entirely. When trusted, the **first** entry is the client.
- **The rate limiter is per-process.** Two instances behind a balancer have two
  budgets and the effective limit doubles. Fine for this build's single process;
  the production answer is a shared counter.
- **The response must never carry the private key.** On the provisioning path the
  client is told the account id and the AccountCreate transaction id, and nothing
  else about the key. `publicProfile` enforces it rather than the handler, and
  `routes.test.ts` asserts the serialised body contains neither the key nor its
  ciphertext.
- **500s never carry the error text.** An internal message can name a collection or
  a connection string. It is logged, not returned.
- **`OPTIONS` is answered for any path.** A browser sends the preflight before it
  can know whether the path exists, and a 404 there surfaces as an unexplained
  CORS failure.

## Running it

```
pnpm --filter @handoff/accounts-api start     # or dev, for watch
```

Needs `HANDOFF_ACCOUNTS_CODE_PEPPER` and will not start without it. Defaults to the
in-memory store and says so loudly — every registration is lost on restart, so set
`HANDOFF_ACCOUNTS_STORE=mongo` with `MONGODB_URI` for anything you intend to keep.
See `.env.example`.

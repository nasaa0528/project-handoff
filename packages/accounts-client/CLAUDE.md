# packages/accounts-client — P1 Khishgee, consumed by P3

A typed client for `apps/accounts-api`. **Zero runtime dependencies.** Safe in a
browser build.

## Why this exists as its own package

Because `apps/web` **must not import `@handoff/accounts`**. That package is the
server side: it imports `mongodb` and `node:crypto`, and `apps/web`'s tsconfig
deliberately has no Node types, so the import fails to compile — and if it somehow
resolved, Vite would bundle a MongoDB driver into the expert app.

So the wire types are declared here by hand rather than re-exported from the
server. Two guards keep that honest:

- **This package's tsconfig sets `types: []` and `lib: ["ES2023", "DOM"]`.** There
  are no Node types available, so `import "node:crypto"` here is a compile error
  rather than something that only breaks in a bundle.
- **`apps/accounts-api/src/contract.test.ts` assigns the real handler output to
  the types below.** Hand-declared types drift; that test makes drift a compile
  error instead of a runtime surprise in P3's app.

## Using it

```ts
import { AccountsClient, AccountsApiError } from "@handoff/accounts-client";

const accounts = new AccountsClient({ baseUrl: import.meta.env.VITE_ACCOUNTS_API_URL });
```

Nothing on the instance is stateful. The token is passed on every authenticated
call rather than stashed, because where a session token lives is `apps/web`'s
decision — and a client that quietly held one would make "am I signed in" two
answers instead of one.

| Call | Returns |
|---|---|
| `health()` | `{ status }` |
| `register(input)` | profile + whether the code was sent |
| `requestVerification(accountId)` | resend |
| `confirmVerification(accountId, code)` | the now-verified profile |
| `signIn(identifier, password)` | `{ token, expiresAt, account }` |
| `signOut(token)` | `void`, idempotent |
| `getProfile(token)` | the profile, unwrapped |
| `updateProfile(token, patch)` | the updated profile |

`identifier` on `signIn` is the Hedera account id, the email **or** the username —
the server decides which by shape, so there is one field on the form, not three.

## Errors — the four cases the UI actually has to distinguish

Everything non-2xx throws `AccountsApiError`. **Branch on `.code`, never on
`.message`** — the messages are written for people and will be reworded.

- **`email_not_verified`** is not a failed sign-in. The password was right and the
  mailbox is not confirmed. Route to the verify screen; do not put "wrong
  password" in front of someone who typed the right one.
- **`invalid_credentials`** covers a wrong password *and* an account that does not
  exist, deliberately indistinguishably. Do not try to tell the user which — the
  server burns the same time on both so that sign-in is not a public "is this
  Hedera account a registered expert" oracle.
- **`code_invalid`** is worth another try. **`code_expired`** and
  **`too_many_attempts`** both mean the code is dead and the user needs
  `requestVerification`. `.retryAfterSeconds` is set on a 429.
- **`.needsSignIn`** is true exactly when the session is gone. **`.status === 0`**
  means the request never reached the server, which in a browser is usually the
  API not running or CORS refusing the origin — `HANDOFF_ACCOUNTS_CORS_ORIGINS`
  on the server, not a change here.

A `field` is set when exactly one input is at fault (`username`, `email`,
`hederaAccountId`, `password`, `code`), so a form can point at it.

## Things that will bite if ignored

- **The token is opaque. Do not parse it** — it is not a JWT. The server stores
  only a keyed HMAC of it, so there is no route that looks a token up.
- **`lastName` is optional and never null.** A cleared surname is an absent key.
  Sending `lastName: null` in a patch *clears* it; omitting the key leaves it.
  That distinction is real on the wire and the server honours it.
- **A registration whose `verification.sent` is `false` still created the
  account.** Say "we could not send the code, try again", not "registration
  failed" — the person does have an account.
- **`register` never returns the code.** It goes to the mailbox. In dev the server
  prints it to stdout.

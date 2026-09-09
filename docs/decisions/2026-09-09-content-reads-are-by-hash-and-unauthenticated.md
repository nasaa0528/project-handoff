# Content reads and writes are by-hash and unauthenticated this week

**Decision.** `apps/mcp` serves `GET /content/{sha256}` and `PUT /content/{sha256}`, both
free and both unauthenticated. The expert app reads the ask and the document through them
and stores the expert's notes through them, and never holds the Supabase service key. A
`PUT` is accepted only when the body hashes to the hash in the path, and is capped at
256KB. The production answer — a signed URL issued per confirmed claim — is not built
this week.

**Why.** The expert app is a browser build, so the service key cannot reach it (hard rule
2, and `apps/web/CLAUDE.md` states it as a lane rule). Something server-side has to answer
`VITE_CONTENT_URL`, and `apps/mcp` is the only server this project has. Without it the
inbox lists orders it cannot open: today's testnet run shows every order titled
`Order ord_…` with "The task description is not in the content store yet", because there
is nothing to fetch from.

Unauthenticated is the honest description of what by-hash access is, not a shortcut taken
on top of it. The hashes are published on a topic with no submit key, so anyone reading a
mirror node holds them. Authenticating the endpoint would move the boundary, not close it:
the read is only as private as the hash, and the hash is public by design.

`GET` is free for the same reason every other read is: the gate covers order posting only
(`2026-09-05-gate-covers-order-posting-only.md`), and a paid read of a public artifact
would charge for something a mirror node gives away.

**Consequences.**

- **Cert gating routes an order; it does not keep the document secret.** Anybody who
  reads the orders topic can read the artifact behind it. That is acceptable this week
  because every demo artifact is fabricated and labelled FAKE (hard rule 7) and nothing
  here is on mainnet. It is not acceptable in production, and nobody may say on camera
  that only certified reviewers can see the work.
- **The brief's Known limits gains a clause.** The content-availability bullet says the
  store is centralized behind one vendor; it now also says the content is readable by
  anyone holding the hash. In anything public that bullet wins over this file.
- **`PUT` cannot overwrite anything with different content.** The path hash must equal
  the sha-256 of the body, so a writer can only store bytes that already are what they
  claim to be, and storing the same bytes twice is a no-op. What it does not stop is
  somebody filling the bucket with hash-valid noise, which is why a request is capped at
  256KB — notes are a few kilobytes. Rate limiting is not built.
- **A hash mismatch is a 502, not a 404.** Bytes that do not hash to their on-chain
  commitment are never handed over: `readVerifiedByHash` in `packages/content` already
  refuses them, and the endpoint reports the refusal rather than pretending the object is
  missing.
- `apps/mcp/src/content.ts`'s port gains `get`. `apps/web/CLAUDE.md`'s "open ask to
  P1/P2" paragraph is answered and should name the route.
- The signed-URL path stays built and unused: `getSignedUrl` and
  `assertSignedUrlTtlSufficient` are in `packages/content` and are what production would
  reach for, per `2026-09-07-notes-read-lives-in-content-package.md`.

**Nasaa holds scope-cut authority.** This is a product fact about what the demo discloses,
not only a plumbing choice, so it is written here rather than left in a code comment. If
the answer is no, the fallback is that the expert app reads nothing and the document is
shown from the requester's own copy.

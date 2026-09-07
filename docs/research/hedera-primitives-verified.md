# Hedera primitives, verified against the docs

Pulled from `docs.hedera.com` through the `hedera-docs` MCP server on 2026-09-05.
Conclusions only. Confirm the first one empirically in P1's spike before building on it.

## Schedule Service: the payee must be known at ScheduleCreate

**ScheduleCreate carries a `scheduledTransactionBody`, a fully formed inner
transaction.** The tutorial is explicit: build the transaction you want to schedule
*before* creating the schedule. There is no placeholder recipient.

**This answers the brief's first open decision. Variant B wins: schedule at claim.**
Funds lock at `POSTED` and the payee-less envelope publishes, but `ScheduleCreate` waits
until a claim resolves the expert's account. The post-to-claim window is protected by the
escrow threshold key alone, which is trusted-platform and gets admitted out loud.

Other mechanics that shape our design:

- **`adminKey` is optional and we need it.** Without it the schedule is immutable and
  `ScheduleDelete` is impossible, which would kill both the claim-timeout path and the
  violation clawback. Set it, and it is the schedule-admin key.
- **`waitForExpiry` defaults to false**, meaning the schedule executes the moment
  signatures satisfy the requirement. That *is* our early-execute. We do not need a
  separate mechanism.
- **Expiry.** The protobuf reference says a schedule's expiration is always 30 minutes.
  The core-concepts page documents a settable `expirationTime` up to 62 days. Treat the
  30-minute line as the legacy default and verify which applies on testnet, because the
  order deadline depends on it.
- **`IDENTICAL_SCHEDULE_ALREADY_CREATED` returns the existing `ScheduleID`.** That is an
  idempotency primitive handed to us for free. Our "never double-pay" requirement can
  lean on it rather than on our own bookkeeping.
- Watch for `UNRESOLVABLE_REQUIRED_SIGNERS` and `SCHEDULE_ALREADY_DELETED` in the
  retry path.

## HCS: 1024 bytes per message, 6 KB per transaction

Message max is **1024 bytes**. Max transaction size including signatures is **6 KB**.
The SDK will chunk automatically, default chunk size 1024 and max 20 chunks, but a
chunked attestation is a worse artifact than a bounded one. **Keep the attestation inside
one message** and let the `defects[]` bound in the schema package enforce it.

**Topic `submitKey` decides who may write, and we want different answers per topic.**

| Topic | submitKey | Why |
|---|---|---|
| Orders and attestations | **None** | Experts submit from their own accounts. A submit key would put us in the signing path and break the whole point |
| Registry | **Set** | Only the platform adds, removes or grants a cert tag |

If `submitKey` is unspecified, anyone can submit. That is the correct choice for the
attestation topic and the wrong one for the registry.

## Mirror node: the endpoints we actually need

```
GET /api/v1/topics/{topicId}/messages
GET /api/v1/topics/{topicId}/messages/{sequenceNumber}
GET /api/v1/topics/messages/{consensusTimestamp}
GET /api/v1/transactions/{id}
```

Base URL `https://testnet.mirrornode.hedera.com`. Read-only, no auth, no fees.

- Messages come back **base64 by default**. Pass `encoding=utf-8` for plaintext.
- `limit` defaults to **25**, `order` is `asc` by default, and `timestamp` accepts
  comparison operators. Paginate through `links.next`.
- Each message carries `consensus_timestamp` and `sequence_number`, which is what
  resolves the claim race.
- **Hedera's own tutorial sleeps 6 seconds** before querying the mirror node after a
  submit. Design the expert app for that, and do not put a Hashscan link on the critical
  path of a 90-second demo.
- There is also a `/api/v1/schedules` family for scheduled-transaction state.
  `GET /api/v1/schedules/{id}` returns `executed_timestamp` (null until the schedule
  fires) and `deleted`, which is the settlement read the expert app wants.
- **The SDK and the REST API spell a transaction id differently.** The SDK prints
  `0.0.1234@1700000000.123456789`; the REST path needs `0.0.1234-1700000000-123456789`.
  Hashscan accepts either in `/testnet/transaction/…`. Verified in the docs 2026-09-05.
- **A scheduled transaction's id is the ScheduleCreate's id with the `scheduled` flag
  set**, and its consensus timestamp is the triggering ScheduleSign's plus one
  nanosecond. Read it with `GET /api/v1/transactions/{id}?scheduled=true`. That is how
  a payout is found from the schedule that created it.

## Threshold keys: one constructor

JavaScript SDK, for our 2-of-3 escrow:

```js
const escrowKey = new KeyList([verifierPub, adminPub, requesterPub], 2);
```

`KeyList` with no threshold is M-of-M. With a threshold it is N-of-M. Keys may be Ed25519
or ECDSA and structures nest. Note the x402 signer is a separate concern and must be
ECDSA; the escrow key list does not have to be.

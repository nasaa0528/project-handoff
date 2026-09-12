import { describe, expect, it } from "vitest";
import {
  encodeAttestation,
  encodeClaim,
  encodeEnvelope,
  MockChainAdapter,
  SCHEMA_VERSION,
  sha256Hex,
  utcToEpochSeconds,
} from "@handoff/schema";
import { readOrderStatus, type StatusDeps } from "./status.js";

const ORDERS = "0.0.orders";
const ATTESTATIONS = "0.0.attestations";

const HASH = sha256Hex("FAKE report");

/** Far enough out that the wall clock never drifts past it during a run. */
const DEADLINE = "2099-01-01T00:00:00Z";
const CLAIM_TIMEOUT_SECONDS = 3600;

function envelope(orderId: string): string {
  return encodeEnvelope({
    order_id: orderId,
    class: "review",
    spec_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    price_tinybars: "10000000000",
    deadline: DEADLINE,
    claim_timeout_seconds: CLAIM_TIMEOUT_SECONDS,
    schema_version: SCHEMA_VERSION,
  });
}

function claim(orderId: string, certTag = "cpa-us"): string {
  return encodeClaim({
    kind: "claim",
    order_id: orderId,
    cert_tag: certTag,
    schema_version: SCHEMA_VERSION,
  });
}

function attestation(orderId: string, verdict: string): string {
  return encodeAttestation({
    order_id: orderId,
    class: "review",
    verdict,
    defects: ["NO_MONITORING"],
    notes_hash: HASH,
    artifact_hash_in: HASH,
    cert_tag: "cpa-us",
    schema_version: SCHEMA_VERSION,
  });
}

function deps(chain: MockChainAdapter, overrides: Partial<StatusDeps> = {}): StatusDeps {
  return { chain, ordersTopicId: ORDERS, attestationsTopicId: ATTESTATIONS, ...overrides };
}

describe("readOrderStatus", () => {
  it("finds a posted order and carries its consensus timestamp", async () => {
    const chain = new MockChainAdapter();
    const submitted = await chain.submitMessage(ORDERS, envelope("ord_1"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("POSTED");
    expect(status.postedAt).toBe(submitted.consensusTimestamp);
    expect(status.envelope?.cert_tag).toBe("cpa-us");
  });

  it("reports DELIVERED with the verdict and who signed once an attestation lands", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    const signed = await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "reject"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("DELIVERED");
    expect(status.verdict).toBe("reject");
    expect(status.signedAt).toBe(signed.consensusTimestamp);
    // The account that paid to submit the attestation is the expert's own.
    expect(status.signedBy).toBeTruthy();
  });

  it("answers UNKNOWN rather than guessing an order does not exist", async () => {
    const chain = new MockChainAdapter();

    const status = await readOrderStatus("ord_missing", deps(chain));

    // A mirror node runs about six seconds behind consensus, so a freshly
    // posted order reads this way and "it does not exist" would be a guess.
    expect(status.state).toBe("UNKNOWN");
    expect(status.envelope).toBeUndefined();
  });

  it("says POSTED means nobody has taken it, because claims are readable", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));

    const status = await readOrderStatus("ord_1", deps(chain));

    // The server reads claims off the orders topic now. Were this false, a
    // screen would have to say "we cannot see claims" rather than "open".
    expect(status.claimReadable).toBe(true);
    expect(status.state).toBe("POSTED");
    expect(status.claimedBy).toBeUndefined();
  });

  it("reports CLAIMED with the claimant and the window they must sign in", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    // Published from the claimant's own account: the payer is the claimant,
    // never a field in the body.
    const claimed = await chain.publishClaim(ORDERS, "0.0.expert", claim("ord_1"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("CLAIMED");
    expect(status.claimedBy).toBe("0.0.expert");
    expect(status.claimedAt).toBe(claimed.consensusTimestamp);
    // Claim timeout, capped at the order deadline. This order's deadline is
    // years out, so the timeout is what binds.
    const signBy = utcToEpochSeconds(status.signBy ?? "");
    const claimedAtSeconds = Number(claimed.consensusTimestamp.split(".")[0]);
    expect(signBy).toBe(claimedAtSeconds + CLAIM_TIMEOUT_SECONDS);
  });

  it("gives the order to the first claim by consensus timestamp, not the last", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.publishClaim(ORDERS, "0.0.first", claim("ord_1"));
    await chain.publishClaim(ORDERS, "0.0.second", claim("ord_1"));

    // The loser of a claim race is ignored while the winner's window is open.
    expect((await readOrderStatus("ord_1", deps(chain))).claimedBy).toBe("0.0.first");
  });

  it("reads a claim whose window ran out as open again", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    const claimed = await chain.publishClaim(ORDERS, "0.0.idle", claim("ord_1"));

    const afterExpiry =
      Number(claimed.consensusTimestamp.split(".")[0]) + CLAIM_TIMEOUT_SECONDS + 1;
    const status = await readOrderStatus("ord_1", deps(chain, { nowEpochSeconds: afterExpiry }));

    // Claim timeout reopens the order once. POSTED is what the topics say.
    expect(status.state).toBe("POSTED");
    expect(status.claimedBy).toBeUndefined();
  });

  it("ignores a claim made under a cert tag the order did not ask for", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.publishClaim(ORDERS, "0.0.wrong", claim("ord_1", "pe-us"));

    // Readers drop it; the network never rejected it. Same rule both ends.
    expect((await readOrderStatus("ord_1", deps(chain))).state).toBe("POSTED");
  });

  it("ignores a claim for a different order sharing the topic", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.publishClaim(ORDERS, "0.0.other", claim("ord_2"));

    expect((await readOrderStatus("ord_1", deps(chain))).state).toBe("POSTED");
  });

  it("carries the claimant alongside the signer once a verdict lands", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.publishClaim(ORDERS, "0.0.expert", claim("ord_1"));
    await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "approve"));

    const status = await readOrderStatus("ord_1", deps(chain));

    expect(status.state).toBe("DELIVERED");
    // The attestations topic carries no submit key, so who signed and who held
    // the claim are two separate facts and a requester gets to see both.
    expect(status.claimedBy).toBe("0.0.expert");
    expect(status.signedBy).toBeTruthy();
  });

  it("keeps a delivered claim from expiring", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    const claimed = await chain.publishClaim(ORDERS, "0.0.expert", claim("ord_1"));
    // From the claimant's own account, which is what an attestation is: the
    // expert pays to submit it. A message from anybody else no longer keeps a
    // claim alive, so a fixture that used the default payer was testing a
    // stranger's message rather than the expert's.
    await chain.publishClaim(ATTESTATIONS, "0.0.expert", attestation("ord_1", "approve"));

    const afterExpiry =
      Number(claimed.consensusTimestamp.split(".")[0]) + CLAIM_TIMEOUT_SECONDS + 1;
    const status = await readOrderStatus("ord_1", deps(chain, { nowEpochSeconds: afterExpiry }));

    // A verdict signed inside the window does not stop being that verdict
    // because the clock later passed the deadline.
    expect(status.state).toBe("DELIVERED");
    expect(status.claimedBy).toBe("0.0.expert");
  });

  it("walks past the first page, which is where the newest orders are", async () => {
    const chain = new MockChainAdapter();
    for (let i = 1; i <= 30; i += 1) {
      await chain.submitMessage(ORDERS, envelope(`ord_${i}`));
    }

    // A mirror node returns 25 by default and paginates through links.next. A
    // reader that stops at one page silently stops finding the newest orders,
    // which are exactly the ones anyone is asking about.
    const status = await readOrderStatus("ord_30", deps(chain, { pageSize: 25 }));

    expect(status.state).toBe("POSTED");
    expect(status.envelope?.order_id).toBe("ord_30");
  });

  it("ignores unparseable messages instead of failing the query", async () => {
    const chain = new MockChainAdapter();
    // Orders and attestations topics carry no submit key, on purpose, so
    // anybody can put anything on them. Noise is ordinary, not an error.
    await chain.submitMessage(ORDERS, "not json at all");
    await chain.submitMessage(ORDERS, JSON.stringify({ order_id: "ord_1" }));
    await chain.submitMessage(ORDERS, envelope("ord_1"));

    expect((await readOrderStatus("ord_1", deps(chain))).state).toBe("POSTED");
  });

  it("takes the later attestation when an order has more than one", async () => {
    const chain = new MockChainAdapter();
    await chain.submitMessage(ORDERS, envelope("ord_1"));
    await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "approve"));
    await chain.submitMessage(ATTESTATIONS, attestation("ord_1", "reject"));

    // Consensus order is the truth, so the last one wins.
    expect((await readOrderStatus("ord_1", deps(chain))).verdict).toBe("reject");
  });
});

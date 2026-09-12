/**
 * Settle one order against a running resource server.
 *
 * The escrow release is an explicit call, so somebody has to make it. The
 * expert app is where it belongs on the product path — the sign action
 * publishes the attestation and then asks for the payout — and that is P3's
 * lane. This is the caller that exists in the meantime, and it is what the
 * demo uses until the app calls it itself.
 *
 *   pnpm --filter @handoff/mcp settle ord_abc123
 *
 * Points at HANDOFF_SERVICE_URL, defaulting to the local server. Retries only
 * when the server says the refusal is retryable, which it does while the
 * mirror node is still catching up with a freshly published attestation — and
 * never on a violation, which never becomes payable.
 */

const RETRY_DELAY_MS = 6000;
const MAX_ATTEMPTS = 6;

async function main(): Promise<void> {
  const orderId = process.argv[2]?.trim();
  if (!orderId) {
    console.error("usage: pnpm --filter @handoff/mcp settle <order_id>");
    process.exit(2);
  }

  const base = process.env["HANDOFF_SERVICE_URL"]?.trim() || "http://localhost:4021";
  const url = `${base}/orders/${encodeURIComponent(orderId)}/settle`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, { method: "POST" });
    const body = (await response.json()) as Record<string, unknown>;

    if (response.ok) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    if (response.status === 409 && body["retryable"] === true) {
      console.error(`[${attempt}/${MAX_ATTEMPTS}] ${String(body["message"])}`);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
    }

    // A violation, or anything else. Never retried: repeating a refusal that
    // will not change is how a script turns a clear answer into a hang.
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }
}

await main();

/**
 * Does this Hedera account actually exist?
 *
 * The account id is the identity, so registering one that does not exist creates a
 * row nothing can ever attach to — a typo becomes a permanent orphan holding a
 * username. One mirror-node read at registration catches that.
 *
 * **This is an existence check, not proof of control.** It says the account is
 * real; it says nothing about whether the person registering holds its key. That
 * distinction is written out in this package's CLAUDE.md, and it is why nothing
 * that spends money may treat a row here as authority.
 *
 * No Hedera SDK import — the mirror node is a plain REST API, and the repo layout
 * rule keeps the SDK inside `packages/chain`.
 */

/**
 * `unknown` is a third answer, and collapsing it into either of the other two is
 * the bug this type exists to prevent.
 */
export type AccountExistence = "exists" | "missing" | "unknown";

export type AccountExistenceCheck = (hederaAccountId: string) => Promise<AccountExistence>;

/** Hard rule 5. A mainnet mirror must not be reachable from this build at all. */
export class MainnetForbiddenError extends Error {
  constructor(url: string) {
    super(
      `refusing a mainnet mirror node (${url}). This project is testnet-only — hard rule 5 — ` +
        `and an account existence check against mainnet would be reading real money's ledger.`,
    );
    this.name = "MainnetForbiddenError";
  }
}

/**
 * Five seconds. The caller is a user waiting on a registration form, and a mirror
 * node that has not answered in five seconds is not going to save this request.
 */
const MIRROR_TIMEOUT_MS = 5_000;

export function mirrorAccountCheck(
  mirrorNodeUrl: string,
  fetchImpl: typeof fetch = fetch,
): AccountExistenceCheck {
  const base = mirrorNodeUrl.replace(/\/+$/, "");

  // Checked once, when the checker is built, rather than on every call: a
  // misconfiguration should stop the process at boot, not produce one failed
  // registration whose error nobody reads.
  let host: string;
  try {
    host = new URL(base).host.toLowerCase();
  } catch {
    throw new Error(`HEDERA_MIRROR_NODE_URL is not a URL: ${mirrorNodeUrl}`);
  }
  if (host === "mainnet.mirrornode.hedera.com" || host.includes("mainnet")) {
    throw new MainnetForbiddenError(mirrorNodeUrl);
  }

  return async (hederaAccountId: string): Promise<AccountExistence> => {
    let response: Response;
    try {
      response = await fetchImpl(`${base}/accounts/${hederaAccountId}?transactions=false`, {
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
      });
    } catch {
      // Being unable to check is not evidence of anything. This mirrors
      // `assertOperatorKeyMatches` in @handoff/chain, which also declines to fail
      // closed on a mirror outage — refusing every registration because a
      // third-party read timed out is a worse failure than the one it prevents.
      return "unknown";
    }

    if (response.status === 404) return "missing";
    if (!response.ok) return "unknown";

    // A 200 whose body names a *different* account would mean the mirror resolved
    // an alias or a checksum form. The registration key must be the id we asked
    // for, so anything else is not a match.
    try {
      const body = (await response.json()) as { account?: unknown; deleted?: unknown };
      if (body.deleted === true) return "missing";
      if (typeof body.account === "string" && body.account !== hederaAccountId) return "missing";
    } catch {
      return "unknown";
    }

    return "exists";
  };
}

/** Accepts everything. For tests and for running with no mirror configured. */
export const skipAccountCheck: AccountExistenceCheck = async () => "unknown";

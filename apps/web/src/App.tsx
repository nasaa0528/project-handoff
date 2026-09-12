import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountsClient } from "@handoff/accounts-client";
import { parseAccountId } from "./session/accountId";
import { browserAccount } from "./session/remembered";
import { createWebChain, type WebChain } from "./chain/adapter";
import { configFromEnv, DEFAULT_MIRROR_NODE_URL, type WebChainConfig } from "./chain/config";
import { MockOrderSource } from "./chain/mockOrders";
import { FAKE_CERT_TAG, MockPlatform, withSimulatedMirrorLag } from "./chain/mockPlatform";
import { TestnetOrderSource } from "./chain/testnetOrders";
import { ClaimDialog } from "./components/ClaimDialog";
import { MoneyUnitProvider } from "./components/Money";
import { NewRequestDialog } from "./components/NewRequestDialog";
import { Shell, type ExpertIdentity } from "./components/Shell";
import { browserDrafts } from "./lib/draft";
import { useNow } from "./lib/useNow";
import type { ExpertOrder, InboxEntry } from "./orders/order";
import type { OrderSource } from "./orders/source";
import { useClaimFlow } from "./orders/useClaimFlow";
import { draftProblems, emptyDraft, requestQuote, type QuoteOutcome, type RequestDraft } from "./requests/create";
import { useMyRequests, type MyRequestsWiring } from "./requests/useMyRequests";
import { useRoute, type Route } from "./router";
import { AuthFlow, type AuthStart } from "./screens/auth/AuthFlow";
import { ConnectScreen, type ConnectOutcome } from "./screens/ConnectScreen";
import { describeAccountsError, type AccountsSession } from "./session/accounts";
import { InboxScreen } from "./screens/InboxScreen";
import { MyRequestsScreen } from "./screens/MyRequestsScreen";
import { OrderScreen } from "./screens/OrderScreen";
import { WorkspaceScreen } from "./screens/WorkspaceScreen";
import { describeConnectError, type ExpertConnection } from "./session/connect";
import { mirrorPayoutLocator } from "./sign/payoutLocator";
import { describeError } from "./sign/runSign";
import { MIRROR_EXPECTED_LAG_MS } from "./sign/settlement";
import { useSignFlow, type SignFlowDeps } from "./sign/useSignFlow";

/**
 * Everything the screens need, resolved once per connection.
 *
 * In mock mode the app also plays the requesters who post orders, the rival
 * expert who claims some of them, and the platform that releases payment,
 * because there is nobody else to. On testnet all three are real and absent
 * from here: orders come off the topic, and payment is read from the
 * network rather than triggered.
 */
interface Booted {
  readonly config: WebChainConfig;
  readonly chain: WebChain;
  readonly identity: ExpertIdentity;
  readonly source: OrderSource;
  readonly deps: SignFlowDeps;
}

/**
 * The app is a short state machine: connect, then the funnel, then back to
 * connect on disconnect. Drafts persist in the browser; the connection does
 * not, so a reload is also a disconnect.
 */
type AppState =
  | { kind: "connect"; notice: string | null }
  /** The email flow: register, confirm the mailbox, or both. */
  | { kind: "auth"; start: AuthStart }
  /** Signed in by email on testnet; the key is still to be pasted. */
  | { kind: "key"; session: AccountsSession; notice: string | null }
  | { kind: "ready"; booted: Booted; session: AccountsSession | null };

async function boot(config: WebChainConfig, connection: ExpertConnection): Promise<Booted> {
  const chain = createWebChain(config, connection);

  if (config.mode === "testnet" && chain.mode === "testnet") {
    // The real thing: orders and claims off the topic through the expert's
    // own chain, the ask and the document from the content store, and the
    // payout found by a mirror read of the expert's transfers since the
    // verdict. Nobody stands in for anybody. Credential pills wait for the
    // registry (NAS-27); until then there is nothing honest to show there.
    const source = new TestnetOrderSource({
      chain: chain.chain,
      content: chain.content,
      ordersTopicId: config.ordersTopicId,
      escrowAccountId: config.escrowAccountId,
      expertAccountId: chain.expertAccountId,
    });
    return {
      config,
      chain,
      identity: { accountId: chain.expertAccountId, credentials: [] },
      source,
      deps: {
        chain,
        reader: chain.chain,
        locatePayout: (o, signed) =>
          mirrorPayoutLocator({
            mirrorNodeUrl: config.mirrorNodeUrl,
            expertAccountId: chain.expertAccountId,
            escrowAccountId: config.escrowAccountId,
            amountTinybars: o.envelope.price_tinybars,
            notBefore: signed.consensusTimestamp,
          }),
      },
    };
  }

  if (config.mode !== "mock" || chain.mode !== "mock") {
    // createWebChain refuses a mode mismatch before this, so this is a type
    // narrowing, not a path.
    throw new Error("The configuration and the connection disagree about the chain.");
  }

  const platform = new MockPlatform(chain.mock, chain.expertAccountId);
  const source = await MockOrderSource.seed(chain.mock, chain.content, {
    expertAccountId: chain.expertAccountId,
    ordersTopicId: config.ordersTopicId,
    requesterAccountId: config.mock.requesterAccountId,
    priceHbar: config.mock.priceHbar,
    mirrorLagMs: MIRROR_EXPECTED_LAG_MS,
  });

  return {
    config,
    chain,
    identity: { accountId: chain.expertAccountId, credentials: [FAKE_CERT_TAG] },
    source,
    deps: {
      chain,
      reader: withSimulatedMirrorLag(chain.mock, MIRROR_EXPECTED_LAG_MS),
      locatePayout: (o) => platform.locator(o.envelope.order_id),
      afterPublish: async (o) => {
        await platform.releasePayment(o);
      },
    },
  };
}

type Config = { readonly ok: true; readonly config: WebChainConfig } | { readonly ok: false; readonly message: string };

function readConfig(): Config {
  try {
    return { ok: true, config: configFromEnv(import.meta.env) };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export function App() {
  const config = useMemo(readConfig, []);
  const [state, setState] = useState<AppState>({ kind: "connect", notice: null });
  // Public, so a reload may keep it. The key is never kept; see session/remembered.ts.
  const remembered = useMemo(() => browserAccount.load(), []);
  const autoConnected = useRef(false);
  // The email side. Null when no accounts API is configured, and then the
  // screen offers the key path only. Holds no state: the session lives here.
  const accounts = useMemo(
    () => (config.ok && config.config.accountsApiUrl !== null ? new AccountsClient({ baseUrl: config.config.accountsApiUrl }) : null),
    [config],
  );

  // Mock mode has no key, so a remembered account reconnects on its own and a
  // refresh is never a loss. Testnet asks for the key again, by design.
  useEffect(() => {
    if (!config.ok || config.config.mode !== "mock" || remembered === null || autoConnected.current) return;
    autoConnected.current = true;
    const mode = config.config;
    void boot(mode, { mode: "mock", accountId: remembered }).then(
      (booted) => setState((current) => (current.kind === "connect" ? { kind: "ready", booted, session: null } : current)),
      () => browserAccount.forget(),
    );
  }, [config, remembered]);

  if (!config.ok) {
    return (
      <main className="mx-auto grid max-w-3xl gap-2 px-4 py-8">
        <h1 className="text-lg font-semibold">The expert app cannot start</h1>
        <p className="text-sm text-muted-foreground">{config.message}</p>
      </main>
    );
  }

  const mode = config.config;
  const credential = mode.mode === "mock" ? { label: "Demo reviewer", tag: FAKE_CERT_TAG } : null;

  /**
   * A session is who is at the keyboard. On the mock there is no key, so it
   * boots straight away; on testnet the key is one more screen. The session
   * rides along into the ready state so disconnect can end it server-side.
   */
  const afterSignIn = async (session: AccountsSession): Promise<ConnectOutcome> => {
    const accountId = session.account.hederaAccountId;
    if (mode.mode === "testnet") {
      setState({ kind: "key", session, notice: null });
      return { ok: true };
    }
    try {
      const booted = await boot(mode, { mode: "mock", accountId });
      browserAccount.save(accountId);
      setState({ kind: "ready", booted, session });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: describeConnectError(error, accountId) };
    }
  };

  if (state.kind === "auth" && accounts !== null) {
    return (
      <AuthFlow
        mode={mode.mode}
        accounts={accounts}
        start={state.start}
        onSignedIn={(session) => void afterSignIn(session)}
        onCancel={() => setState({ kind: "connect", notice: null })}
        onBringKey={() => setState({ kind: "connect", notice: null })}
      />
    );
  }

  if (state.kind === "connect" || state.kind === "key" || state.kind === "auth") {
    const session = state.kind === "key" ? state.session : null;
    const connect = async (connection: ExpertConnection): Promise<ConnectOutcome> => {
      try {
        const booted = await boot(mode, connection);
        browserAccount.save(connection.accountId);
        setState({ kind: "ready", booted, session });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeConnectError(error, connection.accountId) };
      }
    };
    const email =
      accounts === null
        ? null
        : {
            onSubmit: async (identifier: string, password: string): Promise<ConnectOutcome> => {
              try {
                const signedIn = await accounts.signIn(identifier, password);
                return afterSignIn(signedIn);
              } catch (error) {
                const failure = describeAccountsError(error);
                if (failure.needsVerification) {
                  // The password was right. The mailbox is not confirmed; that is a screen, not an error.
                  const id = parseAccountIdOrNull(identifier);
                  setState({
                    kind: "auth",
                    start: { kind: "verify", identifier, password, hederaAccountId: id, email: id === null ? identifier : null },
                  });
                  return { ok: true };
                }
                return { ok: false, message: failure.message };
              }
            },
            onCreateAccount: () => setState({ kind: "auth", start: { kind: "register" } }),
          };
    return (
      <ConnectScreen
        // The key step is a different screen with the same fields; a fresh mount clears the form.
        key={state.kind}
        mode={mode.mode}
        prefill={session === null ? (remembered ?? mode.expertAccountIdPrefill) : session.account.hederaAccountId}
        notice={state.kind === "auth" ? null : state.notice}
        onConnect={connect}
        credential={credential}
        email={email}
        locked={session !== null}
        onBack={session === null ? undefined : () => setState({ kind: "connect", notice: null })}
      />
    );
  }

  return (
    <Ready
      booted={state.booted}
      onDisconnect={() => {
        state.booted.chain.disconnect();
        browserAccount.forget();
        // Best effort, and idempotent server-side. The token dies with this state either way.
        if (state.session !== null && accounts !== null) void accounts.signOut(state.session.token).catch(() => {});
        setState({
          kind: "connect",
          notice: "Disconnected. A verdict you published stays published, and your unsigned notes are kept.",
        });
      }}
    />
  );
}

/** For routing an unconfirmed sign-in: the identifier, when it was the account id. */
function parseAccountIdOrNull(identifier: string): string | null {
  const parsed = parseAccountId(identifier.trim());
  return parsed.ok ? parsed.accountId : null;
}

/** How often the inbox re-reads the topic, so a claim by someone else shows up. */
const INBOX_REFRESH_MS = 5_000;

function Ready({ booted, onDisconnect }: { booted: Booted; onDisconnect: () => void }) {
  const [route, navigate] = useRoute();
  const now = useNow();
  const deps = useMemo(() => booted.deps, [booted]);
  const signFlow = useSignFlow(deps);
  const claimFlow = useClaimFlow(booted.source, booted.identity.accountId);

  const [entries, setEntries] = useState<readonly InboxEntry[] | null>(null);
  const [documents, setDocuments] = useState<ReadonlyMap<string, string>>(new Map());

  // The requester's side of the same account. Only testnet has one: the
  // reads are of real payments into a real escrow, and the mock has neither,
  // so mock mode gets an honest empty screen rather than fabricated rows.
  const requestsWiring = useMemo<MyRequestsWiring | null>(
    () =>
      booted.config.mode === "testnet"
        ? {
            mirrorNodeUrl: booted.config.mirrorNodeUrl,
            apiUrl: booted.config.apiUrl,
            requesterAccountId: booted.identity.accountId,
            escrowAccountId: booted.config.escrowAccountId,
          }
        : null,
    [booted.config, booted.identity.accountId],
  );
  const requests = useMyRequests(route.kind === "requests" ? requestsWiring : null);

  const [draft, setDraft] = useState<RequestDraft>(() => emptyDraft(new Date()));
  const [composing, setComposing] = useState(false);
  const [quote, setQuote] = useState<QuoteOutcome | null>(null);
  const [quoting, setQuoting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await booted.source.list());
    } catch {
      // A failed read is "not yet". The last good list stays on screen.
    }
  }, [booted.source]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), INBOX_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const entryFor = (orderId: string): InboxEntry | undefined =>
    entries?.find((e) => e.order.envelope.order_id === orderId);

  // A claim the flow just confirmed as ours, before the next inbox read
  // catches up. The workspace may open on this and on nothing less.
  const confirmed =
    claimFlow.status.kind === "decided" &&
    claimFlow.status.confirmation.phase === "yours" &&
    claimFlow.status.confirmation.state?.kind === "yours"
      ? claimFlow.status.confirmation.state
      : null;

  const claimStateOf = (entry: InboxEntry) => (confirmed !== null && claimedOrder.current === entry.order.envelope.order_id ? confirmed : entry.claim);

  const claimedOrder = useRef<string | null>(null);
  // Which order the claim dialog is reporting on. Null when nothing is in flight.
  const [claiming, setClaiming] = useState<ExpertOrder | null>(null);
  const claim = useCallback(
    async (order: ExpertOrder) => {
      claimedOrder.current = order.envelope.order_id;
      setClaiming(order);
      await claimFlow.claim(order);
    },
    [claimFlow],
  );
  const flowForScreen = useMemo(() => ({ ...claimFlow, claim }), [claimFlow, claim]);

  // Prefetch the document the moment a claim confirms, so the workspace
  // opens with the paper already there; and open it.
  useEffect(() => {
    if (confirmed === null || claimedOrder.current === null) return;
    const orderId = claimedOrder.current;
    const entry = entryFor(orderId);
    if (entry === undefined) return;
    void refresh();
    booted.source.document(entry.order).then(
      (text) => setDocuments((m) => new Map(m).set(orderId, text)),
      () => {
        // The workspace shows its skeleton and the next read tries again.
      },
    );
    // Claimed from the order screen: go straight through. Claimed from the
    // inbox: the dialog says so and its own button opens the workspace.
    if (route.kind === "order") navigate({ kind: "workspace", orderId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  // A workspace reached by URL for an order the topic says is ours: fetch the document.
  useEffect(() => {
    if (route.kind !== "workspace") return;
    const entry = entryFor(route.orderId);
    if (entry === undefined || claimStateOf(entry).kind !== "yours" || documents.has(route.orderId)) return;
    booted.source.document(entry.order).then(
      (text) => setDocuments((m) => new Map(m).set(route.orderId, text)),
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, entries]);

  // The rate is a public, key-free read of Hedera's own fee rate. The mock
  // fabricates ids, not exchange rates, so it reads the same place.
  const mirrorNodeUrl = booted.config.mode === "testnet" ? booted.config.mirrorNodeUrl : DEFAULT_MIRROR_NODE_URL;
  const held = signFlow.status.kind === "signing" || claimFlow.status.kind === "confirming";
  const body = renderRoute();
  const openCount = entries === null ? null : entries.filter((e) => e.claim.kind === "open" || e.claim.kind === "yours").length;

  return (
    // The rate wraps the whole frame: the navbar shows a balance too, and an
    // amount outside the provider cannot switch units.
    <MoneyUnitProvider mirrorNodeUrl={mirrorNodeUrl}>
      <Shell
        mode={booted.config.mode}
        identity={booted.identity}
        onDisconnect={onDisconnect}
        disconnectHeld={held}
        wide={route.kind === "workspace"}
        openCount={openCount}
        active={route.kind === "requests" ? "requests" : "inbox"}
        onInbox={() => navigate({ kind: "inbox" })}
        onRequests={() => navigate({ kind: "requests" })}
      >
        {body}
        <ClaimDialog
          order={claiming}
          flow={flowForScreen}
          now={now}
          onOpenWorkspace={() => {
            const orderId = claiming?.envelope.order_id;
            setClaiming(null);
            if (orderId !== undefined) navigate({ kind: "workspace", orderId });
          }}
          onClose={() => setClaiming(null)}
        />
        <NewRequestDialog
          open={composing}
          onOpenChange={(next) => {
            if (!next && !quoting) closeCompose();
          }}
          draft={draft}
          onDraft={setDraft}
          tags={requests.tags}
          problems={draftProblems(draft, now)}
          outcome={quote}
          busy={quoting}
          onQuote={() => void askForPrice()}
          onClose={closeCompose}
        />
      </Shell>
    </MoneyUnitProvider>
  );

  function closeCompose() {
    setComposing(false);
    // The quote is dropped with the panel: an order id the service minted and
    // nobody paid for is not a thing to keep on screen, and the next ask
    // mints a fresh one. The typed draft stays, so reopening resumes it.
    setQuote(null);
  }

  async function askForPrice() {
    if (requestsWiring === null) return;
    setQuoting(true);
    try {
      setQuote(
        await requestQuote({
          apiUrl: requestsWiring.apiUrl,
          draft,
          requesterAccountId: requestsWiring.requesterAccountId,
        }),
      );
    } finally {
      setQuoting(false);
    }
  }

  function renderRoute() {
    const go = (r: Route) => navigate(r);
    switch (route.kind) {
      case "requests":
        return (
          <MyRequestsScreen
            requests={requests.requests}
            statuses={requests.statuses}
            now={now}
            failure={requests.failure}
            live={requestsWiring !== null}
            onRefresh={requests.refresh}
            onNew={
              requestsWiring === null
                ? undefined
                : () => {
                    setQuote(null);
                    setComposing(true);
                  }
            }
          />
        );
      case "inbox":
        return (
          <InboxScreen
            entries={entries}
            now={now}
            onOpen={(orderId) => go({ kind: "order", orderId })}
            onResume={(orderId) => go({ kind: "workspace", orderId })}
            onClaim={(order) => void claim(order)}
            progress={(orderId) => {
              const kept = browserDrafts.load(orderId);
              return kept.notes.trim() === "" && kept.verdict === null && kept.issues.length === 0 ? "not-started" : "in-review";
            }}
          />
        );
      case "order": {
        const entry = entryFor(route.orderId);
        if (entries === null) return <InboxScreen entries={null} now={now} onOpen={() => {}} />;
        if (entry === undefined) return <Missing onBack={() => go({ kind: "inbox" })} />;
        return (
          <OrderScreen
            order={entry.order}
            claim={claimStateOf(entry)}
            flow={flowForScreen}
            now={now}
            onBack={() => go({ kind: "inbox" })}
            onOpenWorkspace={() => go({ kind: "workspace", orderId: route.orderId })}
          />
        );
      }
      case "workspace": {
        const entry = entryFor(route.orderId);
        if (entries === null) return <InboxScreen entries={null} now={now} onOpen={() => {}} />;
        if (entry === undefined) return <Missing onBack={() => go({ kind: "inbox" })} />;
        const claimState = claimStateOf(entry);
        if (claimState.kind !== "yours") {
          // The workspace opens only on a confirmed claim. Anything else is the order screen's to say.
          return (
            <OrderScreen
              order={entry.order}
              claim={claimState}
              flow={flowForScreen}
              now={now}
              onBack={() => go({ kind: "inbox" })}
              onOpenWorkspace={() => {}}
            />
          );
        }
        return (
          <WorkspaceScreen
            mode={booted.config.mode}
            identity={booted.identity}
            order={entry.order}
            signBy={claimState.signBy}
            artifactText={documents.get(route.orderId) ?? null}
            flow={signFlow}
            now={now}
            drafts={browserDrafts}
            onBackToInbox={() => go({ kind: "inbox" })}
          />
        );
      }
    }
  }
}

function Missing({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
      <p>No order with that id. It may have been posted for a credential you do not hold.</p>
      <button type="button" className="w-fit underline underline-offset-4" onClick={onBack}>
        Back to the inbox
      </button>
    </div>
  );
}

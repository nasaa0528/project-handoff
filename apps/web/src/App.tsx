import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browserAccount } from "./session/remembered";
import { createWebChain, type WebChain } from "./chain/adapter";
import { configFromEnv, type WebChainConfig } from "./chain/config";
import { MockOrderSource } from "./chain/mockOrders";
import { FAKE_CERT_TAG, MockPlatform, withSimulatedMirrorLag } from "./chain/mockPlatform";
import { TestnetOrderSource } from "./chain/testnetOrders";
import { Shell, type ExpertIdentity } from "./components/Shell";
import { browserDrafts } from "./lib/draft";
import { useNow } from "./lib/useNow";
import type { ExpertOrder, InboxEntry } from "./orders/order";
import type { OrderSource } from "./orders/source";
import { useClaimFlow } from "./orders/useClaimFlow";
import { useRoute, type Route } from "./router";
import { ConnectScreen, type ConnectOutcome } from "./screens/ConnectScreen";
import { InboxScreen } from "./screens/InboxScreen";
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
type AppState = { kind: "connect"; notice: string | null } | { kind: "ready"; booted: Booted };

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
      attestationsTopicId: config.attestationsTopicId,
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
    attestationsTopicId: config.attestationsTopicId,
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

  // Mock mode has no key, so a remembered account reconnects on its own and a
  // refresh is never a loss. Testnet asks for the key again, by design.
  useEffect(() => {
    if (!config.ok || config.config.mode !== "mock" || remembered === null || autoConnected.current) return;
    autoConnected.current = true;
    const mode = config.config;
    void boot(mode, { mode: "mock", accountId: remembered }).then(
      (booted) => setState((current) => (current.kind === "connect" ? { kind: "ready", booted } : current)),
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

  if (state.kind === "connect") {
    const connect = async (connection: ExpertConnection): Promise<ConnectOutcome> => {
      try {
        const booted = await boot(config.config, connection);
        browserAccount.save(connection.accountId);
        setState({ kind: "ready", booted });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeConnectError(error, connection.accountId) };
      }
    };
    return (
      <ConnectScreen
        mode={config.config.mode}
        prefill={remembered ?? config.config.expertAccountIdPrefill}
        notice={state.notice}
        onConnect={connect}
      />
    );
  }

  return (
    <Ready
      booted={state.booted}
      onDisconnect={() => {
        state.booted.chain.disconnect();
        browserAccount.forget();
        setState({
          kind: "connect",
          notice: "Disconnected. A verdict you published stays published, and your unsigned notes are kept.",
        });
      }}
    />
  );
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
  const claim = useCallback(
    async (order: ExpertOrder) => {
      claimedOrder.current = order.envelope.order_id;
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
    navigate({ kind: "workspace", orderId });
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

  const held = signFlow.status.kind === "signing" || claimFlow.status.kind === "confirming";
  const body = renderRoute();

  return (
    <Shell mode={booted.config.mode} identity={booted.identity} onDisconnect={onDisconnect} disconnectHeld={held} wide={route.kind === "workspace"}>
      {body}
    </Shell>
  );

  function renderRoute() {
    const go = (r: Route) => navigate(r);
    switch (route.kind) {
      case "inbox":
        return <InboxScreen entries={entries} now={now} onOpen={(orderId) => go({ kind: "order", orderId })} />;
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

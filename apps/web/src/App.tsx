import { useEffect, useMemo, useRef, useState } from "react";
import { createWebChain, type WebChain } from "./chain/adapter";
import { configFromEnv, type WebChainConfig } from "./chain/config";
import { FAKE_ARTIFACT, MockPlatform, seedClaimedReviewOrder, withSimulatedMirrorLag } from "./chain/mockPlatform";
import { SignScreen } from "./screens/SignScreen";
import { MIRROR_EXPECTED_LAG_MS } from "./sign/settlement";
import type { OrderForSigning } from "./sign/sign";
import { useSignFlow, type SignFlowDeps } from "./sign/useSignFlow";

/**
 * Everything the sign screen needs, resolved once at boot.
 *
 * In mock mode the app also plays the requester who posts the order and the
 * platform that releases payment, because there is nobody else to. On testnet
 * both are real and absent from here: the inbox hands over a claimed order,
 * and payment is read from the mirror node rather than triggered.
 */
interface Booted {
  readonly config: WebChainConfig;
  readonly chain: WebChain;
  readonly order: OrderForSigning;
  readonly artifactText: string | null;
  readonly deps: SignFlowDeps;
}

type Boot = { kind: "loading" } | { kind: "ready"; booted: Booted } | { kind: "error"; message: string };

async function boot(): Promise<Booted> {
  const config = configFromEnv(import.meta.env);
  const chain = createWebChain(config);

  // `createWebChain` throws on testnet until the cutover, so from here on the
  // mode is mock and the stand-ins are legitimate.
  const platform = new MockPlatform(chain.chain, config.expertAccountId);
  const order = await seedClaimedReviewOrder(chain.chain, {
    ordersTopicId: config.ordersTopicId,
    requesterAccountId: config.requesterAccountId,
    priceHbar: "200",
  });

  return {
    config,
    chain,
    order,
    artifactText: FAKE_ARTIFACT,
    deps: {
      chain,
      reader: withSimulatedMirrorLag(chain.chain, MIRROR_EXPECTED_LAG_MS),
      locatePayout: (o) => platform.locator(o.envelope.order_id),
      afterPublish: async (o) => {
        await platform.releasePayment(o);
      },
    },
  };
}

export function App() {
  const [state, setState] = useState<Boot>({ kind: "loading" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    boot().then(
      (booted) => setState({ kind: "ready", booted }),
      (error: unknown) =>
        setState({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
    );
  }, []);

  if (state.kind === "loading") {
    return <main className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">Loading…</main>;
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto grid max-w-3xl gap-2 px-4 py-8">
        <h1 className="text-lg font-semibold">The expert app cannot start</h1>
        <p className="text-sm text-muted-foreground">{state.message}</p>
      </main>
    );
  }

  return <Ready booted={state.booted} />;
}

function Ready({ booted }: { booted: Booted }) {
  const deps = useMemo(() => booted.deps, [booted]);
  const flow = useSignFlow(deps);
  return (
    <SignScreen
      mode={booted.config.mode}
      expertAccountId={booted.config.expertAccountId}
      order={booted.order}
      artifactText={booted.artifactText}
      flow={flow}
    />
  );
}

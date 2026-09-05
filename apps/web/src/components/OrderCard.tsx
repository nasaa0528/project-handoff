import { parseTinybars, tinybarsToDisplay } from "@handoff/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderForSigning } from "../sign/sign";
import { HashscanLink } from "./HashscanLink";
import { Mono, ShortHash } from "./Mono";

/** The claimed order, as the envelope states it. Hashes only, because that is all the chain has. */
export function OrderCard({ order, artifactText }: { order: OrderForSigning; artifactText: string | null }) {
  const { envelope } = order;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Order</CardTitle>
          <Badge variant="secondary">{envelope.class}</Badge>
          <Badge variant="outline">{envelope.cert_tag}</Badge>
          <Badge variant="outline">CLAIMED</Badge>
        </div>
        <CardDescription>
          <Mono>{envelope.order_id}</Mono>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[9rem_1fr] gap-y-2 gap-x-3">
          <dt className="text-muted-foreground">Order value</dt>
          <dd className="font-medium">{tinybarsToDisplay(parseTinybars(envelope.price_tinybars))}</dd>
          <dt className="text-muted-foreground">Held in escrow</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Mono>{order.escrowAccountId}</Mono>
            <HashscanLink kind="account" id={order.escrowAccountId} />
          </dd>
          <dt className="text-muted-foreground">Deadline</dt>
          <dd>
            <Mono>{envelope.deadline}</Mono>
          </dd>
          <dt className="text-muted-foreground">Artifact hash</dt>
          <dd>
            <ShortHash value={envelope.artifact_hash_in} />
          </dd>
          <dt className="text-muted-foreground">Spec hash</dt>
          <dd>
            <ShortHash value={envelope.spec_hash} />
          </dd>
        </dl>

        {artifactText !== null && (
          <details className="rounded-md border bg-muted/40 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Artifact under review <Badge variant="destructive" className="ml-2">FAKE</Badge>
            </summary>
            <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
              {artifactText}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

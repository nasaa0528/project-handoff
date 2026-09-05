import { hashscanAccountUrl, hashscanTransactionUrl } from "../sign/hashscan";

/**
 * Garnish. Renders nothing for a mock id, because mock ids 404 and must never
 * be on camera, and says out loud that Hashscan may lag behind the mirror
 * node the app actually reads.
 */
export function HashscanLink({ kind, id }: { kind: "transaction" | "account"; id: string }) {
  const href = kind === "transaction" ? hashscanTransactionUrl(id) : hashscanAccountUrl(id);
  if (href === null) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[0.6875rem] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
      title="Hashscan is a viewer. Its indexing can lag behind the mirror node this screen reads."
    >
      Hashscan ↗
    </a>
  );
}

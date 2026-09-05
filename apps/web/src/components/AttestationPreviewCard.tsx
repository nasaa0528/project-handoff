import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttestationPreview } from "../sign/preview";

function pretty(body: string): string {
  return JSON.stringify(JSON.parse(body), null, 2);
}

/**
 * The bytes that would go on the topic, and whether they fit one HCS
 * message. The size is of the canonical form, which is what is published;
 * the indentation below is for reading only.
 */
export function AttestationPreviewCard({ preview }: { preview: AttestationPreview }) {
  const ratio = Math.min(1, preview.bytes / preview.maxBytes);
  const fits = preview.body !== null && preview.bytes <= preview.maxBytes;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What goes on the ledger</CardTitle>
        <CardDescription>
          {preview.body === null
            ? "Nothing yet. Fix the problems below."
            : `${preview.bytes} of ${preview.maxBytes} bytes. ${fits ? "Fits one HCS message." : "Too large."}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={`h-full rounded-full ${fits ? "bg-foreground" : "bg-destructive"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        {preview.body !== null ? (
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {pretty(preview.body)}
          </pre>
        ) : (
          <ul className="text-sm text-destructive">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

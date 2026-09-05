import { ChevronRight } from "lucide-react";
import type { AttestationPreview } from "../sign/preview";

function pretty(body: string): string {
  return JSON.stringify(JSON.parse(body), null, 2);
}

/**
 * The bytes that would go on the topic, and whether they fit one HCS
 * message. The size line is always visible; the bytes themselves are one
 * click away. The size is of the canonical form, which is what is published;
 * the indentation inside is for reading only.
 */
export function AttestationPreviewCard({ preview }: { preview: AttestationPreview }) {
  const ratio = Math.min(1, preview.bytes / preview.maxBytes);
  const fits = preview.body !== null && preview.bytes <= preview.maxBytes;

  return (
    <details className="group rounded-2xl border border-border/60 bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 text-sm sm:px-6 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition group-open:rotate-90" aria-hidden />
        <span className="font-medium">What goes on the ledger</span>
        <span className="text-muted-foreground tabular-nums">
          {preview.body === null
            ? "Nothing yet"
            : `${preview.bytes} of ${preview.maxBytes} bytes · ${fits ? "fits one HCS message" : "too large"}`}
        </span>
        <span className="ml-auto h-1 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={`block h-full rounded-full ${fits ? "bg-foreground" : "bg-destructive"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </span>
      </summary>
      <div className="px-5 pb-5 sm:px-6">
        {preview.body !== null ? (
          <pre className="max-h-64 overflow-auto rounded-xl bg-muted/50 p-4 font-mono text-xs leading-relaxed">
            {pretty(preview.body)}
          </pre>
        ) : (
          <ul className="text-sm text-destructive">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

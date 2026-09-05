import { Textarea } from "@/components/ui/textarea";
import { ShortHash } from "./Mono";

/** The written review. Stored off-chain; only its hash is published. */
export function NotesEditor({
  notes,
  notesHash,
  onChange,
  disabled,
}: {
  notes: string;
  notesHash: string | null;
  onChange: (notes: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Textarea
        value={notes}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={6}
        placeholder="What you checked, what you found, and why the verdict is what it is."
        aria-label="Written notes"
      />
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>Stored off-chain. Only this hash goes on the ledger as</span>
        <code className="font-mono">notes_hash</code>
        <span>=</span>
        {notesHash === null ? <span>…</span> : <ShortHash value={notesHash} />}
      </p>
    </div>
  );
}

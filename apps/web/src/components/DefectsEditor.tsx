import { X } from "lucide-react";
import { byteLength, DEFECT_CODE_MAX_BYTES, DEFECTS_MAX_ITEMS } from "@handoff/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defectProblems } from "../sign/attestation";

/**
 * Short structured codes, bounded by the schema package. The bounds are
 * imported, never restated, so what this editor lets through is exactly what
 * the verifier lets through. The written reasoning goes in the notes, which
 * stay off-chain.
 *
 * The code being typed is owned by the screen, not by this component, so the
 * sign button can refuse to publish while a code sits uncommitted in the box.
 */
export function DefectsEditor({
  defects,
  onChange,
  draft,
  onDraftChange,
  disabled,
}: {
  defects: readonly string[];
  onChange: (defects: readonly string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled: boolean;
}) {
  const code = draft.trim();
  const bytes = byteLength(code);
  const full = defects.length >= DEFECTS_MAX_ITEMS;
  const overBytes = bytes > DEFECT_CODE_MAX_BYTES;
  const duplicate = defects.includes(code);
  const canAdd = !disabled && code.length > 0 && !full && !overBytes && !duplicate;
  const problems = defectProblems(defects);

  function add(): void {
    if (!canAdd) return;
    onChange([...defects, code]);
    onDraftChange("");
  }

  return (
    <div className="grid gap-3">
      {defects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {defects.map((defect, index) => (
            <span
              key={`${defect}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pr-1.5 pl-3 font-mono text-xs"
            >
              {defect}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${defect}`}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                  onClick={() => onChange(defects.filter((_, i) => i !== index))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder={defects.length === 0 ? "e.g. FN-2-DATE, or leave empty" : "Another code"}
            aria-label="Defect code"
            spellCheck={false}
            className="h-10 rounded-xl font-mono"
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            disabled={full}
          />
          <Button type="button" variant="secondary" className="h-10 rounded-xl" onClick={add} disabled={!canAdd}>
            Add
          </Button>
        </div>
      ) : (
        defects.length === 0 && <span className="text-sm text-muted-foreground">No defects listed.</span>
      )}

      <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>
          {defects.length} of {DEFECTS_MAX_ITEMS} codes
        </span>
        {!disabled && (
          <span className={overBytes ? "text-destructive" : ""}>
            {bytes} of {DEFECT_CODE_MAX_BYTES} bytes
            {duplicate && code.length > 0 ? " · already listed" : ""}
          </span>
        )}
      </div>

      {problems.length > 0 && (
        <ul className="text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { Check } from "lucide-react";
import type { Verdict } from "@handoff/schema";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const OPTIONS: ReadonlyArray<{ value: Verdict; label: string; detail: string }> = [
  { value: "approve", label: "Approve", detail: "Stands as delivered." },
  {
    value: "approve_with_changes",
    label: "Approve with changes",
    detail: "Acceptable once the listed defects are fixed.",
  },
  { value: "reject", label: "Reject", detail: "Not acceptable. The defects say why." },
];

/**
 * Three large cards, one choice. The radio itself is visually hidden but
 * still there for the keyboard and the screen reader; the card carries the
 * selected state, so the choice reads from across a room.
 */
export function VerdictPicker({
  value,
  onChange,
  disabled,
}: {
  value: Verdict | null;
  onChange: (verdict: Verdict) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3">
      <RadioGroup
        value={value ?? ""}
        onValueChange={(next) => onChange(next as Verdict)}
        disabled={disabled}
        className="grid gap-3 sm:grid-cols-3"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            htmlFor={`verdict-${option.value}`}
            className="group relative flex min-h-24 cursor-pointer flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 transition select-none hover:border-foreground/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[[data-disabled]]:cursor-default has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-foreground has-[[data-state=checked]]:text-background"
          >
            <RadioGroupItem id={`verdict-${option.value}`} value={option.value} className="sr-only" />
            <span className="flex items-start justify-between gap-2">
              <span className="text-base leading-tight font-semibold">{option.label}</span>
              <span
                className="hidden size-5 shrink-0 items-center justify-center rounded-full bg-background text-foreground group-has-[[data-state=checked]]:flex"
                aria-hidden
              >
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </span>
            <span className="text-xs leading-snug opacity-75">{option.detail}</span>
          </label>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        Payment releases on your signature, whatever the verdict. A reject is a delivered product.
      </p>
    </div>
  );
}

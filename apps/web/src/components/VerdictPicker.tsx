import type { Verdict } from "@handoff/schema";
import { Label } from "@/components/ui/label";
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
        className="grid gap-2"
      >
        {OPTIONS.map((option) => (
          <Label
            key={option.value}
            htmlFor={`verdict-${option.value}`}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-foreground"
          >
            <RadioGroupItem id={`verdict-${option.value}`} value={option.value} className="mt-0.5" />
            <span className="grid gap-0.5">
              <span className="font-medium">{option.label}</span>
              <span className="text-xs font-normal text-muted-foreground">{option.detail}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        Payment releases on your signature, whatever the verdict. A reject is a delivered product.
      </p>
    </div>
  );
}

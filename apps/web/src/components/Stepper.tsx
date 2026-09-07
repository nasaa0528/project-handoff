import { Check } from "lucide-react";

export interface StepperStep {
  readonly label: string;
  readonly hint: string;
}

type StepState = "done" | "current" | "todo";

/** The three steps of the screen, and where the expert is right now. */
export function Stepper({ steps, current }: { steps: readonly StepperStep[]; current: number }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
      {steps.map((step, index) => {
        const number = index + 1;
        const state: StepState = number < current ? "done" : number === current ? "current" : "todo";
        return (
          <li key={step.label} className="grid gap-2" aria-current={state === "current" ? "step" : undefined}>
            <div className={`h-1 rounded-full ${state === "todo" ? "bg-border" : "bg-foreground"}`} aria-hidden />
            <div className="flex items-center gap-2">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                  state === "done"
                    ? "bg-foreground text-background"
                    : state === "current"
                      ? "border-2 border-foreground text-foreground"
                      : "border border-border text-muted-foreground"
                }`}
                aria-hidden
              >
                {state === "done" ? <Check className="size-3" strokeWidth={3} /> : number}
              </span>
              <span className={`text-sm font-medium ${state === "todo" ? "text-muted-foreground" : ""}`}>
                {step.label}
              </span>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">{step.hint}</span>
          </li>
        );
      })}
    </ol>
  );
}

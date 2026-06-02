import { STEP_SHORT, TOTAL_STEPS } from "./types";

// Simple linear progress bar for the onboarding flow.
export function ProgressSteps({ current }: { current: number }) {
  const steps = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1);
  return (
    <ol className="flex items-start gap-2">
      {steps.map((n) => {
        const active = n <= current;
        return (
          <li key={n} className="flex flex-1 flex-col gap-1.5">
            <div className={`h-1.5 rounded-full ${active ? "bg-brand-500" : "bg-slate-200"}`} />
            <span
              className={`hidden text-[11px] font-medium sm:block ${
                n === current ? "text-brand-700" : "text-slate-400"
              }`}
            >
              {n}. {STEP_SHORT[n]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

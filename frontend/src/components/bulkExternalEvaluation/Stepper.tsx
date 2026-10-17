import { Check } from "lucide-react";

export const EVALUATION_STEPS = ["Copy prompt", "Paste JSON", "Review changes", "Save"] as const;

// A numbered progress list. `current` is 0-based; earlier steps show a check.
export default function Stepper({ current, onSelect, reachable }: { current: number; onSelect: (index: number) => void; reachable: number }) {
  return (
    <nav aria-label="Evaluation steps">
      <ol className="flex flex-wrap gap-2">
        {EVALUATION_STEPS.map((label, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={label}>
              <button
                type="button"
                disabled={index > reachable}
                onClick={() => onSelect(index)}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                  active ? "border-primary-600 bg-primary-50 text-primary-800" : done ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 text-slate-700"
                }`}
              >
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${active ? "bg-primary-700 text-white" : done ? "bg-emerald-700 text-white" : "bg-slate-200 text-slate-800"}`}>
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                </span>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

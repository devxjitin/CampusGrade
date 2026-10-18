import { AlertTriangle } from "lucide-react";
import type { ValidationProblem } from "./shared";

// One row per field problem returned by the API, grouped by student, so a teacher can fix the JSON in one pass.
export default function ProblemList({ problems }: { problems: ValidationProblem[] }) {
  if (!problems.length) return null;
  const groups = problems.reduce<Record<string, ValidationProblem[]>>((acc, item) => {
    (acc[item.student || "Response"] ||= []).push(item);
    return acc;
  }, {});
  return (
    <div role="alert" className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
      <p className="flex items-center gap-2 font-bold">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {problems.length === 1 ? "1 problem to fix" : `${problems.length} problems to fix`} in the pasted JSON
      </p>
      <p className="mt-1 text-xs">Fix them in the AI tool (or in the text below), then validate again.</p>
      <div className="mt-3 space-y-3">
        {Object.entries(groups).map(([student, items]) => (
          <div key={student}>
            <p className="font-semibold">{student}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {items.map((item, index) => (
                <li key={`${item.path}-${index}`}>
                  {item.message}
                  {item.path && <code className="ml-2 rounded bg-white px-1.5 py-0.5 text-[11px] text-rose-800">{item.path}</code>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Assignment = Record<string, any>;

export const phaseBadge: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700",
  open: "bg-emerald-100 text-emerald-700",
  late_window: "bg-amber-100 text-amber-700",
  closed: "bg-violet-100 text-violet-700",
  awaiting_grading: "bg-amber-100 text-amber-700",
  results_partial: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  archived: "bg-slate-200 text-slate-600",
};

export const insightColors = ["#0c3c8a", "#e3000f", "#16a34a", "#d97706", "#64748b", "#1a70c0"];
export const insightTooltip = { borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 14px 30px rgba(15,23,42,0.12)" };
export const countValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};


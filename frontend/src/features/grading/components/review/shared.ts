// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export const TABS = ["overview", "files", "readme", "activity", "dependencies", "grading"];
export const statusTone: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-700",
  processing: "bg-blue-100 text-blue-700",
  queued: "bg-blue-100 text-blue-700",
  pending_teacher: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
  missing: "bg-slate-100 text-slate-600",
  published: "bg-violet-100 text-violet-700",
  draft: "bg-amber-100 text-amber-700",
};



import { formatDateTime, parseServerDateTime } from "@/lib/datetime";
import type { Assignment } from "./shared";

export type StudentBucket = "todo" | "upcoming" | "submitted" | "results" | "missed";

/** Where an assignment sits in a student's life cycle: a published result wins, then a submission, then the schedule. */
export const bucketOf = (assignment: Assignment): StudentBucket | null => {
  if (assignment.phase === "archived" || assignment.status === "archived") return null;
  if (assignment.grade) return "results";
  if (assignment.submission) return "submitted";
  if (assignment.phase === "scheduled") return "upcoming";
  if (assignment.phase === "open" || assignment.phase === "late_window") return "todo";
  return "missed";
};

const time = (value: unknown) => parseServerDateTime(value as string | null | undefined)?.getTime() ?? 0;

export interface StudentGroups {
  todo: Assignment[];
  upcoming: Assignment[];
  submitted: Assignment[];
  results: Assignment[];
  missed: Assignment[];
}

export const groupStudentAssignments = (assignments: Assignment[]): StudentGroups => {
  const groups: StudentGroups = { todo: [], upcoming: [], submitted: [], results: [], missed: [] };
  for (const assignment of assignments) {
    const bucket = bucketOf(assignment);
    if (bucket) groups[bucket].push(assignment);
  }
  groups.todo.sort((a, b) => time(a.due_at) - time(b.due_at));
  groups.upcoming.sort((a, b) => time(a.opens_at || a.due_at) - time(b.opens_at || b.due_at));
  groups.submitted.sort((a, b) => time(b.due_at) - time(a.due_at));
  groups.results.sort((a, b) => time(b.grade?.published_at || b.due_at) - time(a.grade?.published_at || a.due_at));
  groups.missed.sort((a, b) => time(b.due_at) - time(a.due_at));
  return groups;
};

export type DueTone = "overdue" | "soon" | "normal";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A short human label for a deadline, with a tone the UI turns into a colour. */
export const dueLabel = (dueAt: unknown, now: Date = new Date()): { text: string; tone: DueTone } => {
  const due = parseServerDateTime(dueAt as string | null | undefined);
  if (!due) return { text: "No deadline", tone: "normal" };
  const diff = due.getTime() - now.getTime();
  if (diff < 0) return { text: "Past deadline", tone: "overdue" };
  if (diff < HOUR) return { text: `Due in ${Math.max(1, Math.round(diff / 60_000))} min`, tone: "soon" };
  if (diff < DAY) return { text: `Due in ${Math.round(diff / HOUR)} h`, tone: "soon" };
  const days = Math.round(diff / DAY);
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  if (days <= 3) return { text: `Due in ${days} days`, tone: "soon" };
  return { text: `Due ${formatDateTime(due, { day: "2-digit", month: "short" })}`, tone: "normal" };
};

export const scoreOf = (assignment: Assignment) => {
  const awarded = Number(assignment.grade?.total_awarded ?? 0);
  const total = Number(assignment.total_marks ?? 0);
  return { awarded, total, percent: total > 0 ? Math.max(0, Math.min(100, (awarded / total) * 100)) : 0 };
};

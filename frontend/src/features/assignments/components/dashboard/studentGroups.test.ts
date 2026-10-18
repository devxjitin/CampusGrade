import { describe, expect, it } from "vitest";
import { bucketOf, dueLabel, groupStudentAssignments, scoreOf } from "./studentGroups";

const NOW = new Date("2026-10-18T10:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

describe("bucketOf", () => {
  it("puts a published result first, then a submission, then the schedule", () => {
    expect(bucketOf({ phase: "closed", submission: {}, grade: { total_awarded: 5 } })).toBe("results");
    expect(bucketOf({ phase: "open", submission: {} })).toBe("submitted");
    expect(bucketOf({ phase: "scheduled" })).toBe("upcoming");
    expect(bucketOf({ phase: "open" })).toBe("todo");
    expect(bucketOf({ phase: "late_window" })).toBe("todo");
    expect(bucketOf({ phase: "closed" })).toBe("missed");
    expect(bucketOf({ phase: "archived" })).toBeNull();
  });
});

describe("groupStudentAssignments", () => {
  it("sorts to-do by earliest deadline and results by newest publication", () => {
    const groups = groupStudentAssignments([
      { id: "late", phase: "open", due_at: at(72) },
      { id: "soon", phase: "open", due_at: at(5) },
      { id: "old-result", phase: "closed", submission: {}, grade: { published_at: at(-48) }, due_at: at(-100) },
      { id: "new-result", phase: "closed", submission: {}, grade: { published_at: at(-2) }, due_at: at(-90) },
    ]);
    expect(groups.todo.map((item) => item.id)).toEqual(["soon", "late"]);
    expect(groups.results.map((item) => item.id)).toEqual(["new-result", "old-result"]);
  });
});

describe("dueLabel", () => {
  it("labels deadlines in human terms with a tone", () => {
    expect(dueLabel(at(-1), NOW)).toEqual({ text: "Past deadline", tone: "overdue" });
    expect(dueLabel(at(0.5), NOW)).toEqual({ text: "Due in 30 min", tone: "soon" });
    expect(dueLabel(at(6), NOW)).toEqual({ text: "Due in 6 h", tone: "soon" });
    expect(dueLabel(at(30), NOW)).toEqual({ text: "Due tomorrow", tone: "soon" });
    expect(dueLabel(at(24 * 3), NOW)).toEqual({ text: "Due in 3 days", tone: "soon" });
    expect(dueLabel(at(24 * 10), NOW).tone).toBe("normal");
    expect(dueLabel(null, NOW)).toEqual({ text: "No deadline", tone: "normal" });
  });
});

describe("scoreOf", () => {
  it("clamps the percentage and tolerates missing totals", () => {
    expect(scoreOf({ grade: { total_awarded: 17 }, total_marks: 20 }).percent).toBe(85);
    expect(scoreOf({ grade: { total_awarded: 30 }, total_marks: 20 }).percent).toBe(100);
    expect(scoreOf({ grade: { total_awarded: 3 } }).percent).toBe(0);
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarksChart, StatusDonut, completionPercent } from "./StudentCharts";
import { groupStudentAssignments } from "./studentGroups";

const groups = groupStudentAssignments([
  { id: "1", phase: "open", due_at: "2099-01-01T00:00:00Z" },
  { id: "2", phase: "closed", submission: {}, due_at: "2020-01-01T00:00:00Z" },
  { id: "3", phase: "closed", submission: {}, grade: { total_awarded: 8, published_at: "2020-02-01T00:00:00Z" }, total_marks: 10, due_at: "2020-01-01T00:00:00Z" },
  { id: "4", phase: "closed", due_at: "2020-01-01T00:00:00Z" },
]);

describe("student charts", () => {
  it("counts submitted and graded work as done", () => {
    expect(completionPercent(groups)).toBe(50);
    expect(completionPercent(groupStudentAssignments([]))).toBe(0);
  });

  it("describes the donut for screen readers", () => {
    render(<StatusDonut groups={groups} />);
    expect(screen.getByRole("img", { name: /50% of assignments submitted or graded/ })).toBeTruthy();
    expect(screen.getByText("Awaiting result")).toBeTruthy();
  });

  it("explains an empty marks chart", () => {
    render(<MarksChart results={[]} />);
    expect(screen.getByText(/once results are published/)).toBeTruthy();
  });

  it("labels the marks chart with each result", () => {
    render(<MarksChart results={groups.results} />);
    expect(screen.getByRole("img", { name: /Marks:.*80%/ })).toBeTruthy();
  });
});

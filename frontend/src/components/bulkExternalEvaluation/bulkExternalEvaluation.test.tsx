import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DiffTable from "./DiffTable";
import ProblemList from "./ProblemList";
import Stepper from "./Stepper";
import { validationProblems } from "./shared";

afterEach(cleanup);

describe("validationProblems", () => {
  it("reads the per-field errors the API returns with a 422", () => {
    const error = { response: { data: { errors: [{ student: "Student-01 (Asha)", criterion: "Correctness", path: "students[0].rubric_scores[0].awarded", message: "Marks are 9" }, { nope: true }] } } };
    expect(validationProblems(error)).toEqual([{ student: "Student-01 (Asha)", criterion: "Correctness", path: "students[0].rubric_scores[0].awarded", message: "Marks are 9" }]);
  });

  it("returns an empty list for errors without a list", () => {
    expect(validationProblems(new Error("boom"))).toEqual([]);
    expect(validationProblems({ response: { data: { errors: "nope" } } })).toEqual([]);
  });
});

describe("ProblemList", () => {
  it("groups problems by student and announces the count", () => {
    render(
      <ProblemList
        problems={[
          { student: "Student-01 (Asha)", criterion: "Correctness", path: "a", message: "Marks are 9" },
          { student: "Student-01 (Asha)", criterion: null, path: "b", message: "Confidence is wrong" },
          { student: "Student-02 (Rohan)", criterion: null, path: "c", message: "Student-02 is missing" },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/3 problems to fix/)).toBeTruthy();
    expect(within(alert).getAllByText(/Student-0[12]/).length).toBeGreaterThanOrEqual(2);
    expect(within(alert).getByText("Marks are 9")).toBeTruthy();
  });

  it("renders nothing when there are no problems", () => {
    const { container } = render(<ProblemList problems={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("DiffTable", () => {
  const diff = (current: number | null) => ({
    student_name: "Asha Verma",
    current: current === null ? null : { total_awarded: 4 },
    diff: {
      current_total: current === null ? null : 4,
      criteria: [{ criterion_id: "c1", title: "Correctness", max_marks: 6, current, proposed: 5, delta: current === null ? null : 5 - current }],
    },
  });

  it("marks a first evaluation as new", () => {
    render(<DiffTable student={diff(null)} scores={{ c1: 5 }} />);
    expect(screen.getByText("new")).toBeTruthy();
    expect(screen.getByRole("table", { name: /Asha Verma/ })).toBeTruthy();
  });

  it("shows the change against the saved mark and follows edited scores", () => {
    const { rerender } = render(<DiffTable student={diff(4)} scores={{ c1: 5 }} />);
    expect(screen.getByText("+1")).toBeTruthy();
    rerender(<DiffTable student={diff(4)} scores={{ c1: 3 }} />);
    expect(screen.getByText("-1")).toBeTruthy();
  });
});

describe("Stepper", () => {
  it("marks the current step, checks finished ones and blocks steps that are not reachable yet", () => {
    const onSelect = vi.fn();
    render(<Stepper current={1} reachable={1} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Paste JSON/ }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("button", { name: /Copy prompt.*done/ })).toBeTruthy();
    const review = screen.getByRole("button", { name: /Review changes/ }) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/ }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

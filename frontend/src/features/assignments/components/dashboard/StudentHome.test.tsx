import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudentHome } from "./StudentHome";

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const user = { name: "Riya Sharma", role: "student" };

describe("StudentHome", () => {
  it("shows an empty state when there are no assignments", () => {
    render(<StudentHome user={user} loading={false} assignments={[]} openItem={() => {}} navigate={() => {}} />);
    expect(screen.getByText("No assignments yet")).toBeTruthy();
  });

  it("greets the student, lists the next task and opens it", () => {
    const openItem = vi.fn();
    const assignments = [
      { id: "b", title: "Later task", subject: "Algorithms", total_marks: 10, phase: "open", due_at: iso(8) },
      { id: "a", title: "Urgent task", subject: "Data Structures", total_marks: 20, phase: "open", due_at: iso(0.5) },
      { id: "r", title: "Graded task", subject: "Databases", total_marks: 20, phase: "closed", due_at: iso(-5), submission: {}, grade: { total_awarded: 17, published_at: iso(-1) } },
    ];
    render(<StudentHome user={user} loading={false} assignments={assignments} openItem={openItem} navigate={() => {}} />);
    expect(screen.getByText("Hi Riya")).toBeTruthy();
    expect(screen.getByText(/2 assignments need your submission/)).toBeTruthy();
    expect(screen.getByText("17/20")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open next/ }));
    expect(openItem).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("says when everything is submitted", () => {
    render(<StudentHome user={user} loading={false} assignments={[{ id: "s", title: "Done", phase: "open", submission: {}, due_at: iso(2) }]} openItem={() => {}} navigate={() => {}} />);
    expect(screen.getByText(/all caught up/)).toBeTruthy();
    expect(screen.getByText("Nothing to submit right now.")).toBeTruthy();
  });
});

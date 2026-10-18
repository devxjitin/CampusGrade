import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const exportMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/ai/api", () => ({
  exportAssignmentExternalEvaluation: exportMock,
  saveAssignmentExternalEvaluations: vi.fn(),
  validateAssignmentExternalEvaluation: vi.fn(),
}));
vi.mock("@/components/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import BulkExternalEvaluationDialog from "./BulkExternalEvaluationDialog";

afterEach(() => {
  cleanup();
  exportMock.mockReset();
});

const open = () => {
  render(<BulkExternalEvaluationDialog assignmentId="a1" assignment={{ title: "API project", rubric: [], total_marks: 10 }} />);
  fireEvent.click(screen.getByRole("button", { name: /External AI evaluator/ }));
};

describe("BulkExternalEvaluationDialog", () => {
  it("prepares one whole-class prompt from GitHub links by default", async () => {
    exportMock.mockResolvedValue({ mode: "links", batches: [], excluded_students: [] });
    open();
    expect(screen.getByRole("radio", { name: /Whole class with GitHub links/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/not anonymous/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Prepare class prompt/ }));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith("a1", "links"));
  });

  it("can switch to full files in batches", async () => {
    exportMock.mockResolvedValue({ mode: "files", batches: [], excluded_students: [] });
    open();
    fireEvent.click(screen.getByRole("radio", { name: /Full files in batches/ }));
    expect(screen.getByText(/GitHub usernames are removed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Prepare batches/ }));
    await waitFor(() => expect(exportMock).toHaveBeenCalledWith("a1", "files"));
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InstructionsField } from "./InstructionsField";

describe("InstructionsField", () => {
  it("opens the same instructions in a large window and closes it again", async () => {
    render(<InstructionsField value={"# Title\n\nSome text"} onChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open instructions in a large window" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Some text");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("starts in code view when empty and in preview when there is text", () => {
    const { unmount } = render(<InstructionsField value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Instructions (Markdown)")).toBeTruthy();
    unmount();
    render(<InstructionsField value="Hello" onChange={() => {}} />);
    expect(screen.queryByLabelText("Instructions (Markdown)")).toBeNull();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import WrapInput from "./WrapInput";

const Harness = () => {
  const [value, setValue] = useState("");
  return <WrapInput aria-label="Title" value={value} onChange={(event) => setValue(event.target.value)} />;
};

describe("WrapInput", () => {
  it("keeps the whole text and turns pasted line breaks into spaces", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Title") as HTMLTextAreaElement;
    const long = "A very long assignment title ".repeat(8).trim();
    fireEvent.change(field, { target: { value: long } });
    expect(field.value).toBe(long);
    fireEvent.change(field, { target: { value: "first line\nsecond line\r\nthird" } });
    expect(field.value).toBe("first line second line third");
  });

  it("has a fixed height of the requested rows so the layout never shifts", () => {
    render(<WrapInput aria-label="Notes" rows={4} defaultValue="short" />);
    const field = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(field.rows).toBe(4);
    expect(field.style.height).toBe("");
    expect(field.className).toContain("overflow-y-auto");
  });

  it("ignores Enter like a single-line input", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Title");
    expect(fireEvent.keyDown(field, { key: "Enter" })).toBe(false);
  });
});

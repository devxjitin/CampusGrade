import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownPreview from "./MarkdownPreview";
import { fenceLanguage } from "@/lib/markdownFence";

const diagram = "flowchart TD\n  A --> B";

describe("MarkdownPreview mermaid fences", () => {
  it.each([
    ["plain fence", "```mermaid\n" + diagram + "\n```"],
    ["indented fence", "  ```mermaid\n" + diagram + "\n  ```"],
    ["single-backtick fence", "`mermaid\n" + diagram + "\n`"],
    ["escaped backticks", "\\`\\`\\`mermaid\n" + diagram + "\n\\`\\`\\`"],
  ])("treats a %s as a diagram, not text", (_name, source) => {
    const { container } = render(<MarkdownPreview source={source} />);
    expect(container.textContent).not.toContain("`");
    expect(container.textContent).not.toContain("flowchart TD\n");
    expect(container.textContent).not.toMatch(/mermaid$/);
  });
});

describe("fenceLanguage", () => {
  it("recognises fences and ignores inline code", () => {
    expect(fenceLanguage("```mermaid")).toBe("mermaid");
    expect(fenceLanguage("`Mermaid")).toBe("mermaid");
    expect(fenceLanguage("```")).toBe("");
    expect(fenceLanguage("`inline code`")).toBeNull();
    expect(fenceLanguage("plain text")).toBeNull();
    expect(fenceLanguage("Run `npm test` now")).toBeNull();
  });
});

describe("MarkdownPreview text formatting", () => {
  const source = [
    "1. **Core Sorting (`src/algorithms/`)**: Clean implementations:",
    "   - **Comparison-based ($O(n^2)$)**: Bubble Sort, Selection Sort.",
    "   - **Comparison-based ($O(n \\log n)$)**: Merge Sort, Quick Sort.",
    "2. **Benchmarks**: sizes like $n = 10^2, 10^3$ and a price of $5 or $10.",
    "",
    "| Algorithm | Cost |",
    "| --- | --- |",
    "| Merge | $O(n \\log n)$ |",
  ].join("\n");

  it("renders nested lists, bold with code, math and tables", () => {
    const { container } = render(<MarkdownPreview source={source} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("**");
    expect(text).not.toContain("$O(");
    expect(text).not.toContain("`");
    expect(text).toContain("O(n²)");
    expect(text).toContain("O(n log n)");
    expect(text).toContain("10², 10³");
    expect(text).toContain("$5 or $10");
    expect(container.querySelectorAll("strong code").length).toBe(1);
    expect(container.querySelectorAll("table tbody tr").length).toBe(1);
    expect(container.textContent).not.toContain("- ");
  });
});

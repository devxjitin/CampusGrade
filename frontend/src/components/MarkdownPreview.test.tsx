import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownPreview from "./MarkdownPreview";

const diagram = "flowchart TD\n  A --> B";

describe("MarkdownPreview mermaid fences", () => {
  it.each([
    ["plain fence", "```mermaid\n" + diagram + "\n```"],
    ["indented fence", "  ```mermaid\n" + diagram + "\n  ```"],
    ["escaped backticks", "\`\`\`mermaid\n" + diagram + "\n\`\`\`"],
  ])("treats a %s as a diagram, not text", (_name, source) => {
    const { container } = render(<MarkdownPreview source={source} />);
    expect(container.textContent).not.toContain("```");
    expect(container.textContent).not.toContain("flowchart TD\n");
    expect(screen.queryByText(/mermaid$/)).toBeNull();
  });
});

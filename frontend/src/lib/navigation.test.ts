import { describe, expect, it } from "vitest";

import { getMenuSections } from "./navigation";

const labelsFor = (role: string) => getMenuSections(role).flatMap((section) => section.items.map((item) => item.label));

describe("administrator navigation", () => {
  it("shows platform-wide controls only to super administrators", () => {
    const labels = labelsFor("super_admin");
    expect(labels).toContain("Administrators");
    expect(labels).toContain("Programs");
    expect(labels).toContain("Academic sessions");
    expect(labels).toContain("Session rollover");
    expect(labels).toContain("Background jobs");
    expect(labels).toContain("Data exports");
    expect(labels).toContain("Settings");
  });

  it("keeps program administrators within delegated operations", () => {
    const labels = labelsFor("program_admin");
    expect(labels).toContain("Batches");
    expect(labels).toContain("Sections");
    expect(labels).toContain("Subjects");
    expect(labels).not.toContain("Administrators");
    expect(labels).not.toContain("Programs");
    expect(labels).not.toContain("Academic sessions");
    expect(labels).not.toContain("Session rollover");
    expect(labels).not.toContain("Background jobs");
    expect(labels).not.toContain("Data exports");
    expect(labels).not.toContain("Settings");
  });
});

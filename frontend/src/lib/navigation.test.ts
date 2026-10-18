import { describe, expect, it } from "vitest";

import { getMenuSections } from "./navigation";

const labelsFor = (role: string, access?: Parameters<typeof getMenuSections>[1]) =>
  getMenuSections(role, access).flatMap((section) => section.items.map((item) => item.label));

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

  it("shows an admin only the areas a super administrator granted", () => {
    const labels = labelsFor("admin", { batches: "view", users: "edit", audit_log: "view" });
    expect(labels).toContain("Batches");
    expect(labels).toContain("Students");
    expect(labels).toContain("Teachers");
    expect(labels).toContain("Assignment audit log");
    expect(labels).not.toContain("Sections");
    expect(labels).not.toContain("Subjects");
    expect(labels).not.toContain("All assignments");
    expect(labels).toContain("Profile");
  });

  it("shows an admin with no access nothing but home and their account", () => {
    expect(labelsFor("admin", {})).toEqual(["Home", "Profile"]);
  });

  it("keeps admins away from platform-wide controls", () => {
    const labels = labelsFor("admin", { batches: "full", sections: "full", subjects: "full", users: "full", assignments: "full", audit_log: "view" });
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

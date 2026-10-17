import { describe, expect, it } from "vitest";

import { can, canAccess } from "./permissions";

describe("canAccess", () => {
  it("gives a super admin everything", () => {
    expect(canAccess({ role: "super_admin" }, "batches", "full")).toBe(true);
    expect(canAccess({ role: "super_admin" }, "audit_log", "view")).toBe(true);
  });

  it("limits an admin to the granted level and above", () => {
    const viewer = { role: "admin", access: { batches: "view" } } as const;
    const editor = { role: "admin", access: { batches: "edit" } } as const;
    const owner = { role: "admin", access: { batches: "full" } } as const;
    expect([canAccess(viewer, "batches"), canAccess(viewer, "batches", "edit"), canAccess(viewer, "batches", "full")]).toEqual([true, false, false]);
    expect([canAccess(editor, "batches"), canAccess(editor, "batches", "edit"), canAccess(editor, "batches", "full")]).toEqual([true, true, false]);
    expect([canAccess(owner, "batches"), canAccess(owner, "batches", "edit"), canAccess(owner, "batches", "full")]).toEqual([true, true, true]);
  });

  it("denies areas that were not granted, and everyone who is not an admin", () => {
    expect(canAccess({ role: "admin", access: { batches: "full" } }, "subjects")).toBe(false);
    expect(canAccess({ role: "admin" }, "batches")).toBe(false);
    expect(canAccess({ role: "teacher", access: { batches: "full" } }, "batches")).toBe(false);
    expect(canAccess(null, "batches")).toBe(false);
  });
});

describe("can", () => {
  it("keeps platform-wide actions with the super admin", () => {
    expect(can("super_admin", "admin.manage")).toBe(true);
    expect(can("admin", "admin.manage")).toBe(false);
    expect(can("admin", "report.view")).toBe(true);
  });
});

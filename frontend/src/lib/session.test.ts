import { beforeEach, describe, expect, it } from "vitest";
import { clearSession, getCachedUser, isAdminRole, setCachedUser } from "./session";

// Sprint 6: the access token moved from localStorage to an httpOnly cookie,
// so there is nothing left for JS to decode or persist. These tests cover
// the in-memory user cache and the isAdminRole helper instead.

describe("in-memory user cache", () => {
  beforeEach(() => {
    clearSession();
  });

  it("returns null when nothing is cached", () => {
    expect(getCachedUser()).toBeNull();
  });

  it("round-trips a user through the module-level cache", () => {
    setCachedUser({ role: "student", email: "s@example.edu" });
    expect(getCachedUser()).toEqual({ role: "student", email: "s@example.edu" });
  });

  it("clears the cache", () => {
    setCachedUser({ role: "teacher" });
    clearSession();
    expect(getCachedUser()).toBeNull();
  });
});

describe("isAdminRole", () => {
  it("is true for super_admin", () => {
    expect(isAdminRole("super_admin")).toBe(true);
  });

  it("is true for admin", () => {
    expect(isAdminRole("admin")).toBe(true);
  });

  it("is false for teacher, student, undefined, and null", () => {
    expect(isAdminRole("teacher")).toBe(false);
    expect(isAdminRole("student")).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });
});

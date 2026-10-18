// UI-ONLY convenience mirror of the backend's permission rules
// (`backend/core/policy.py`).
//
// IMPORTANT: this is for UI decisions only (show/hide a button, grey out an
// action) — it is NOT a security boundary. The FastAPI backend is the sole
// authority: every route re-checks `core.policy.require(...)` /
// `require_access(...)` itself regardless of what the client renders. A user
// could always call the API directly with devtools/curl, bypassing this file.
// Never gate anything security-sensitive on `can()` / `canAccess()` alone.
//
// Keep this in sync by hand with `backend/core/policy.py` whenever the rules
// change — there's no code generation for this yet.

import type { AccessLevel, AccessResource, SessionUser } from "./session";

export type Role = SessionUser["role"];

// Platform-wide and teacher/student permissions. Mirrors `Permission` in backend/core/policy.py.
export type Permission =
  | "session.manage"
  | "rollover.execute"
  | "program.manage"
  | "admin.manage"
  | "settings.manage"
  | "jobs.manage"
  | "assignment.create"
  | "assignment.grade"
  | "grade.publish"
  | "integrity.review"
  | "ai.evaluate"
  | "submission.create"
  | "report.view";

const S = "super_admin" as const;
const A = "admin" as const;
const T = "teacher" as const;
const U = "student" as const;

// Mirrors `PERMISSIONS` in backend/core/policy.py, role-for-role.
const PERMISSIONS: Record<Permission, readonly Role[]> = {
  "session.manage": [S],
  "rollover.execute": [S],
  "program.manage": [S],
  "admin.manage": [S],
  "settings.manage": [S],
  "jobs.manage": [S],
  "assignment.create": [T],
  "assignment.grade": [T],
  "grade.publish": [T],
  "ai.evaluate": [T],
  "integrity.review": [S, A, T],
  "submission.create": [U],
  "report.view": [S, A, T, U],
};

/** UI convenience ONLY. The server is the real authority — see file header. */
export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  !!role && PERMISSIONS[permission].includes(role);

const RANK: Record<AccessLevel, number> = { view: 1, edit: 2, full: 3 };

/**
 * Whether the user may use `resource` at `level` or higher: "view" reads, "edit" also creates and
 * changes, "full" also deletes. A Super Admin may do everything; an `admin` only what a Super Admin
 * granted. UI convenience ONLY — the server enforces it.
 */
export const canAccess = (
  user: Pick<SessionUser, "role" | "access"> | null | undefined,
  resource: AccessResource,
  level: AccessLevel = "view",
): boolean => {
  if (!user) return false;
  if (user.role === S) return true;
  if (user.role !== A) return false;
  const granted = user.access?.[resource];
  return !!granted && RANK[granted] >= RANK[level];
};

/** True for either admin tier — mirrors `session.ts::isAdminRole`. */
export const isAdminRole = (role: Role | null | undefined): boolean => role === S || role === A;

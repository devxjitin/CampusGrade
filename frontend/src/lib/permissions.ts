// UI-ONLY convenience mirror of the backend's real permission matrix
// (`backend/core/policy.py::PERMISSIONS`). Sprint 7 (the original implementation plan
// "Frontend shell rebuild"), item 7.
//
// IMPORTANT: this is for UI decisions only (show/hide a button, grey out an
// action) — it is NOT a security boundary. The FastAPI backend is the sole
// authority: every mutating route re-checks `core.policy.require(...)`
// itself regardless of what the client renders. A user could always call
// the API directly with devtools/curl, bypassing this file entirely.
// Never gate anything security-sensitive on `can()` alone.
//
// Keep this in sync by hand with `backend/core/policy.py::PERMISSIONS`
// whenever that matrix changes — there's no code generation for this yet.

import type { SessionUser } from "./session";

export type Role = SessionUser["role"];

// Mirrors `Permission` in backend/core/policy.py.
export type Permission =
  | "session.manage"
  | "rollover.execute"
  | "program.manage"
  | "admin.manage"
  | "settings.manage"
  | "batch.manage"
  | "section.manage"
  | "subject.manage"
  | "offering.manage"
  | "user.manage"
  | "assignment.create"
  | "assignment.grade"
  | "grade.publish"
  | "assignment.admin_override"
  | "integrity.review"
  | "ai.evaluate"
  | "submission.create"
  | "report.view"
  | "audit.view";

const S = "super_admin" as const;
const P = "program_admin" as const;
const T = "teacher" as const;
const U = "student" as const;

// Mirrors `PERMISSIONS` in backend/core/policy.py, role-for-role.
const PERMISSIONS: Record<Permission, readonly Role[]> = {
  "session.manage": [S],
  "rollover.execute": [S],
  "program.manage": [S],
  "admin.manage": [S],
  "settings.manage": [S],
  "batch.manage": [S, P],
  "section.manage": [S, P],
  "subject.manage": [S, P],
  "offering.manage": [S, P],
  "user.manage": [S, P],
  "assignment.admin_override": [S, P],
  "audit.view": [S, P],
  "assignment.create": [T],
  "assignment.grade": [T],
  "grade.publish": [T],
  "ai.evaluate": [T],
  "integrity.review": [S, P, T],
  "submission.create": [U],
  "report.view": [S, P, T, U],
};

/** UI convenience ONLY. The server is the real authority — see file header. */
export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  !!role && PERMISSIONS[permission].includes(role);

/** True for either admin tier — mirrors `session.ts::isAdminRole`. */
export const isAdminRole = (role: Role | null | undefined): boolean => role === S || role === P;

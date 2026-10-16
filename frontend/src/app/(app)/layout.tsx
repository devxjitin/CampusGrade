"use client";

import AuthGate from "@/components/AuthGate";
import DashboardLayout from "@/components/layout/DashboardLayout";

// Sprint 7 (IMPLEMENTATION_PLAN.md "Frontend shell rebuild"): this route
// group replaces the old `(dashboard)/layout.tsx`, which only wrapped
// `AuthGate` — every one of its 21 pages then imported and rendered
// `DashboardLayout` itself, so the sidebar chrome and the notification/
// academic-session polling inside it were destroyed and re-fetched on
// *every* navigation between admin/assignment pages.
//
// `DashboardLayout` now mounts here, once, above the page-level
// `{children}`. Pages under `(app)/` render their content directly (no more
// `<DashboardLayout>` wrapper per page) — see the pages themselves.
// `AuthGate` still gates the whole group and only renders `DashboardLayout`
// (and the page below it) once the session is confirmed valid, so
// `DashboardLayout`'s internal `getCachedUser()` read is guaranteed to see
// a populated cache on first mount.
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate allowedRoles={["super_admin", "program_admin", "teacher", "student"]}>
      <DashboardLayout>{children}</DashboardLayout>
    </AuthGate>
  );
}

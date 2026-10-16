// Shared helpers for the admin-only academic-session switcher in the
// topbar (DashboardLayout) — the selected session id is stored client-side
// and read by admin report views (AssignmentDashboardView's AdminMonitoring)
// to scope the dashboard's date range. See PLAN_CAMPUSGRADE_CHANGES.md §7.
const STORAGE_KEY = "campusgrade_academic_session_id";
export const ACADEMIC_SESSION_CHANGED_EVENT = "campusgrade:academic-session-changed";

export const getSelectedAcademicSessionId = (): string => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
};

export const setSelectedAcademicSessionId = (sessionId: string) => {
  if (typeof window === "undefined") return;
  if (sessionId) window.localStorage.setItem(STORAGE_KEY, sessionId);
  else window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(ACADEMIC_SESSION_CHANGED_EVENT, { detail: sessionId }));
};

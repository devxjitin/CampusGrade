// Auth + profile/session request functions.
// Sprint 7: split out of src/lib/api.ts (see src/lib/http.ts for the shared
// axios instance/interceptors this and every other feature api.ts uses).
import { refreshAccessToken } from "@/lib/http";
import { clearSession, setCachedUser, type SessionUser } from "@/lib/session";
import { request, type ApiRequestBody } from "@/types/api-client";

export { refreshAccessToken };
export const refreshSession = refreshAccessToken;

export const login = async (email: string, password: string, role?: string) => {
  const data = await request.post<"/login">("/login", { email, password }, { params: role ? { role } : undefined });
  const user = data.user as SessionUser;
  setCachedUser(user);
  return { ...data, user };
};

export const logout = async () => {
  const data = await request.post<"/logout">("/logout");
  clearSession();
  return data;
};

// ─── Profile ──────────────────────────────────────────────────────────

export const getProfile = () => request.get<"/profile">("/profile");

export const getAssignedTeachers = () => request.get<"/me/teachers">("/me/teachers");

export const getTeachingScope = () => request.get<"/me/teaching-scope">("/me/teaching-scope");

export const updateProfile = (data: ApiRequestBody<"/profile", "patch">) => request.patch<"/profile">("/profile", data);

export const changePassword = async (oldPassword: string, newPassword: string) =>
  request.patch<"/change-password">("/change-password", { old_password: oldPassword, new_password: newPassword });

export const getPreferences = () => request.get<"/me/preferences">("/me/preferences");

export const updatePreferences = async (notificationPreferences: Record<string, boolean>) =>
  request.patch<"/me/preferences">("/me/preferences", { notification_preferences: notificationPreferences });

export const getSessions = () => request.get<"/me/sessions">("/me/sessions");

export const revokeSession = (sessionId: string) => request.delete<"/me/sessions/{session_id}">(`/me/sessions/${sessionId}`);

export const revokeOtherSessions = () => request.post<"/me/sessions/revoke-others">("/me/sessions/revoke-others");

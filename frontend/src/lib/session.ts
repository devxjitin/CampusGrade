// Session helpers for cookie-based auth (Sprint 6).
//
// The access token lives in an httpOnly cookie (`campusgrade_access`) set by
// the backend and is invisible to JS by design — there is no client-side JWT
// decoding or token storage here anymore. "Who am I" is answered by calling
// `GET /auth/me` through the shared axios instance in api.ts; the result is
// cached in a module-level variable for the lifetime of the page so repeated
// consumers (AuthGate, DashboardLayout, page components) don't each trigger
// their own network round-trip.

import { api } from "./http";

export interface SessionUser {
  id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  role: "super_admin" | "program_admin" | "teacher" | "student";
  status?: string;
  program_ids?: string[];
  offering_ids?: string[];
  avatar?: string;
  must_change_password?: boolean;
  [key: string]: unknown;
}

/** True for either admin tier (super_admin or program_admin). */
export const isAdminRole = (role: string | undefined | null): boolean =>
  role === "super_admin" || role === "program_admin";

let cachedUser: SessionUser | null = null;
let fetchInFlight: Promise<SessionUser | null> | null = null;

/** Returns the in-memory cached user, if any, without making a network call. */
export const getCachedUser = (): SessionUser | null => cachedUser;

/** Seed the in-memory cache directly (e.g. from a login response body). */
export const setCachedUser = (user: SessionUser | null): void => {
  cachedUser = user;
};

export const clearSession = (): void => {
  cachedUser = null;
  fetchInFlight = null;
};

/**
 * Fetch the current user via GET /auth/me (cookie-authenticated).
 * Caches the result in memory; pass `force: true` to bypass the cache and
 * re-fetch (e.g. right after login/refresh).
 */
export const fetchCurrentUser = async (options: { force?: boolean } = {}): Promise<SessionUser | null> => {
  if (!options.force && cachedUser) return cachedUser;
  if (!fetchInFlight) {
    fetchInFlight = api
      .get<SessionUser>("/auth/me")
      .then(({ data }) => {
        cachedUser = data;
        return data;
      })
      .catch((err) => {
        cachedUser = null;
        throw err;
      })
      .finally(() => {
        fetchInFlight = null;
      });
  }
  return fetchInFlight;
};

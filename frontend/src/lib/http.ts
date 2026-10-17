// Shared axios instance + interceptors (Sprint 6 cookie/CSRF handling).
//
// Sprint 7 (the original implementation plan "Frontend shell rebuild"): this file used
// to be the top of src/lib/api.ts, which also held all 108 feature request
// functions in one file. Those functions now live in src/features/*/api.ts;
// this file keeps only the transport plumbing every feature api.ts imports:
// the configured axios instance, the CSRF header interceptor, the 401 ->
// refresh -> retry interceptor, and the `downloadBlob` file-download helper.

// TypeScript port of frontend-legacy/src/services/api.js.
//
// Sprint 6: auth moved from localStorage-JWT to httpOnly cookies. There is no
// access token for JS to read or attach anymore — the browser sends the
// `campusgrade_access` cookie automatically (withCredentials: true). Instead:
// every mutating request (POST/PUT/PATCH/DELETE) must echo the readable
// `campusgrade_csrf` cookie back as an `X-CSRF-Token` header (double-submit
// CSRF check), and a 401 triggers a single deduplicated POST /auth/refresh
// (which just rotates the httpOnly cookies server-side) before retrying the
// original request once.
//
// Typing note: request bodies/params below are typed loosely (Record<string,
// unknown> / primitives) rather than against the real Pydantic schemas.
// Once the backend is reachable, run `npm run gen:types` (openapi-typescript
// against /openapi.json) and progressively replace `unknown`/`any` here with
// the generated types from src/types/api.d.ts — see the original migration plan §6.

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { clearSession, type SessionUser } from "./session";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  withCredentials: true,
});

const CSRF_COOKIE_NAME = "campusgrade_csrf";
const CSRF_HEADER_METHODS = new Set(["post", "put", "patch", "delete"]);

const getCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
};

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (CSRF_HEADER_METHODS.has(method)) {
    const csrfToken = getCookie(CSRF_COOKIE_NAME);
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }
  return config;
});

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retriedAfterRefresh?: boolean;
}

interface RefreshResponse {
  message?: string;
  token?: string;
  user?: SessionUser;
  session_id?: string;
}

let refreshPromise: Promise<RefreshResponse> | null = null;

export const refreshAccessToken = async (): Promise<RefreshResponse> => {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<RefreshResponse>(`${API_URL}/auth/refresh`, {}, { withCredentials: true, timeout: 30000 })
      .then(({ data }) => {
        window.dispatchEvent(new CustomEvent("campusgrade:session-updated"));
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response) {
      const { status } = error.response;
      if (status === 401) {
        const requestConfig: RetryableConfig = error.response.config || {};
        const url = requestConfig.url || "";
        const isAuthRequest = url.includes("/login") || url.includes("/auth/refresh");
        if (!isAuthRequest && !requestConfig._retriedAfterRefresh) {
          try {
            await refreshAccessToken();
            requestConfig._retriedAfterRefresh = true;
            return api(requestConfig);
          } catch {
            clearSession();
            if (typeof window !== "undefined" && window.location.pathname !== "/login") {
              window.location.href = "/login?session=expired";
            }
          }
        } else if (!isAuthRequest) {
          clearSession();
          if (typeof window !== "undefined" && window.location.pathname !== "/login") {
            window.location.href = "/login?session=expired";
          }
        }
      }

      // Normalize backend error shapes once here so page components can render a single message field.
      if (error.response.data && error.response.data.detail) {
        if (typeof error.response.data.detail === "string") {
          error.response.data.message = error.response.data.detail;
        } else if (Array.isArray(error.response.data.detail)) {
          error.response.data.message = error.response.data.detail
            .map((err: { msg?: string }) => err.msg)
            .join(", ");
        }
      }
    }
    return Promise.reject(error);
  },
);

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};


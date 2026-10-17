import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Server-side route protection (Sprint 6). The backend validates the
// httpOnly session cookie and returns the canonical role. Protected role
// namespaces fail closed whenever that validation cannot be completed.
const ACCESS_COOKIE = "campusgrade_access";
const REFRESH_COOKIE = "campusgrade_refresh";

// Server-side calls to the API go straight to the backend container in
// production (API_INTERNAL_URL, e.g. http://api:5001). In `next dev` there is no
// such variable and the same-origin `/api` rewrite in next.config.ts is used.
const authMeUrl = (request: NextRequest): URL =>
  process.env.API_INTERNAL_URL
    ? new URL("/auth/me", process.env.API_INTERNAL_URL)
    : new URL("/api/auth/me", request.url);

type SessionRole = "super_admin" | "program_admin" | "teacher" | "student";

const allowedRolesForPath = (pathname: string): SessionRole[] | null => {
  if (pathname.startsWith("/platform/")) return ["super_admin"];
  if (pathname.startsWith("/admin/")) return ["super_admin", "program_admin"];
  return null;
};

export async function proxy(request: NextRequest) {
  const hasAccessCookie = request.cookies.has(ACCESS_COOKIE);
  if (!hasAccessCookie) {
    // The access cookie only lives 15 minutes, but the refresh cookie lasts days.
    // A missing access cookie therefore usually means "idle for a while", not
    // "logged out": send the browser through one client-side refresh instead of
    // the login page. (Refreshing here would race: Next.js prefetches many routes
    // at once and a rotated refresh token can only be used once.)
    if (request.cookies.has(REFRESH_COOKIE)) {
      const refreshUrl = new URL("/session/refresh", request.url);
      refreshUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(refreshUrl);
    }
    const loginUrl = new URL("/login?session=expired", request.url);
    return NextResponse.redirect(loginUrl);
  }
  const allowedRoles = allowedRolesForPath(request.nextUrl.pathname);
  if (allowedRoles) {
    try {
      const response = await fetch(authMeUrl(request), {
        headers: { cookie: request.headers.get("cookie") || "" },
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        return NextResponse.redirect(new URL("/login?session=expired", request.url));
      }
      if (!response.ok) return NextResponse.redirect(new URL("/login?session=unavailable", request.url));
      const principal = (await response.json()) as { role?: SessionRole };
      if (!principal.role || !allowedRoles.includes(principal.role)) {
        return NextResponse.redirect(new URL("/assignments?access=denied", request.url));
      }
    } catch {
      return NextResponse.redirect(new URL("/login?session=unavailable", request.url));
    }
  }
  return NextResponse.next();
}

// Scoped to the (dashboard) route group's real top-level URL prefixes:
// admin, assignments, dashboard, profile, settings (see src/app/(dashboard)/).
// Deliberately excludes /login, /api/*, and static assets.
export const config = {
  matcher: [
    "/admin/:path*",
    "/assignments/:path*",
    "/dashboard/:path*",
    "/profile/:path*",
    "/platform/:path*",
    "/settings/:path*",
  ],
};


import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Server-side route protection (Sprint 6). The backend validates the
// httpOnly session cookie and returns the canonical role. Protected role
// namespaces fail closed whenever that validation cannot be completed.
const ACCESS_COOKIE = "campusgrade_access";

type SessionRole = "super_admin" | "program_admin" | "teacher" | "student";

const allowedRolesForPath = (pathname: string): SessionRole[] | null => {
  if (pathname.startsWith("/platform/")) return ["super_admin"];
  if (pathname.startsWith("/admin/")) return ["super_admin", "program_admin"];
  return null;
};

export async function proxy(request: NextRequest) {
  const hasAccessCookie = request.cookies.has(ACCESS_COOKIE);
  if (!hasAccessCookie) {
    const loginUrl = new URL("/login?session=expired", request.url);
    return NextResponse.redirect(loginUrl);
  }
  const allowedRoles = allowedRolesForPath(request.nextUrl.pathname);
  if (allowedRoles) {
    try {
      const response = await fetch(new URL("/api/auth/me", request.url), {
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


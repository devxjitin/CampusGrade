"use client";

// Cookie-based auth gate (Sprint 6). The httpOnly access cookie is invisible
// to JS, so "am I logged in" is answered by calling GET /auth/me through the
// shared axios instance — if the access cookie is missing/expired, api.ts's
// existing 401 interceptor transparently calls /auth/refresh once and
// retries, so this component doesn't need its own refresh dance anymore.
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { fetchCurrentUser, getCachedUser, type SessionUser } from "@/lib/session";
import { LoadingState } from "./ui";

type SessionState = "checking" | "ready" | "missing";

export default function AuthGate({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles?: SessionUser["role"][];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionState, setSessionState] = useState<SessionState>("checking");

  useEffect(() => {
    let cancelled = false;
    const verifySession = async () => {
      try {
        const user = await fetchCurrentUser();
        if (cancelled) return;
        setSessionState(user ? "ready" : "missing");
      } catch {
        if (!cancelled) setSessionState("missing");
      }
    };
    verifySession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessionState !== "ready") return;
    const user = getCachedUser();
    if (!user) {
      router.replace("/login?session=expired");
      return;
    }
    if (user.must_change_password && pathname !== "/settings") {
      router.replace("/settings?password-change=required");
      return;
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      router.replace("/dashboard");
    }
  }, [sessionState, allowedRoles, pathname, router]);

  if (sessionState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Restoring your session…" />
      </div>
    );
  }

  if (sessionState === "missing" || !getCachedUser()) return null;

  return <>{children}</>;
}

"use client";

// Landing page for "access cookie expired, refresh cookie still valid".
// `src/proxy.ts` redirects here instead of to /login so an idle user is
// silently re-authenticated: one deduplicated POST /auth/refresh, then back to
// the page they asked for.
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { refreshAccessToken } from "@/lib/http";
import { LoadingState } from "@/components/ui";

const ATTEMPTS_KEY = "campusgrade_refresh_attempts";
const MAX_ATTEMPTS = 2;
const WINDOW_MS = 15_000;

// Only same-site relative paths: never an absolute URL or a protocol-relative `//host`.
const safeNext = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/assignments";

const tooManyAttempts = (): boolean => {
  try {
    const now = Date.now();
    const recent: number[] = (JSON.parse(window.sessionStorage.getItem(ATTEMPTS_KEY) || "[]") as number[]).filter(
      (at) => now - at < WINDOW_MS,
    );
    recent.push(now);
    window.sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(recent));
    return recent.length > MAX_ATTEMPTS;
  } catch {
    return false;
  }
};

function RefreshRunner() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));

  useEffect(() => {
    // A refresh that "succeeds" but never yields a usable access cookie would
    // bounce between here and the proxy forever; give up and show the login page.
    if (tooManyAttempts()) {
      window.location.replace("/login?session=expired");
      return;
    }
    refreshAccessToken()
      .then(() => window.location.replace(next))
      .catch(() => window.location.replace("/login?session=expired"));
  }, [next]);

  return <LoadingState label="Restoring your session…" />;
}

export default function SessionRefreshPage() {
  return (
    <Suspense fallback={<LoadingState label="Restoring your session…" />}>
      <RefreshRunner />
    </Suspense>
  );
}

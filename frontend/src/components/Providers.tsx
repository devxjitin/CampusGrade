"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "@/lib/query-client";
import ErrorBoundary from "./ErrorBoundary";
import { ToastProvider } from "./Toast";
import { ConfirmDialogProvider } from "./ui";

// Mirrors the provider nesting in frontend-legacy/src/App.jsx:
// ErrorBoundary > ToastProvider > ConfirmDialogProvider > (router, handled
// by Next.js itself) > page tree. QueryClientProvider is new — see
// lib/query-client.ts.
export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

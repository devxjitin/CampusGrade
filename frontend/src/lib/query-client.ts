import { QueryClient } from "@tanstack/react-query";

// One QueryClient per browser tab. Defaults are conservative — pages opt
// into shorter staleTime/refetch behavior per-query as they're migrated;
// this is the "genuinely new adoption" piece called out in
// the original migration plan (frontend-legacy never actually used TanStack Query).
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

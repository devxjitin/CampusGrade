// TanStack Query layer for the Super Admin Jobs page (Sprint 2, S2-12).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJobs, retryJob } from "./api";
import type { JobFilters } from "./types";

export const jobKeys = {
  all: ["jobs"] as const,
  list: (filters: JobFilters) => [...jobKeys.all, "list", filters] as const,
};

// Jobs change on their own as the worker runs, so keep the list fresh while the page is open.
export const useJobs = (filters: JobFilters) =>
  useQuery({ queryKey: jobKeys.list(filters), queryFn: () => getJobs(filters), refetchInterval: 10_000, staleTime: 0 });

export const useRetryJob = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => retryJob(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: jobKeys.all }),
  });
};

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getExports, requestExport } from "./api";

export const exportKeys = { all: ["exports"] as const };

// A queued export becomes ready on its own once the worker has built it, so poll while the page is open.
export const useExports = () => useQuery({ queryKey: exportKeys.all, queryFn: getExports, refetchInterval: 4_000, staleTime: 0 });

export const useRequestExport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => requestExport(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: exportKeys.all }),
  });
};

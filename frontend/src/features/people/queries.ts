// TanStack Query layer for admin user directory.
// Sprint 7 (the original implementation plan "Frontend shell rebuild"), item 5.
//
// Known gap (see the original sprint status): only the query-key factory plus a
// couple of representative read hooks are wired here so far — most call
// sites in this feature still call src/features/people/api.ts functions
// directly from useEffect/useState (unchanged behaviour from before this
// sprint). Converting every remaining call site is real, separate,
// behaviour-risking work the plan's own "Risk" note says to do as a
// second pass, not bundled into the mechanical file-move.
import { useQuery } from "@tanstack/react-query";
import { getAdminUsers, getAdminUserDetails } from "./api";

export const peopleKeys = {
  all: ["people"] as const,
};

export const useAdminUsers = (params?: Record<string, unknown>) =>
  useQuery({ queryKey: [...peopleKeys.all, "adminUsers", params ?? {}], queryFn: () => getAdminUsers(params) });

export const useAdminUserDetails = (userId: string) =>
  useQuery({ queryKey: [...peopleKeys.all, "adminUserDetails", userId], queryFn: () => getAdminUserDetails(userId) });


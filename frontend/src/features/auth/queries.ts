// TanStack Query layer for session/profile/preferences.
// Sprint 7 (the original implementation plan "Frontend shell rebuild"), item 5.
//
// Known gap (see the original sprint status): only the query-key factory plus a
// couple of representative read hooks are wired here so far — most call
// sites in this feature still call src/features/auth/api.ts functions
// directly from useEffect/useState (unchanged behaviour from before this
// sprint). Converting every remaining call site is real, separate,
// behaviour-risking work the plan's own "Risk" note says to do as a
// second pass, not bundled into the mechanical file-move.
import { useQuery } from "@tanstack/react-query";
import { getProfile, getPreferences, getSessions } from "./api";

export const authKeys = {
  all: ["auth"] as const,
};

export const useProfile = () =>
  useQuery({ queryKey: [...authKeys.all, "profile"], queryFn: getProfile });

export const usePreferences = () =>
  useQuery({ queryKey: [...authKeys.all, "preferences"], queryFn: getPreferences });

export const useSessions = () =>
  useQuery({ queryKey: [...authKeys.all, "sessions"], queryFn: getSessions });


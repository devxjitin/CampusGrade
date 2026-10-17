// TanStack Query layer for grading/roster/repository tools.
// Sprint 7 (the original implementation plan "Frontend shell rebuild"), item 5.
//
// Known gap (see the original sprint status): only the query-key factory plus a
// couple of representative read hooks are wired here so far — most call
// sites in this feature still call src/features/grading/api.ts functions
// directly from useEffect/useState (unchanged behaviour from before this
// sprint). Converting every remaining call site is real, separate,
// behaviour-risking work the plan's own "Risk" note says to do as a
// second pass, not bundled into the mechanical file-move.
import { useQuery } from "@tanstack/react-query";
import { getAssignmentRoster } from "./api";

export const gradingKeys = {
  all: ["grading"] as const,
};

export const useAssignmentRoster = (assignmentId: string) =>
  useQuery({ queryKey: [...gradingKeys.all, "assignmentRoster", assignmentId], queryFn: () => getAssignmentRoster(assignmentId) });


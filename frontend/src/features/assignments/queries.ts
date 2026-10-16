// TanStack Query layer for assignment CRUD/detail across roles.
// Sprint 7 (IMPLEMENTATION_PLAN.md "Frontend shell rebuild"), item 5.
//
// Known gap (see SPRINT_STATUS.md): only the query-key factory plus a
// couple of representative read hooks are wired here so far — most call
// sites in this feature still call src/features/assignments/api.ts functions
// directly from useEffect/useState (unchanged behaviour from before this
// sprint). Converting every remaining call site is real, separate,
// behaviour-risking work the plan's own "Risk" note says to do as a
// second pass, not bundled into the mechanical file-move.
import { useQuery } from "@tanstack/react-query";
import { getTeacherAssignments, getStudentAssignments, getAdminAssignments } from "./api";

export const assignmentsKeys = {
  all: ["assignments"] as const,
};

export const useTeacherAssignments = () =>
  useQuery({ queryKey: [...assignmentsKeys.all, "teacherAssignments"], queryFn: getTeacherAssignments });

export const useStudentAssignments = () =>
  useQuery({ queryKey: [...assignmentsKeys.all, "studentAssignments"], queryFn: getStudentAssignments });

export const useAdminAssignments = (params?: Record<string, unknown>) =>
  useQuery({ queryKey: [...assignmentsKeys.all, "adminAssignments", params ?? {}], queryFn: () => getAdminAssignments(params) });


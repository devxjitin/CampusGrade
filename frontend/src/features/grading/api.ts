// Grading, rosters, and repository-fetching tools used by teacher grading
// workflows.
// Sprint 7: split out of src/lib/api.ts.
import { downloadBlob } from "@/lib/http";
import { request, type ApiRequestBody } from "@/types/api-client";

export const getAssignmentRoster = (id: string) => request.get<"/assignments/teacher/{assignment_id}/roster">(`/assignments/teacher/${id}/roster`);

export const getAssignmentRepository = async (assignmentId: string, versionId: string) =>
  request.get<"/assignments/teacher/{assignment_id}/repository/{version_id}">(`/assignments/teacher/${assignmentId}/repository/${versionId}`);

export const getAssignmentRepositoryFile = async (assignmentId: string, versionId: string, path: string) =>
  request.get<"/assignments/teacher/{assignment_id}/repository/{version_id}/file">(`/assignments/teacher/${assignmentId}/repository/${versionId}/file`, {
    params: { path },
    responseType: "text",
  });

export const fetchAllAssignmentRepositories = async (assignmentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/repositories/fetch-all">(`/assignments/teacher/${assignmentId}/repositories/fetch-all`);

export const startStudentEvaluation = async (assignmentId: string, studentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/students/{student_id}/evaluation/start">(`/assignments/teacher/${assignmentId}/students/${studentId}/evaluation/start`);

export const resetStudentRepository = async (assignmentId: string, studentId: string, reason?: string) =>
  request.post<"/assignments/teacher/{assignment_id}/students/{student_id}/repository/reset">(`/assignments/teacher/${assignmentId}/students/${studentId}/repository/reset`, { reason: reason ?? "" });

export const saveAssignmentGrade = async (assignmentId: string, studentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/grades/{student_id}", "put">) =>
  request.put<"/assignments/teacher/{assignment_id}/grades/{student_id}">(`/assignments/teacher/${assignmentId}/grades/${studentId}`, payload);

export const publishAssignmentGrade = async (assignmentId: string, studentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/grades/{student_id}/publish">(`/assignments/teacher/${assignmentId}/grades/${studentId}/publish`);

export const publishAllAssignmentGrades = async (assignmentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/grades/publish-all">(`/assignments/teacher/${assignmentId}/grades/publish-all`);

export const withdrawAssignmentGrade = async (assignmentId: string, studentId: string, reason?: string) =>
  request.post<"/assignments/teacher/{assignment_id}/grades/{student_id}/withdraw">(`/assignments/teacher/${assignmentId}/grades/${studentId}/withdraw`, { reason: reason ?? "" });

// ─── Assignment mode: admin ──────────────────────────────────────────────

export const downloadAssignmentGradebook = async (id: string, filename = "assignment-gradebook.csv") => {
  const response = await request.rawGet<"/assignments/teacher/{assignment_id}/gradebook.csv">(`/assignments/teacher/${id}/gradebook.csv`, { responseType: "blob" });
  downloadBlob(response.data, filename);
};

// ─── Advanced assignment workspaces ──────────────────────────────────────

export const getTeacherAssignmentAnalytics = () => request.get<"/assignments/teacher-tools/analytics">("/assignments/teacher-tools/analytics");

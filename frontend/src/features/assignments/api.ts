// Assignment CRUD/detail across teacher, student, and admin modes, plus
// discussions/announcements.
// Sprint 7: split out of src/lib/api.ts.
import { downloadBlob } from "@/lib/http";
import { request, type ApiRequestBody } from "@/types/api-client";

export const getTeacherAssignments = () => request.get<"/assignments/teacher">("/assignments/teacher");

export const getTeacherAssignmentRecords = () => request.get<"/assignments/teacher/records">("/assignments/teacher/records");

export const getTeacherAssignment = (id: string) => request.get<"/assignments/teacher/{assignment_id}">(`/assignments/teacher/${id}`);

export const createAssignment = async (payload: ApiRequestBody<"/assignments/teacher", "post">) =>
  request.post<"/assignments/teacher">("/assignments/teacher", payload);

export const updateAssignment = async (id: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}", "put">) =>
  request.put<"/assignments/teacher/{assignment_id}">(`/assignments/teacher/${id}`, payload);

export const deleteAssignment = (id: string) => request.delete<"/assignments/teacher/{assignment_id}">(`/assignments/teacher/${id}`);

export const uploadAssignmentAttachment = async (id: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return request.post<"/assignments/teacher/{assignment_id}/attachments">(`/assignments/teacher/${id}/attachments`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const deleteAssignmentAttachment = async (id: string, resourceId: string) =>
  request.delete<"/assignments/teacher/{assignment_id}/attachments/{resource_id}">(`/assignments/teacher/${id}/attachments/${resourceId}`);

// ─── Assignment mode: student ────────────────────────────────────────────

export const getStudentAssignments = () => request.get<"/assignments/student">("/assignments/student");

export const getStudentAssignment = (id: string) => request.get<"/assignments/student/{assignment_id}">(`/assignments/student/${id}`);

export const downloadAssignmentResource = async (assignmentId: string, resourceId: string, filename?: string) => {
  const response = await request.rawGet<"/assignments/student/{assignment_id}/resources/{resource_id}">(`/assignments/student/${assignmentId}/resources/${resourceId}`, {
    responseType: "blob",
  });
  downloadBlob(response.data, filename || "attachment");
};

export const previewAssignmentRepository = async (id: string, repositoryUrl: string) =>
  request.post<"/assignments/student/{assignment_id}/repository-preview">(`/assignments/student/${id}/repository-preview`, { repository_url: repositoryUrl });

export const submitAssignmentRepository = async (id: string, previewToken: string) =>
  request.post<"/assignments/student/{assignment_id}/submit">(`/assignments/student/${id}/submit`, { preview_token: previewToken });

export const syncAssignmentRepository = async (id: string) =>
  request.post<"/assignments/student/{assignment_id}/repository/sync">(`/assignments/student/${id}/repository/sync`);

export const getStudentRepository = (id: string) => request.get<"/assignments/student/{assignment_id}/repository">(`/assignments/student/${id}/repository`);

export const getStudentRepositoryFile = async (id: string, path: string) =>
  request.get<"/assignments/student/{assignment_id}/repository/file">(`/assignments/student/${id}/repository/file`, { params: { path }, responseType: "text" });

// ─── Assignment mode: teacher grading/repository tools ──────────────────

export const getAdminAssignments = async (params: Record<string, unknown> = {}) =>
  request.get<"/assignments/admin">("/assignments/admin", { params });

export const getAdminAssignmentOverview = () => request.get<"/assignments/admin/overview">("/assignments/admin/overview");

export const getAdminAssignmentDashboard = async (params: Record<string, unknown> = {}) =>
  request.get<"/assignments/admin-tools/dashboard">("/assignments/admin-tools/dashboard", { params });

export const getAdminAssignmentDetail = (id: string) => request.get<"/assignments/admin/{assignment_id}">(`/assignments/admin/${id}`);

export const deleteAdminAssignment = (id: string) => request.delete<"/assignments/admin/{assignment_id}">(`/assignments/admin/${id}`);

export const getStudentAssignmentDashboard = () => request.get<"/assignments/student-tools/dashboard">("/assignments/student-tools/dashboard");

export const getStudentAssignmentSubjects = () => request.get<"/assignments/student-tools/subjects">("/assignments/student-tools/subjects");

export const createAssignmentAnnouncement = async (id: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/announcements", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/announcements">(`/assignments/teacher/${id}/announcements`, payload);

export const getStudentAssignmentThreads = () => request.get<"/assignments/student-tools/threads">("/assignments/student-tools/threads");

export const createAssignmentThread = async (id: string, payload: ApiRequestBody<"/assignments/student-tools/{assignment_id}/threads", "post">) =>
  request.post<"/assignments/student-tools/{assignment_id}/threads">(`/assignments/student-tools/${id}/threads`, payload);

export const getTeacherAssignmentThreads = () => request.get<"/assignments/teacher-tools/threads">("/assignments/teacher-tools/threads");

export const replyAssignmentThread = async (id: string, body: string) =>
  request.post<"/assignments/discussion/threads/{thread_id}/messages">(`/assignments/discussion/threads/${id}/messages`, { message: body });

export const updateAssignmentThreadStatus = async (id: string, status: "open" | "resolved") =>
  request.patch<"/assignments/teacher-tools/threads/{thread_id}">(`/assignments/teacher-tools/threads/${id}`, { status });

export const performAdminAssignmentAction = async (id: string, payload: ApiRequestBody<"/assignments/admin-tools/{assignment_id}/action", "post">) =>
  request.post<"/assignments/admin-tools/{assignment_id}/action">(`/assignments/admin-tools/${id}/action`, payload);

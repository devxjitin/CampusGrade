// Assignment CRUD/detail across teacher, student, and admin modes, plus
// announcements.
// Sprint 7: split out of src/lib/api.ts.
import axios from "axios";
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

// Uploads go straight to object storage through a presigned PUT, so the API never
// handles the bytes. When the backend can't presign (local dev storage) the file
// falls back to the multipart endpoint. `onProgress` receives 0..100.
export const uploadAssignmentAttachment = async (id: string, file: File, onProgress?: (percent: number) => void) => {
  const contentType = file.type || "application/octet-stream";
  const presign = await request.post<"/assignments/teacher/{assignment_id}/attachments/presign">(`/assignments/teacher/${id}/attachments/presign`, {
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
  });
  if (!presign.upload_url) {
    const form = new FormData();
    form.append("file", file);
    return request.post<"/assignments/teacher/{assignment_id}/attachments">(`/assignments/teacher/${id}/attachments`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (event) => onProgress?.(event.total ? Math.round((event.loaded / event.total) * 100) : 0),
    });
  }
  await axios.put(presign.upload_url, file, {
    headers: { "Content-Type": contentType },
    onUploadProgress: (event) => onProgress?.(event.total ? Math.round((event.loaded / event.total) * 100) : 0),
  });
  return request.post<"/assignments/teacher/{assignment_id}/attachments/complete">(`/assignments/teacher/${id}/attachments/complete`, {
    resource_id: presign.resource_id,
    filename: file.name,
    content_type: contentType,
  });
};

export const deleteAssignmentAttachment = async (id: string, resourceId: string) =>
  request.delete<"/assignments/teacher/{assignment_id}/attachments/{resource_id}">(`/assignments/teacher/${id}/attachments/${resourceId}`);

// ─── Assignment mode: student ────────────────────────────────────────────

export const getStudentAssignments = () => request.get<"/assignments/student">("/assignments/student");

export const getStudentAssignment = (id: string) => request.get<"/assignments/student/{assignment_id}">(`/assignments/student/${id}`);

export const downloadAssignmentResource = async (assignmentId: string, resourceId: string, filename?: string) => {
  const { url } = await request.get<"/assignments/student/{assignment_id}/resources/{resource_id}/url">(
    `/assignments/student/${assignmentId}/resources/${resourceId}/url`,
  );
  if (url) {
    // Presigned link: the browser fetches the file from object storage directly.
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "attachment";
    link.click();
    return;
  }
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

export const performAdminAssignmentAction = async (id: string, payload: ApiRequestBody<"/assignments/admin-tools/{assignment_id}/action", "post">) =>
  request.post<"/assignments/admin-tools/{assignment_id}/action">(`/assignments/admin-tools/${id}/action`, payload);

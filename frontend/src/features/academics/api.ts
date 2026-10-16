// Programs/batches/sections/subjects/academic-sessions/rollover.
// Sprint 7: split out of src/lib/api.ts.
import { request, type ApiRequestBody } from "@/types/api-client";

export const getTeacherCourses = () => request.get<"/assignments/teacher-tools/targets">("/assignments/teacher-tools/targets");

// ─── Admin: User management ──────────────────────────────────────────────

export const getCourses = (params: Record<string, unknown> = {}) => request.get<"/admin/courses">("/admin/courses", { params });

export const createCourse = (data: ApiRequestBody<"/admin/courses", "post">) => request.post<"/admin/courses">("/admin/courses", data);

export const updateCourse = (id: string, data: ApiRequestBody<"/admin/courses/{course_id}", "put">) => request.put<"/admin/courses/{course_id}">(`/admin/courses/${id}`, data);

export const deleteCourse = (id: string) => request.delete<"/admin/courses/{course_id}">(`/admin/courses/${id}`);

export const getBatches = (params: Record<string, unknown> = {}) => request.get<"/admin/batches">("/admin/batches", { params });

export const createBatch = (data: ApiRequestBody<"/admin/batches", "post">) => request.post<"/admin/batches">("/admin/batches", data);

export const updateBatch = (id: string, data: ApiRequestBody<"/admin/batches/{batch_id}", "put">) => request.put<"/admin/batches/{batch_id}">(`/admin/batches/${id}`, data);

export const deleteBatch = (id: string) => request.delete<"/admin/batches/{batch_id}">(`/admin/batches/${id}`);

export const getSections = (params: Record<string, unknown> = {}) => request.get<"/admin/sections">("/admin/sections", { params });

export const createSection = (data: ApiRequestBody<"/admin/sections", "post">) => request.post<"/admin/sections">("/admin/sections", data);

export const updateSection = (id: string, data: ApiRequestBody<"/admin/sections/{section_id}", "put">) => request.put<"/admin/sections/{section_id}">(`/admin/sections/${id}`, data);

export const deleteSection = (id: string) => request.delete<"/admin/sections/{section_id}">(`/admin/sections/${id}`);

export const getSubjects = (params: Record<string, unknown> = {}) => request.get<"/admin/subjects">("/admin/subjects", { params });

export const createSubject = (data: ApiRequestBody<"/admin/subjects", "post">) => request.post<"/admin/subjects">("/admin/subjects", data);

export const updateSubject = (id: string, data: ApiRequestBody<"/admin/subjects/{subject_id}", "put">) => request.put<"/admin/subjects/{subject_id}">(`/admin/subjects/${id}`, data);

export const deleteSubject = (id: string) => request.delete<"/admin/subjects/{subject_id}">(`/admin/subjects/${id}`);

// ─── Admin: academic sessions (topbar session switcher) ──────────────────

export const getAcademicSessions = () => request.get<"/admin/academic-sessions">("/admin/academic-sessions");

export const createAcademicSession = (data: ApiRequestBody<"/admin/academic-sessions", "post">) => request.post<"/admin/academic-sessions">("/admin/academic-sessions", data);

export const updateAcademicSession = async (id: string, data: ApiRequestBody<"/admin/academic-sessions/{session_id}", "put">) =>
  request.put<"/admin/academic-sessions/{session_id}">(`/admin/academic-sessions/${id}`, data);

export const deleteAcademicSession = (id: string) => request.delete<"/admin/academic-sessions/{session_id}">(`/admin/academic-sessions/${id}`);

// ─── Admin: session rollover (promote students to the next session) ──────

export const previewSessionRollover = () => request.get<"/admin/session-rollover/preview">("/admin/session-rollover/preview");

export const executeSessionRollover = () => request.post<"/admin/session-rollover/execute">("/admin/session-rollover/execute");

export const undoSessionRollover = (runId: string) => request.post<"/admin/session-rollover/{run_id}/undo">(`/admin/session-rollover/${runId}/undo`);

export const getSessionRolloverHistory = () => request.get<"/admin/session-rollover/history">("/admin/session-rollover/history");

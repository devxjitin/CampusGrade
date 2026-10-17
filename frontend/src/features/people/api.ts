// Admin user management (students/teachers/user directory).
// Sprint 7: split out of src/lib/api.ts.
import type { AccessLevel, AccessResource } from "@/lib/session";
import { request, type ApiRequestBody } from "@/types/api-client";

export type AdminAccess = Partial<Record<AccessResource, AccessLevel>>;

export interface AdminAccount {
  id: string;
  name: string;
  email: string;
  role: "super_admin" | "admin";
  is_active: boolean;
  access: AdminAccess;
}

export interface AdminCreateInput {
  name: string;
  email: string;
  role: "admin";
  access: AdminAccess;
}

export const getAdmins = () =>
  request.get<"/admin/admins">("/admin/admins") as Promise<{ admins: AdminAccount[] }>;

export const createAdmin = (data: AdminCreateInput) =>
  request.post<"/admin/admins">("/admin/admins", data) as Promise<{
    message: string;
    temporary_password: string;
    user: AdminAccount;
  }>;

export const replaceAdminAccess = (adminId: string, access: AdminAccess) =>
  request.put<"/admin/admins/{admin_id}/access">(`/admin/admins/${adminId}/access`, {
    access,
  }) as Promise<{ message: string; access: AdminAccess }>;

export const addStudent = async (studentData: ApiRequestBody<"/admin/add-student", "post">) =>
  request.post<"/admin/add-student">("/admin/add-student", studentData);

export const addTeacher = async (teacherData: ApiRequestBody<"/admin/add-teacher", "post">) =>
  request.post<"/admin/add-teacher">("/admin/add-teacher", teacherData);

export const importTeachers = async (file: File, options: { dryRun?: boolean } = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("dry_run", String(Boolean(options.dryRun)));
  return request.post<"/admin/import-teachers">("/admin/import-teachers", formData, { headers: { "Content-Type": "multipart/form-data" } });
};

export const importStudents = async (file: File, options: { dryRun?: boolean } = {}) => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("dry_run", String(Boolean(options.dryRun)));
  return request.post<"/admin/import-students">("/admin/import-students", formData, { headers: { "Content-Type": "multipart/form-data" } });
};

export const getAdminUsers = (params: Record<string, unknown> = {}) => request.get<"/admin/users">("/admin/users", { params });

export const getAdminStudentProfile = (userId: string) => request.get<"/admin/user/{user_id}/profile">(`/admin/user/${userId}/profile`);

export const getAdminUserDetails = (userId: string) => request.get<"/admin/user/{user_id}/details">(`/admin/user/${userId}/details`);

export const toggleUserStatus = async (userId: string, isActive: boolean) =>
  request.patch<"/admin/user/{user_id}">(`/admin/user/${userId}`, { is_active: isActive });

export const updateAdminUser = async (userId: string, userData: ApiRequestBody<"/admin/user/{user_id}", "put">) =>
  request.put<"/admin/user/{user_id}">(`/admin/user/${userId}`, userData);

export const resetAdminUserPassword = (userId: string) => request.patch<"/admin/user/{user_id}/reset-password">(`/admin/user/${userId}/reset-password`);

export const deleteUser = (userId: string) => request.delete<"/admin/user/{user_id}">(`/admin/user/${userId}`);

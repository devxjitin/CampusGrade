// Notifications, audit log, assignment-monitoring settings.
// Sprint 7: split out of src/lib/api.ts.
import { request, type ApiRequestBody } from "@/types/api-client";

export const getNotifications = () => request.get<"/notifications">("/notifications");

export const markNotificationRead = (id: string) => request.patch<"/notifications/{notification_id}/read">(`/notifications/${id}/read`);

export const markAllNotificationsRead = () => request.post<"/notifications/mark-all-read">("/notifications/mark-all-read");

export const getAuditLog = (params: Record<string, unknown> = {}) => request.get<"/admin/audit-log">("/admin/audit-log", { params });

export const getAssignmentMonitoringSettings = () => request.get<"/admin/settings/assignment-monitoring">("/admin/settings/assignment-monitoring");

export const updateAssignmentMonitoringSettings = async (settings: ApiRequestBody<"/admin/settings/assignment-monitoring", "put">) =>
  request.put<"/admin/settings/assignment-monitoring">("/admin/settings/assignment-monitoring", settings);

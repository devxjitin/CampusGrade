// TanStack Query layer for notifications/audit-log/monitoring-settings.
// Sprint 7 (the original implementation plan "Frontend shell rebuild"), item 5.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiRequestBody } from "@/types/api-client";
import {
  getAssignmentMonitoringSettings,
  getAuditLog,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateAssignmentMonitoringSettings,
} from "./api";

export const reportingKeys = {
  all: ["reporting"] as const,
  notifications: () => [...reportingKeys.all, "notifications"] as const,
  auditLog: (params?: Record<string, unknown>) => [...reportingKeys.all, "audit-log", params ?? {}] as const,
  monitoringSettings: () => [...reportingKeys.all, "monitoring-settings"] as const,
};

/**
 * Used by DashboardLayout, which now mounts once in (app)/layout.tsx
 * instead of per-page (see Sprint 7 notes) — a single subscription here
 * means navigating between pages no longer destroys and re-fetches this
 * query. Not yet wired into DashboardLayout itself (it still manages its
 * own notification state with useState/useEffect) — see the original sprint status
 * "known gaps" for why that swap was left for a follow-up.
 */
export const useNotifications = () =>
  useQuery({ queryKey: reportingKeys.notifications(), queryFn: getNotifications });

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reportingKeys.notifications() }),
  });
};

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reportingKeys.notifications() }),
  });
};

export const useAuditLog = (params?: Record<string, unknown>) =>
  useQuery({ queryKey: reportingKeys.auditLog(params), queryFn: () => getAuditLog(params) });

export const useAssignmentMonitoringSettings = () =>
  useQuery({ queryKey: reportingKeys.monitoringSettings(), queryFn: getAssignmentMonitoringSettings });

export const useUpdateAssignmentMonitoringSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: ApiRequestBody<"/admin/settings/assignment-monitoring", "put">) =>
      updateAssignmentMonitoringSettings(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reportingKeys.monitoringSettings() }),
  });
};

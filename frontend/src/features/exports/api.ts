// Super Admin session exports (Sprint 5, S5-04): request, list, download.
import { request } from "@/types/api-client";
import type { DataExport } from "./types";

export const getExports = async (): Promise<{ exports: DataExport[] }> => request.get<"/admin/exports">("/admin/exports");

export const requestExport = async (sessionId: string): Promise<DataExport> =>
  request.post<"/admin/exports">("/admin/exports", { session_id: sessionId });

export const getExportUrl = async (id: string): Promise<{ url: string | null }> =>
  request.get<"/admin/exports/{export_id}/url">(`/admin/exports/${id}/url`);

/** Same-origin streaming fallback for storage backends that cannot presign. */
export const exportFilePath = (id: string) => `/api/admin/exports/${id}/file`;

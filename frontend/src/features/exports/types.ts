export type ExportStatus = "queued" | "ready" | "failed";

export interface DataExport {
  id: string;
  session_id: string;
  session_label: string | null;
  status: ExportStatus;
  filename: string | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string | null;
  finished_at: string | null;
}

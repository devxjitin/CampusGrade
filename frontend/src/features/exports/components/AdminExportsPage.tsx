"use client";

// Super Admin → Data exports (Sprint 5, S5-04): a session's grades and audit log as a ZIP of CSVs.
import { useEffect, useState } from "react";
import { Download, FileArchive } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, PageHeader, SelectField, StatusBadge } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { getAcademicSessions } from "@/features/academics/api";
import { formatDateTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { exportFilePath, getExportUrl } from "../api";
import { useExports, useRequestExport } from "../queries";
import type { DataExport } from "../types";

interface SessionOption {
  id: string;
  label: string;
  term: string;
}

const badgeFor = (status: DataExport["status"]) =>
  status === "ready" ? { status: "completed", label: "Ready" } : status === "failed" ? { status: "failed", label: "Failed" } : { status: "in_progress", label: "Preparing" };

const sizeLabel = (bytes: number | null) => (bytes === null ? "—" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default function AdminExportsPage() {
  const toast = useToast();
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionId, setSessionId] = useState("");
  const { data, isPending, isError, refetch } = useExports();
  const request = useRequestExport();

  useEffect(() => {
    getAcademicSessions()
      .then((result) => {
        const list = ((result as { sessions?: SessionOption[] }).sessions || []) as SessionOption[];
        setSessions(list);
        setSessionId((current) => current || list[0]?.id || "");
      })
      .catch((error) => toast.error(getErrorMessage(error, "Academic sessions could not be loaded.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the session list once
  }, []);

  const download = async (item: DataExport) => {
    try {
      const { url } = await getExportUrl(item.id);
      const link = document.createElement("a");
      link.href = url || exportFilePath(item.id);
      link.download = item.filename || "export.zip";
      link.click();
    } catch (error) {
      toast.error(getErrorMessage(error, "The export could not be downloaded."));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Data exports"
        description="Export one academic session's grades and audit log as CSV files in a ZIP. The file is built in the background and contains personal data."
      />

      <section className="card mb-6 p-5" aria-labelledby="new-export">
        <h2 id="new-export" className="text-base font-bold text-slate-900">Request an export</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!sessionId) return;
            request.mutate(sessionId, {
              onSuccess: () => toast.success("Export requested. It appears below when it is ready."),
              onError: (error) => toast.error(getErrorMessage(error, "The export could not be requested.")),
            });
          }}
        >
          <div className="min-w-[16rem]">
            <SelectField label="Academic session" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              {sessions.length === 0 && <option value="">No sessions</option>}
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label} ({session.term === "odd" ? "Odd" : "Even"})
                </option>
              ))}
            </SelectField>
          </div>
          <button type="submit" className="btn btn-primary" disabled={!sessionId || request.isPending}>
            <FileArchive className="h-4 w-4" aria-hidden="true" />
            Request export
          </button>
        </form>
      </section>

      <section className="card overflow-hidden" aria-label="Exports">
        {isPending ? (
          <LoadingState label="Loading exports…" />
        ) : isError ? (
          <ErrorState title="Exports could not be loaded" onRetry={() => refetch()} />
        ) : data.exports.length === 0 ? (
          <EmptyState title="No exports yet" description="Request one above. Finished files stay available here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Requested data exports</caption>
              <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-5 py-3">Session</th>
                  <th scope="col" className="px-5 py-3">Status</th>
                  <th scope="col" className="px-5 py-3">Size</th>
                  <th scope="col" className="px-5 py-3">Requested</th>
                  <th scope="col" className="px-5 py-3 text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.exports.map((item) => {
                  const badge = badgeFor(item.status);
                  return (
                    <tr key={item.id}>
                      <th scope="row" className="px-5 py-3 font-semibold text-slate-900">{item.session_label || item.session_id}</th>
                      <td className="px-5 py-3">
                        <StatusBadge status={badge.status} label={badge.label} />
                        {item.error && <p className="mt-1 text-xs text-rose-800">{item.error}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-700">{sizeLabel(item.size_bytes)}</td>
                      <td className="px-5 py-3 text-slate-700">{item.created_at ? formatDateTime(item.created_at, { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {item.status === "ready" && (
                          <button type="button" className="btn btn-outline" onClick={() => download(item)} aria-label={`Download export for ${item.session_label || item.session_id}`}>
                            <Download className="h-4 w-4" aria-hidden="true" />
                            Download
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

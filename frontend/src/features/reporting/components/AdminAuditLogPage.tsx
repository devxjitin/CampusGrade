"use client";

// Ported from frontend-legacy/src/pages/AdminAuditLog.jsx
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardList, Clock3, MapPin, Search, ShieldCheck, UserRound } from "lucide-react";
import { EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { getAuditLog } from "@/features/reporting/api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/datetime";
import { getCachedUser } from "@/lib/session";

interface AuditLogEntry {
  _id: string;
  action: string;
  action_label?: string;
  description?: string;
  actor?: { name?: string; role?: string };
  actor_id?: string;
  subject?: { label?: string };
  timestamp?: string;
  ip_address?: string;
  details?: Record<string, unknown>;
}

interface AuditLogData {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  per_page: number;
}

const formatDate = (value?: string) => (value ? formatDateTime(value) : "—");
const labelize = (value: unknown) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function AdminAuditLogPage() {
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();
  const [data, setData] = useState<AuditLogData>({ logs: [], total: 0, page: 1, per_page: 20 });
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  const load = async (page = data.page) => {
    setLoading(true);
    try {
      setData(await getAuditLog({ page, per_page: 20, ...(action ? { action } : {}) }));
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Audit log could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => load(1), 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const pageCount = Math.max(1, Math.ceil((data.total || 0) / data.per_page));
  const actorName = (log: AuditLogEntry) => log.actor?.name || (log.actor_id === "system" ? "System automation" : "Former user");
  const actorRole = (log: AuditLogEntry) => (log.actor?.role ? labelize(log.actor.role) : null);

  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log" description="A clear, read-only history of assignment and administration activity." />

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <label className="ui-search-field max-w-md">
            <Search className="h-4 w-4" />
            <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Search activity, for example published or created" />
          </label>
          <p className="text-sm text-slate-500">{data.total || 0} recorded activities</p>
        </div>

        {loading ? (
          <LoadingState label="Loading activity history…" />
        ) : data.logs.length === 0 ? (
          <EmptyState title="No matching activities" description="Try a different activity search." />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.logs.map((log) => (
              <button key={log._id} className="grid w-full gap-4 p-5 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,1fr)_13rem]" onClick={() => setSelected(log)}>
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                    <ClipboardList className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-slate-900">{log.action_label || log.action}</strong>
                    <span className="mt-1 block text-sm leading-5 text-slate-600">{log.description || `${actorName(log)} performed this activity.`}</span>
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="h-3.5 w-3.5" />
                        {actorName(log)}
                        {actorRole(log) ? ` · ${actorRole(log)}` : ""}
                      </span>
                      {log.subject?.label && (
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          {log.subject.label}
                        </span>
                      )}
                    </span>
                  </span>
                </div>
                <span className="space-y-1 text-xs text-slate-500 md:text-right">
                  <span className="flex items-center gap-1 md:justify-end">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatDate(log.timestamp)}
                  </span>
                  <span className="flex items-center gap-1 md:justify-end">
                    <MapPin className="h-3.5 w-3.5" />
                    {log.ip_address || "System activity"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 p-4">
          <button className="btn btn-outline text-sm" disabled={data.page <= 1} onClick={() => load(data.page - 1)}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {data.page} of {pageCount}
          </span>
          <button className="btn btn-outline text-sm" disabled={data.page >= pageCount} onClick={() => load(data.page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {selected && (
        <section className="card mt-6 p-5">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary-600" />
            <h2 className="font-bold text-slate-900">Activity details</h2>
            <button className="ml-auto text-sm font-semibold text-primary-600" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-600">{selected.description || selected.action}</p>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Performed by</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">
                {actorName(selected)}
                {actorRole(selected) ? ` (${actorRole(selected)})` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Affected item</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{selected.subject?.label || "System record"}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">When</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDate(selected.timestamp)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Source</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{selected.ip_address || "System activity"}</dd>
            </div>
          </dl>
          {Object.keys(selected.details || {}).length > 0 && (
            <div className="mt-5 rounded-xl border border-slate-200">
              <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Additional context</p>
              <dl className="divide-y divide-slate-100">
                {Object.entries(selected.details || {}).map(([key, value]) => (
                  <div key={key} className="grid gap-2 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                    <dt className="text-sm font-medium text-slate-600">{labelize(key)}</dt>
                    <dd className="break-words text-sm text-slate-800">{formatValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>
      )}
    </>
  );
}

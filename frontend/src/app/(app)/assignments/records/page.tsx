"use client";

// Ported from frontend-legacy/src/pages/AssignmentRecords.jsx
import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarClock, Download, Eye, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getTeacherAssignmentRecords } from "@/features/assignments/api";
import { downloadAssignmentGradebook } from "@/features/grading/api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/datetime";
import { getCachedUser } from "@/lib/session";

interface AssignmentRecord {
  id: string;
  title: string;
  subject?: string;
  due_at?: string;
  total_marks?: number;
  workflow_status?: string;
  submission_count?: number;
  eligible_count?: number;
  published_grade_count?: number;
}

export default function AssignmentRecordsPage() {
  const user = useMemo(() => getCachedUser(), []);
  const [records, setRecords] = useState<AssignmentRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    getTeacherAssignmentRecords()
      .then((data) => setRecords(data.assignments || []))
      .catch((error) => {
        const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast.error(message || "Failed to load assignment history");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = records.filter((item) =>
    [item.title, item.subject].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Assignments" title="Assignment history" description="Completed assignments remain available for review, result exports, and repository evidence." />
      <div className="ui-toolbar mb-5 flex items-center gap-3">
        <Search className="h-4 w-4 text-slate-400" />
        <input className="input-field" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search completed assignments..." />
        <span className="shrink-0 text-sm text-slate-500">{filtered.length} assignments</span>
      </div>
      {loading ? (
        <div className="card p-10 text-center text-slate-500">Loading assignment history…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Archive className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 font-bold">No completed assignments</h2>
          <p className="mt-1 text-sm text-slate-500">Assignments appear here after every eligible result is published.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <article key={item.id} className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold">{item.title}</h2>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold capitalize text-emerald-700">{item.workflow_status}</span>
                </div>
                <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                  <CalendarClock className="h-4 w-4" />
                  Due {formatDateTime(item.due_at)} · {item.subject || "Course"} · {item.total_marks} marks
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.submission_count}/{item.eligible_count} submitted · {item.published_grade_count} results published
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-outline" onClick={() => downloadAssignmentGradebook(item.id, `${item.title}-gradebook.csv`)}>
                  <Download className="h-4 w-4" />
                  Gradebook
                </button>
                <button className="btn btn-primary" onClick={() => router.push(`/assignments/${item.id}/review`)}>
                  <Eye className="h-4 w-4" />
                  Review
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

// Session rollover: promotes every student to the next academic session
// (semester/year change), creates the new intake's batches on Odd terms,
// and graduates final-year students.
// See the original academic-sessions plan Part 4.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, History, RotateCcw, Undo2 } from "lucide-react";
import { PageHeader, useConfirm } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { executeSessionRollover, getSessionRolloverHistory, previewSessionRollover, undoSessionRollover } from "@/features/academics/api";
import { getCachedUser } from "@/lib/session";

interface SessionRef {
  id: string | null;
  label: string;
  term: string;
  start_date?: string;
  end_date?: string;
}

interface PreviewData {
  from_session: SessionRef | null;
  to_session: SessionRef;
  to_session_exists: boolean;
  promote_count: number;
  graduate_count: number;
  new_batches: { course_name: string; start_year: number; end_year: number }[];
  new_sections_count: number;
  teacher_allocation_count: number;
  warnings: string[];
}

interface RolloverRun {
  id: string;
  from_session: string | null;
  to_session: string | null;
  executed_at: string | null;
  counts: Record<string, unknown>;
  undone_at: string | null;
}

const errorMessage = (error: unknown, fallback: string): string => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

const termLabel = (term: string) => (term === "odd" ? "Odd" : "Even");

export default function AdminSessionRolloverPage() {
  const user = useMemo(() => getCachedUser(), []);
  const toast = useToast();
  const confirm = useConfirm();

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<RolloverRun[]>([]);

  const loadPreview = async () => {
    try {
      setLoading(true);
      const result = await previewSessionRollover();
      setPreview(result);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to load rollover preview"));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const result = await getSessionRolloverHistory();
      setHistory(result.runs || []);
    } catch {
      // History is a convenience panel — a failed load shouldn't block the page.
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreview();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExecute = async () => {
    if (!preview) return;
    const confirmed = await confirm({
      title: "Roll over to the next session?",
      description: `This promotes ${preview.promote_count} student${preview.promote_count === 1 ? "" : "s"} to ${preview.to_session.label} (${termLabel(preview.to_session.term)}) and makes it the current session. This can only be undone before any activity happens in the new session.`,
      details: preview.to_session.label,
      confirmLabel: "Roll over now",
      tone: "danger",
    });
    if (!confirmed) return;
    setExecuting(true);
    try {
      const result = await executeSessionRollover();
      toast.success(`Rolled over to the new session — ${result.promoted} promoted, ${result.graduated} graduated`);
      await loadPreview();
      await loadHistory();
    } catch (err) {
      toast.error(errorMessage(err, "Rollover failed"));
    } finally {
      setExecuting(false);
    }
  };

  const handleUndo = async (run: RolloverRun) => {
    const confirmed = await confirm({
      title: "Undo this rollover?",
      description: "Only possible if nothing has happened in the session it created yet.",
      details: `${run.from_session || "—"} -> ${run.to_session || "—"}`,
      confirmLabel: "Undo rollover",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await undoSessionRollover(run.id);
      toast.success("Rollover undone");
      await loadPreview();
      await loadHistory();
    } catch (err) {
      toast.error(errorMessage(err, "Could not undo — the new session already has activity"));
    }
  };

  if (!user) return null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Session rollover"
        description="Promote every student to the next academic session — semester and year change together, automatically."
      />

      {loading ? (
        <div className="card p-8 text-center text-sm text-gray-500">Loading...</div>
      ) : !preview ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No current academic session is set. Mark one as current on the Academic sessions page first.
        </div>
      ) : (
        <>
          <section className="card p-5">
            <div className="flex flex-wrap items-center gap-3 text-lg font-bold text-gray-900">
              <span>{preview.from_session ? `${preview.from_session.label} (${termLabel(preview.from_session.term)})` : "—"}</span>
              <ArrowRight className="h-5 w-5 text-gray-400" />
              <span>
                {preview.to_session.label} ({termLabel(preview.to_session.term)})
              </span>
              {!preview.to_session_exists && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">Will be created</span>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="text-2xl font-bold text-gray-900">{preview.promote_count}</div>
                <div className="text-xs font-medium text-gray-500">Students to promote</div>
              </div>
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="text-2xl font-bold text-gray-900">{preview.graduate_count}</div>
                <div className="text-xs font-medium text-gray-500">Students graduating</div>
              </div>
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="text-2xl font-bold text-gray-900">{preview.new_batches.length}</div>
                <div className="text-xs font-medium text-gray-500">New batches to create</div>
              </div>
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="text-2xl font-bold text-gray-900">{preview.teacher_allocation_count}</div>
                <div className="text-xs font-medium text-gray-500">Teacher allocations to carry</div>
              </div>
            </div>

            {preview.new_batches.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-sm font-bold text-gray-700">New batches</div>
                <ul className="space-y-1 text-sm text-gray-600">
                  {preview.new_batches.map((batch) => (
                    <li key={`${batch.course_name}-${batch.start_year}`}>
                      {batch.course_name}: {batch.start_year}–{batch.end_year}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="mt-5 rounded-xl bg-amber-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                  Warnings
                </div>
                <ul className="space-y-1 text-sm text-amber-700">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button onClick={loadPreview} className="btn btn-outline">
                <RotateCcw className="h-4 w-4" />
                Refresh preview
              </button>
              <button onClick={handleExecute} disabled={executing || preview.promote_count === 0} className="btn btn-primary">
                {executing ? "Rolling over..." : "Roll over now"}
              </button>
            </div>
          </section>

          <section className="card mt-6 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-700">
              <History className="h-4 w-4" />
              Rollover history
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">No rollovers have been run yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((run) => (
                  <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 p-3 text-sm">
                    <div>
                      <span className="font-semibold text-gray-900">
                        {run.from_session || "—"} <ArrowRight className="inline h-3.5 w-3.5" /> {run.to_session || "—"}
                      </span>
                      <span className="ml-2 text-gray-500">{run.executed_at ? new Date(run.executed_at).toLocaleString() : ""}</span>
                      {run.undone_at && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">Undone</span>}
                    </div>
                    {!run.undone_at && (
                      <button onClick={() => handleUndo(run)} className="rounded-lg p-2 text-red-600 transition-colors hover:text-red-800" title="Undo this rollover">
                        <Undo2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

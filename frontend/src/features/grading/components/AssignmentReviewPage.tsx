"use client";

// Ported from frontend-legacy/src/pages/AssignmentReview.jsx
import { ArrowLeft, Download, Send as Publish, Users } from "lucide-react";
import BulkExternalEvaluationDialog from "@/components/BulkExternalEvaluationDialog";
import { downloadAssignmentGradebook, publishAllAssignmentGrades } from "@/features/grading/api";
import { formatDateTime } from "@/lib/datetime";
import { statusTone, type AnyRecord } from "./review/shared";
import { useAssignmentReview } from "./review/useAssignmentReview";
import { ReviewWorkspace } from "./review/ReviewWorkspace";
export default function AssignmentReviewPage() {
  const model = useAssignmentReview();
  if (!model) return null;
  const {
    id,
    router,
    toast,
    queryClient,
    data,
    selectedId,
    setSelectedId,
    setTab,
    rosterQuery,
    setRosterQuery,
    rosterFilter,
    setRosterFilter,
    load,
    assignment,
    evaluation,
    canEvaluate,
    rosterStatus,
    rosterStats,
    visibleRoster
  } = model;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => router.push("/assignments")} className="btn btn-ghost mb-2">
            <ArrowLeft className="h-4 w-4" />
            Assignments
          </button>
          <h1 className="text-2xl font-bold">{assignment.title}</h1>
          <p className="mt-1 text-sm text-slate-500">Repository review and rubric grading · closes {formatDateTime(assignment.allow_late ? assignment.late_until : assignment.due_at)}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">{rosterStats.assigned} assigned</span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{rosterStats.submitted} submitted</span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{rosterStats.pending} pending</span>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">{rosterStats.awaitingGrading} awaiting grading</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">Student-managed repository updates</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Start evaluation per student to pin their latest synchronized commit. Other students remain live until evaluated or the deadline.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {evaluation.can_evaluate && <BulkExternalEvaluationDialog assignmentId={id} assignment={assignment} onSaved={async () => {
            // Invalidate the TanStack Query roster key so any useQuery("assignment-roster", id)
            // hooks (present or future) also refresh, then fall back to the ad-hoc load().
            await queryClient.invalidateQueries({ queryKey: ["assignment-roster", id] });
            load(selectedId);
          }} />}
          <button
            type="button"
            onClick={() => downloadAssignmentGradebook(id, `${assignment.title}-gradebook.csv`).catch(() => toast.error("Gradebook download failed"))}
            className="btn btn-outline"
          >
            <Download className="h-4 w-4" />
            Gradebook CSV
          </button>
          <button
            onClick={async () => {
              try {
                const result = await publishAllAssignmentGrades(id);
                toast.success(result.message);
                load(selectedId);
              } catch (error) {
                const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
                toast.error(message || "Bulk publication failed");
              }
            }}
            disabled={!canEvaluate}
            className="btn btn-primary"
          >
            <Publish className="h-4 w-4" />
            Publish all evaluations
          </button>
        </div>
      </div>
      {(data.similarity_flags || []).length > 0 && (
        <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Code similarity report</h2>
              <p className="mt-1 text-sm text-slate-600">CampusGrade automatically limits both students to 50% of the assignment marks when code similarity is above 70%.</p>
            </div>
            <span className="text-sm font-semibold text-amber-800">
              {data.similarity_flags.length} pair{data.similarity_flags.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {data.similarity_flags.map((flag: AnyRecord) => (
              <article key={flag.id} className="rounded-xl border border-amber-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {flag.left_student?.name || "Student"} ↔ {flag.right_student?.name || "Student"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {flag.left_student?.roll_no || flag.left_student?.email || "—"} · {flag.right_student?.roll_no || flag.right_student?.email || "—"}
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">{Math.round(flag.similarity * 100)}%</span>
                </div>
                <p className="mt-3 text-xs text-slate-600">
                  {flag.matched_file_count} exactly matched text file{flag.matched_file_count === 1 ? "" : "s"} · System limit: <span className="font-semibold">maximum {Number(assignment.total_marks) / 2}/{assignment.total_marks}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary text-sm"
                    onClick={() => {
                      setSelectedId(flag.left_student?.id || selectedId);
                      setTab("grading");
                    }}
                  >
                    Review marks
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid min-h-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-100 p-4">
            <div className="flex items-center gap-2 font-bold">
              <Users className="h-4 w-4" />
              {visibleRoster.length}/{data.roster.length} students
            </div>
            <input value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} className="input-field mt-3 text-sm" placeholder="Search student" />
            <div className="mt-3 flex flex-wrap gap-1">
              {(
                [
                  ["all", "All"],
                  ["submitted", "Submitted"],
                  ["pending", "Pending"],
                  ["awaiting", "Awaiting"],
                  ["graded", "Graded"],
                ] as [string, string][]
              ).map(([value, label]) => (
                <button key={value} onClick={() => setRosterFilter(value)} className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${rosterFilter === value ? "bg-primary-100 text-primary-800" : "bg-slate-100 text-slate-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[620px] overflow-y-auto p-2">
            {visibleRoster.map((row: AnyRecord) => {
              const status = rosterStatus(row);
              return (
                <button
                  key={row.student.id}
                  onClick={() => {
                    setSelectedId(row.student.id);
                    setTab(row.version || !canEvaluate ? "overview" : "grading");
                  }}
                  className={`mb-1 w-full rounded-xl p-3 text-left ${row.is_low_score ? "bg-red-50 ring-1 ring-red-200" : selectedId === row.student.id ? "bg-primary-50 ring-1 ring-primary-200" : "hover:bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="[overflow-wrap:anywhere] text-sm font-semibold">{row.student.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${statusTone[status] || statusTone.missing}`}>
                      {status === "pending_teacher" ? "awaiting analysis" : status === "draft" ? "evaluation saved" : status}
                    </span>
                  </div>
                  <p className="mt-1 [overflow-wrap:anywhere] text-xs text-slate-600">{row.student.roll_no || row.student.email}</p>
                  {row.is_low_score && (
                    <p className="mt-1 text-xs font-bold text-red-700">
                      Below 50% · {row.score_percentage}%
                    </p>
                  )}
                  {row.version?.is_late && <p className="mt-1 text-xs font-semibold text-amber-700">Late submission</p>}
                </button>
              );
            })}
          </div>
        </aside>
        <main className="min-w-0">
          <ReviewWorkspace model={model} />
        </main>
      </div>
    </>
  );
}

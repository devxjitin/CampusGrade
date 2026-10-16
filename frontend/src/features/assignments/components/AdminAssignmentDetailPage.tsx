"use client";

// Ported from frontend-legacy/src/pages/AdminAssignmentDetail.jsx (route: /assignments/admin/:id)
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, ExternalLink, GitCommit, Trash2, LockKeyhole, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader, useConfirm } from "@/components/ui";
import { deleteAdminAssignment, getAdminAssignmentDetail, performAdminAssignmentAction } from "@/features/assignments/api";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/datetime";
import { getCachedUser } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export default function AdminAssignmentDetailPage() {
  const user = useMemo(() => getCachedUser(), []);
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<AnyRecord | null>(null);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    getAdminAssignmentDetail(id)
      .then(setData)
      .catch((error) => {
        const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast.error(message || "Failed to load assignment details");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data) {
    return (
    <>
        <div className="card p-10 text-center text-slate-500">Loading assignment…</div>
    </>
    );
  }

  const { assignment, roster } = data;

  const handleDelete = async () => {
    const approved = await confirm({
      title: "Permanently delete assignment?",
      description: `"${assignment.title}" and all related submissions will be permanently deleted. This action cannot be undone.`,
      details: "This removes assignment resources, repository snapshots, grades, and submission records.",
      confirmLabel: "Delete permanently",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!approved) return;

    try {
      await deleteAdminAssignment(id);
      toast.success("Assignment permanently deleted");
      router.replace("/assignments");
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Deletion failed");
    }
  };

  const govern = async (action: "remind" | "reassign" | "lock" | "unlock" | "archive") => {
    const reason = action === "remind" ? "Administrative evaluation reminder" : window.prompt(`Reason for ${action}?`);
    if (!reason) return;
    try {
      const result = await performAdminAssignmentAction(id, { action, reason });
      setData((current) => ({ ...current, assignment: result.assignment }));
      toast.success(action === "remind" ? "Teacher reminded" : `Assignment ${action} action completed`);
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string; message?: string } } };
      toast.error(err.response?.data?.detail || err.response?.data?.message || "Governance action failed");
    }
  };

  if (!user) return null;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title={assignment.title}
        description={`${assignment.teacher_name} · ${assignment.subject || "Course"} · due ${formatDateTime(assignment.due_at)}`}
        actions={
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={() => router.push("/assignments")}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <button className="btn btn-outline text-rose-600" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" />
              Delete permanently
            </button>
          </div>
        }
      />
      <section className="card mb-6 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary-600">Governance controls</p>
          <h2 className="mt-1 font-bold">Administrative intervention</h2>
          <p className="mt-1 text-sm text-slate-500">Actions are audited. Student marks remain teacher-controlled.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-outline" onClick={() => govern("remind")}>
            <Bell className="h-4 w-4" />
            Remind teacher
          </button>
          <button className="btn btn-outline" onClick={() => govern(assignment.submission_locked_at ? "unlock" : "lock")}>
            <LockKeyhole className="h-4 w-4" />
            {assignment.submission_locked_at ? "Unlock submissions" : "Lock submissions"}
          </button>
          <button className="btn btn-outline" onClick={() => govern("archive")}>
            Archive
          </button>
        </div>
      </section>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(
          [
            ["Total Students", assignment.total_students, Users],
            ["Submitted", assignment.submission_count, GitCommit],
            ["Missed", assignment.missed_count, Users],
            [assignment.average_score_provisional ? "Average score (provisional)" : "Average score", assignment.average_score == null ? "—" : `${assignment.average_score}/${assignment.total_marks}`, GitCommit],
            ["Highest marks", assignment.highest_marks == null ? "—" : `${assignment.highest_marks}/${assignment.total_marks}`, GitCommit],
          ] as [string, string | number, typeof Users][]
        ).map(([label, value, Icon]) => (
          <div key={label} className="card p-5">
            <Icon className="h-5 w-5 text-primary-600" />
            <p className="mt-3 text-xs font-bold uppercase text-slate-500">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>
      {assignment.top_scorers?.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="font-bold text-slate-900">Top-scoring students</h2>
          <p className="mt-1 text-xs text-slate-500">Top three score positions, including ties. Draft evaluations are labelled.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assignment.top_scorers.map((item: AnyRecord) => (
              <div key={`${item.rank}-${item.student.id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-primary-700">Rank {item.rank}</p>
                <p className="mt-1 font-bold">{item.student.name}</p>
                <p className="text-sm text-slate-600">
                  {item.marks}/{assignment.total_marks} · {item.percentage}% <span className="capitalize">({item.status})</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="ui-data-card overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead>
            <tr>
              {["Student", "Submission", "Grade", "Result"].map((label) => (
                <th key={label} className="px-4 py-3 text-left text-xs uppercase text-slate-500">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roster.map((row: AnyRecord) => (
              <tr key={row.student.id} className={row.is_low_score ? "bg-red-50" : ""}>
                <td className="px-4 py-3 text-sm">
                  <strong>{row.student.name}</strong>
                  <p className="text-xs text-slate-500">{row.student.roll_no || row.student.email}</p>
                </td>
                <td className="px-4 py-3 text-sm capitalize">
                  {row.submission?.status || "Missing"}
                  <p className="text-xs text-slate-500">{row.submission?.last_submitted_at ? formatDateTime(row.submission.last_submitted_at) : "—"}</p>
                </td>
                <td className="px-4 py-3 text-sm">
                  {row.grade ? (
                    <span>
                      {row.grade.total_awarded}/{assignment.total_marks}
                      {row.score_percentage != null ? ` · ${row.score_percentage}%` : ""}
                      {row.is_low_score ? <span className="ml-2 font-bold text-red-700">Below 50%</span> : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-sm capitalize">
                  {row.grade?.status || "Pending"}
                  {row.version?.repository_url && (
                    <a className="ml-2 inline-flex text-primary-600" href={row.version.repository_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

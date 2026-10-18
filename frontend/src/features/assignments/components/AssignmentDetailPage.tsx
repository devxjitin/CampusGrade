"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, ExternalLink } from "lucide-react";
import MarkdownPreview from "@/components/MarkdownPreview";
import { EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { downloadAssignmentResource, getStudentAssignment, getStudentRepository, previewAssignmentRepository, submitAssignmentRepository, syncAssignmentRepository } from "@/features/assignments/api";
import { formatDateTime } from "@/lib/datetime";
import { useToast } from "@/components/Toast";
import { getCachedUser } from "@/lib/session";
import { StudentSubmissionPanel } from "./detail/StudentSubmissionPanel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export default function StudentAssignmentDetailPage() {
  const user = useMemo(() => getCachedUser(), []);
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();
  const [assignment, setAssignment] = useState<AnyRecord | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [preview, setPreview] = useState<AnyRecord | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [snapshot, setSnapshot] = useState<AnyRecord | null>(null);
  const [snapshotPath, setSnapshotPath] = useState("");
  const [snapshotContent, setSnapshotContent] = useState("");

  const load = async () => {
    try {
      const result = await getStudentAssignment(id);
      setAssignment(result.assignment);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to load assignment");
      router.push("/assignments");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!assignment?.version?.id) return;
    getStudentRepository(id)
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, [id, assignment?.version?.id]);

  // Poll quickly while a sync or analysis is in flight, and slowly otherwise so commits the worker
  // picks up automatically (and the "last synced" time) appear without a manual refresh.
  const inFlight =
    ["checking", "syncing", "freeze_pending"].includes(assignment?.sync_state?.status) || ["queued", "processing"].includes(assignment?.analysis?.status);
  const watching = Boolean(assignment?.sync_state) && assignment?.freeze_state?.status !== "frozen";
  useEffect(() => {
    if (!inFlight && !watching) return undefined;
    const timer = window.setInterval(load, inFlight ? 2500 : 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight, watching]);

  if (!assignment || !user) return null;

  const canSubmit = assignment.can_submit;

  const validate = async () => {
    setBusy(true);
    try {
      const result = await previewAssignmentRepository(id, repositoryUrl);
      setPreview(result.preview);
      setToken(result.preview_token);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Repository validation failed");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await submitAssignmentRepository(id, token);
      toast.success("Repository commit submitted");
      setPreview(null);
      setToken("");
      await load();
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  const version = assignment.version;

  const syncRepository = async () => {
    setBusy(true);
    try {
      await syncAssignmentRepository(id);
      toast.success("Repository update started");
      await load();
    } catch (error) {
      const message = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(message || "Repository sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => router.push("/assignments")} className="btn btn-ghost mb-4">
        <ArrowLeft className="h-4 w-4" />
        Back to assignments
      </button>
      <PageHeader eyebrow={assignment.subject || "Assignment"} title={assignment.title} description={assignment.short_description} actions={<StatusBadge status={assignment.workflow_status || assignment.phase} />} />
      <div className="mb-6">
        <Tabs
          label="Assignment sections"
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "submission", label: "Submission" },
            { value: "feedback", label: "Feedback" },
          ]}
        />
      </div>
      <div className="grid gap-6">
        {activeTab === "overview" && (
          <main className="space-y-5">
            <section className="card p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold capitalize text-primary-700">{(assignment.workflow_status || assignment.phase).replaceAll("_", " ")}</span>
                {assignment.subject && <span className="badge bg-slate-100 text-slate-700">{assignment.subject}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4" />
                  Due {formatDateTime(assignment.due_at)}
                </span>
                <span>{assignment.total_marks} marks</span>
                <span className="capitalize">
                  {assignment.difficulty} · about {assignment.estimated_minutes || "—"} minutes
                </span>
                <span className="capitalize">Results: {assignment.result_release_mode === "scheduled" ? `scheduled ${formatDateTime(assignment.result_release_at)}` : "published manually by teacher"}</span>
              </div>
              {(assignment.tags || []).length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {assignment.tags.map((tag: string) => (
                    <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-6 border-t border-slate-100 pt-5">
                <MarkdownPreview source={assignment.instructions} />
              </div>
            </section>
            {(assignment.announcements || []).length > 0 && (
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 p-5">
                  <h2 className="font-bold">Teacher announcements</h2>
                </div>
                {assignment.announcements.map((item: AnyRecord) => (
                  <div key={item.id} className="border-b border-slate-100 p-5 last:border-0">
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">{item.body}</p>
                  </div>
                ))}
              </section>
            )}
            <section className="card p-6">
              <h2 className="font-bold">Grading rubric</h2>
              <div className="mt-4 space-y-2">
                {assignment.rubric.map((item: AnyRecord) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3">
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                    </div>
                    <span className="font-bold">{item.max_marks}</span>
                  </div>
                ))}
              </div>
            </section>
            {assignment.resources?.length > 0 && (
              <section className="card p-6">
                <h2 className="font-bold">Resources</h2>
                <div className="mt-3 space-y-2">
                  {assignment.resources.map((item: AnyRecord) =>
                    item.url ? (
                      <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm font-semibold text-primary-700">
                        {item.label}
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : (
                      <button key={item.id} type="button" onClick={() => downloadAssignmentResource(id, item.id, item.filename)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left text-sm font-semibold">
                        {item.filename}
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    ),
                  )}
                </div>
              </section>
            )}
          </main>
        )}
        <aside className="space-y-5">
          <StudentSubmissionPanel
            activeTab={activeTab} assignment={assignment}
            version={version} canSubmit={canSubmit}
            repositoryUrl={repositoryUrl}
            setRepositoryUrl={setRepositoryUrl}
            busy={busy} validate={validate}
            preview={preview} setPreview={setPreview}
            submit={submit}
            syncRepository={syncRepository}
            snapshot={snapshot} snapshotPath={snapshotPath}
            setSnapshotPath={setSnapshotPath}
            snapshotContent={snapshotContent} setSnapshotContent={setSnapshotContent}
            assignmentId={id}
          />
          {activeTab === "feedback" && assignment.grade && (
            <section className="card p-5">
              <h2 className="font-bold text-emerald-700">Published result</h2>
              <p className="mt-3 text-3xl font-bold">
                {assignment.grade.total_awarded}/{assignment.total_marks}
              </p>
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                {assignment.rubric.map((item: AnyRecord) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                      </div>
                      <strong className="whitespace-nowrap">
                        {assignment.grade.rubric_scores?.[item.id] ?? 0}/{item.max_marks}
                      </strong>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg bg-emerald-50 p-3">
                        <p className="font-semibold text-emerald-800">What was done well</p>
                        <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-700">{assignment.grade.rubric_feedback?.[item.id]?.what_was_done_well || "No criterion feedback was recorded."}</p>
                      </div>
                      <div className="rounded-lg bg-amber-50 p-3">
                        <p className="font-semibold text-amber-800">What is missing</p>
                        <p className="mt-1 whitespace-pre-wrap leading-5 text-slate-700">{assignment.grade.rubric_feedback?.[item.id]?.what_is_missing || "No criterion feedback was recorded."}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">Published {formatDateTime(assignment.grade.published_at)}</p>
            </section>
          )}
          {activeTab === "feedback" && !assignment.grade && <EmptyState title="Feedback is not available yet" description="Your teacher's grade and feedback will appear here after results are published." />}
        </aside>
      </div>
    </>
  );
}

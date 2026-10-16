"use client";

// Ported from frontend-legacy/src/pages/AssignmentWorkspace.jsx.
//
// Note: this component derives its "mode" from the last path segment, and
// only has special handling for "subjects" and "discussions" — anything else
// (including "workspace", which is what this route actually mounts on:
// /assignments/:id/workspace) falls through to the Analytics branch, which
// calls the teacher-only getTeacherAssignmentAnalytics() endpoint even though
// this route is student-only. This looks like dead/vestigial code from a
// refactor rather than intentional behavior — flagged for the user, but
// preserved as-is here for exact parity with frontend-legacy.
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { formatDateTime } from "@/lib/datetime";
import { getStudentAssignmentSubjects, getStudentAssignmentThreads, getTeacherAssignmentThreads, replyAssignmentThread, updateAssignmentThreadStatus } from "@/features/assignments/api";
import { getTeacherAssignmentAnalytics } from "@/features/grading/api";
import { getCachedUser, isAdminRole } from "@/lib/session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const card = "rounded-2xl border border-slate-200 bg-white shadow-sm";

const Empty = ({ icon: Icon, title, text }: { icon: typeof MessageSquare; title: string; text: string }) => (
  <div className={`${card} p-12 text-center`}>
    <Icon className="mx-auto h-10 w-10 text-slate-300" />
    <h2 className="mt-3 font-bold">{title}</h2>
    <p className="mt-1 text-sm text-slate-500">{text}</p>
  </div>
);

const Analytics = ({ data, admin }: { data: AnyRecord | null; admin: boolean }) => {
  const summary = data?.summary;
  const rows = admin ? data?.teachers || [] : data?.subjects || [];
  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(summary).map(([key, value]) => (
            <div key={key} className={`${card} p-5`}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{key.replaceAll("_", " ")}</p>
              <p className="mt-2 text-3xl font-bold">{value as React.ReactNode}</p>
            </div>
          ))}
        </div>
      )}
      <section className={`${card} overflow-hidden`}>
        <div className="border-b border-slate-100 p-5">
          <h2 className="font-bold">{admin ? "Teacher workload & follow-up" : "Subject performance"}</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map((row: AnyRecord, index: number) => (
            <div key={row.teacher_id || row.subject || index} className="grid gap-3 p-5 sm:grid-cols-5">
              <strong className="sm:col-span-2">{row.teacher_name || row.subject}</strong>
              <span className="text-sm text-slate-500">{row.assignments} assignments</span>
              <span className="text-sm text-slate-500">{row.submissions ?? row.submitted} submitted</span>
              <span className={`text-sm font-semibold ${row.overdue || row.pending_grades ? "text-amber-600" : "text-emerald-600"}`}>
                {row.overdue ?? row.published ?? 0} {admin ? "overdue" : "results"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default function AssignmentWorkspacePage() {
  const user = useMemo(() => getCachedUser(), []);
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const mode = pathname?.split("/").filter(Boolean).pop();
  const [data, setData] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      if (mode === "subjects") setData(await getStudentAssignmentSubjects());
      else if (mode === "discussions") setData(user?.role === "teacher" ? await getTeacherAssignmentThreads() : await getStudentAssignmentThreads());
      else setData(await getTeacherAssignmentAnalytics());
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string; message?: string } } };
      toast.error(err.response?.data?.detail || err.response?.data?.message || "Unable to load this workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!user) return null;

  const title = mode === "subjects" ? "Subject hubs" : mode === "discussions" ? "Questions & discussions" : "Assignment analytics";
  const description =
    mode === "subjects"
      ? "Every assignment organised by its official course, with progress visible at a glance."
      : mode === "discussions"
        ? "Private, assignment-specific conversations between students and teachers."
        : "Operational insights for follow-up and workload planning.";

  const postReply = async (threadId: string) => {
    if (!reply[threadId]?.trim()) return;
    try {
      await replyAssignmentThread(threadId, reply[threadId]);
      setReply((old) => ({ ...old, [threadId]: "" }));
      await load();
      toast.success("Reply sent");
    } catch (error) {
      const message = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(message || "Reply failed");
    }
  };

  return (
    <>
      <PageHeader eyebrow={`${user.role} workspace`} title={title} description={description} />
      {loading ? (
        <div className={`${card} p-12 text-center text-slate-500`}>Loading workspace…</div>
      ) : mode === "subjects" ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {(data?.subjects || []).map((group: AnyRecord) => (
            <section key={group.subject.id} className={`${card} overflow-hidden`}>
              <div className="flex items-start justify-between border-b border-slate-100 p-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-primary-600">{group.subject.code || "Course"}</p>
                  <h2 className="mt-1 text-xl font-bold">{group.subject.name}</h2>
                </div>
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-bold text-primary-700">
                  {group.summary.submitted}/{group.summary.total} submitted
                </span>
              </div>
              <div className="space-y-2 p-3">
                {group.assignments.map((item: AnyRecord) => (
                  <button key={item.id} onClick={() => router.push(`/assignments/${item.id}`)} className="flex w-full items-center justify-between rounded-xl p-3 text-left hover:bg-slate-50">
                    <div>
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">Due {formatDateTime(item.due_at)}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.grade ? "bg-emerald-100 text-emerald-700" : item.submission ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                      {item.grade ? "Result" : item.submission ? "Submitted" : item.phase}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : mode === "discussions" ? (
        <div className="space-y-4">
          {(data?.threads || []).length === 0 ? (
            <Empty icon={MessageSquare} title="No discussions yet" text="Assignment questions and teacher responses will appear here." />
          ) : (
            data?.threads.map((thread: AnyRecord) => (
              <section key={thread.id} className={`${card} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold">{thread.subject}</h2>
                    <p className="text-xs text-slate-500">
                      {thread.student?.name || "Student"} · {formatDateTime(thread.updated_at)}
                    </p>
                  </div>
                  {user.role === "teacher" ? (
                    <button
                      onClick={async () => {
                        await updateAssignmentThreadStatus(thread.id, thread.status === "resolved" ? "open" : "resolved");
                        load();
                      }}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold"
                    >
                      {thread.status}
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{thread.status}</span>
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  {thread.messages.map((message: AnyRecord) => (
                    <div key={message.id} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-bold text-primary-600">
                        {message.author.name} · {message.author.role}
                      </p>
                      <p className="mt-1 text-sm">{message.body}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <input className="input-field" value={reply[thread.id] || ""} onChange={(event) => setReply((old) => ({ ...old, [thread.id]: event.target.value }))} placeholder="Write a reply…" />
                  <button className="btn btn-primary" onClick={() => postReply(thread.id)}>
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </section>
            ))
          )}
        </div>
      ) : (
        <Analytics data={data} admin={isAdminRole(user.role)} />
      )}
    </>
  );
}

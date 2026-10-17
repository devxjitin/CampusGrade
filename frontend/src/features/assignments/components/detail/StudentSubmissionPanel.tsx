"use client";

import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, CheckCircle2, FileCode2, GitCommit, Loader2, RefreshCw } from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import MarkdownPreview from "@/components/MarkdownPreview";
import { getStudentRepositoryFile } from "@/features/assignments/api";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/** Analysis progress of the newest commit, driven by the worker job rather than a spinner. */
const AnalysisStatus = ({ analysis }: { analysis?: AnyRecord | null }) => {
  if (!analysis) return null;
  const commit = analysis.commit_sha ? ` for commit ${String(analysis.commit_sha).slice(0, 7)}` : "";
  const attempt = analysis.attempt && analysis.max_attempts ? `attempt ${analysis.attempt} of ${analysis.max_attempts}` : null;
  let tone = "text-slate-500";
  let text: string;
  if (analysis.status === "ready") {
    tone = "text-emerald-700";
    text = `Analysis ready${commit}`;
  } else if (analysis.job_status === "dead") {
    tone = "font-semibold text-rose-600";
    text = `Analysis failed${commit}${attempt ? ` after ${analysis.attempt} attempts` : ""}. An administrator has been notified.`;
  } else if (analysis.job_status === "failed" || analysis.status === "failed") {
    tone = "text-amber-700";
    text = `Analysis hit a problem${commit}; retrying${attempt ? ` (${attempt})` : ""}${analysis.retry_at ? ` at ${formatDateTime(analysis.retry_at, { hour: "2-digit", minute: "2-digit" })}` : ""}.`;
  } else if (analysis.status === "processing" || analysis.job_status === "running") {
    tone = "text-primary-700";
    text = `Analyzing your repository${commit}…`;
  } else {
    text = `Waiting for analysis${commit}`;
  }
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-xs ${tone}`} role="status">
      {analysis.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : analysis.job_status === "dead" ? <AlertCircle className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {text}
    </p>
  );
};

const lockMessages: Record<string, string> = {
  result_published: "Your result is published, so further updates are locked.",
  deadline_passed: "The submission deadline has passed. Late work is not accepted.",
  submission_window_closed: "This assignment is not currently accepting submissions.",
  version_limit_reached: "You have used the original submission and both allowed updates.",
  evaluation_started: "Your teacher has started class repository evaluation, so repository changes are closed.",
  repository_linked: "Your repository link is permanent. Use Update repository after pushing new commits.",
  administrator_lock: "Repository changes are temporarily locked by the administrator.",
};

export const StudentSubmissionPanel = ({
  activeTab,
  assignment,
  version,
  canSubmit,
  repositoryUrl,
  setRepositoryUrl,
  busy,
  validate,
  preview,
  setPreview,
  submit,
  syncRepository,
  snapshot,
  snapshotPath,
  setSnapshotPath,
  snapshotContent,
  setSnapshotContent,
  assignmentId,
}: {
  activeTab: string;
  assignment: AnyRecord;
  version: AnyRecord | null;
  canSubmit: boolean;
  repositoryUrl: string;
  setRepositoryUrl: Dispatch<SetStateAction<string>>;
  busy: boolean;
  validate: () => void;
  preview: AnyRecord | null;
  setPreview: Dispatch<SetStateAction<AnyRecord | null>>;
  submit: () => void;
  syncRepository: () => void;
  snapshot: AnyRecord | null;
  snapshotPath: string;
  setSnapshotPath: Dispatch<SetStateAction<string>>;
  snapshotContent: string;
  setSnapshotContent: Dispatch<SetStateAction<string>>;
  assignmentId: string;
}) => {
  const lastSyncedAt = assignment.sync_state?.last_updated_at || assignment.sync_state?.last_checked_at;
  return (
  <>
{activeTab === "submission" && (
            <section className="card p-5">
              <div className="flex items-center gap-3">
                <GithubIcon className="h-6 w-6" />
                <div>
                  <h2 className="font-bold">GitHub submission</h2>
                  <p className="text-xs text-slate-500">One permanent link · update after pushing commits</p>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Sync status</span>
                  <span className="capitalize">{assignment.freeze_state?.status || assignment.sync_state?.status || "unlinked"}</span>
                </div>
                {lastSyncedAt && (
                  <p className="mt-2 text-xs text-slate-500" title={formatDateTime(lastSyncedAt)}>
                    Last synced {formatRelativeTime(lastSyncedAt)}
                    {version?.commit_sha ? ` · commit ${version.commit_sha.slice(0, 7)}` : ""}
                  </p>
                )}
                <AnalysisStatus analysis={assignment.analysis} />
                {assignment.sync_state?.error && <p className="mt-2 text-xs font-semibold text-rose-600">{assignment.sync_state.error}</p>}
                <p className="mt-2 text-xs text-slate-500">New commits are picked up automatically a few minutes after you push. Select Update repository to check right now.</p>
              </div>
              {version ? (
                <div className="mt-5 space-y-3">
                  <a href={version.repository_url} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline">
                    {version.repository_owner}/{version.repository_name}
                  </a>
                  <div className="rounded-xl bg-slate-50 p-3 text-sm">
                    <p className="flex items-center gap-2 font-mono text-xs">
                      <GitCommit className="h-4 w-4" />
                      {version.commit_sha.slice(0, 12)}
                    </p>
                    <p className="mt-2 text-slate-500">{version.commit_message}</p>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-700">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      {assignment.freeze_state?.status === "frozen" ? "This commit is frozen for evaluation." : "Repository linked. New pushes are synchronized automatically."}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="mt-5 text-sm text-slate-500">No repository submitted yet.</p>
              )}
              {assignment.can_sync && (
                <button disabled={busy} onClick={syncRepository} className="btn btn-primary mt-4 w-full">
                  <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  Update repository
                </button>
              )}
              {canSubmit && (
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <label className="ui-field-label">Public repository URL</label>
                  <input
                    className="input-field mt-1.5"
                    value={repositoryUrl}
                    onChange={(e) => {
                      setRepositoryUrl(e.target.value);
                      setPreview(null);
                    }}
                    placeholder="https://github.com/username/repository"
                  />
                  <button disabled={busy || !repositoryUrl} onClick={validate} className="btn btn-outline mt-3 w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Validate repository
                  </button>
                </div>
              )}
              {!canSubmit && assignment.submission_lock_reason && (
                <div className="mt-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{lockMessages[assignment.submission_lock_reason] || "Submissions are locked."}</span>
                </div>
              )}
            </section>
          )}
          {activeTab === "submission" && snapshot && (
            <section className="card p-5">
              <div className="flex items-center gap-2">
                <FileCode2 className="h-5 w-5" />
                <div>
                  <h2 className="font-bold">Last synchronized files</h2>
                  <p className="text-xs text-slate-500">Commit {snapshot.version.commit_sha.slice(0, 12)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 p-2">
                  {snapshot.manifest.map((item: AnyRecord) => (
                    <button
                      key={item.path}
                      type="button"
                      disabled={!item.is_text || item.size > 1024 * 1024}
                      onClick={async () => {
                        setSnapshotPath(item.path);
                        setSnapshotContent("Loading…");
                        try {
                          setSnapshotContent(await getStudentRepositoryFile(assignmentId, item.path));
                        } catch {
                          setSnapshotContent("Unable to open this file.");
                        }
                      }}
                      className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${snapshotPath === item.path ? "bg-primary-50 font-semibold text-primary-700" : "hover:bg-slate-50 disabled:opacity-50"}`}
                    >
                      <span className="break-all">{item.path}</span>
                      <span className="ml-2 text-slate-400">{item.size} B</span>
                    </button>
                  ))}
                </div>
                <div className="min-h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100">
                  <div className="border-b border-slate-700 px-4 py-2 text-xs font-semibold">{snapshotPath || "Select a text file"}</div>
                  <pre className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-5">{snapshotContent || "Choose a file from the synchronized snapshot to view its contents."}</pre>
                </div>
              </div>
              {snapshot.readme_markdown && (
                <div className="mt-5 rounded-xl border border-slate-200 p-4">
                  <h3 className="mb-3 font-bold">README</h3>
                  <MarkdownPreview source={snapshot.readme_markdown} />
                </div>
              )}
            </section>
          )}
          {activeTab === "submission" && preview && (
            <section className="card border-primary-200 p-5">
              <h2 className="font-bold">Confirm commit</h2>
              <p className="mt-1 text-sm text-slate-500">This exact commit will be archived and graded.</p>
              {preview.verification_warning && (
                <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{preview.verification_warning}</span>
                </div>
              )}
              <dl className="mt-4 space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Repository</dt>
                  <dd className="font-semibold">
                    {preview.owner}/{preview.name}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Branch</dt>
                  <dd>{preview.default_branch}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Commit</dt>
                  <dd className="font-mono text-xs">{preview.commit_sha}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Message</dt>
                  <dd>{preview.commit_message || "Not available"}</dd>
                </div>
              </dl>
              <button disabled={busy} onClick={submit} className="btn btn-primary mt-5 w-full">
                <CheckCircle2 className="h-4 w-4" />
                Confirm submission
              </button>
            </section>
          )}
  </>
  );
};

"use client";

import { AlertTriangle, ExternalLink, File, FileCode2, GitBranch, GitCommit, Loader2, Search } from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import MarkdownPreview from "@/components/MarkdownPreview";
import { formatDateTime } from "@/lib/datetime";
import { TABS, type AnyRecord } from "./shared";
import { GradingPanel } from "./GradingPanel";
import { useAssignmentReview } from "./useAssignmentReview";

export const ReviewWorkspace = ({ model }: { model: NonNullable<ReturnType<typeof useAssignmentReview>> }) => {
  const {
    id, toast, tab, setTab, search, setSearch, selectedPath, fileContent, busy,
    scores, setScores, rubricFeedback, setRubricFeedback, load, selected, assignment, canEvaluate, version, grade,
    filteredFiles, visibleIntegrityFlags, hasSimilarityLimit, openFile, save, publishOne, startEvaluation,
    resetRepository, total, rubricFeedbackComplete,
  } = model;
  return (
    <>
{!selected ? (
            <div className="flex h-full items-center justify-center text-slate-500">Select a student</div>
          ) : (
            <>
              <header className="border-b border-slate-200 p-5">
                {selected.is_low_score && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">Saved score {selected.score_percentage}% is below 50%.</div>}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{selected.student.name}</h2>
                    <p className="text-sm text-slate-500">{selected.student.github_username ? `@${selected.student.github_username}` : "GitHub not linked"}</p>
                  </div>
                  {version && (
                    <a href={version.repository_url} target="_blank" rel="noreferrer" className="btn btn-outline">
                      <GithubIcon className="h-4 w-4" />
                      {version.repository_owner}/{version.repository_name}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <div className="flex gap-2">
                    {selected.repository && selected.freeze_state?.status === "live" && (
                      <button className="btn btn-primary" disabled={busy} onClick={startEvaluation}>
                        Start evaluation
                      </button>
                    )}
                    {selected.repository && selected.freeze_state?.status === "live" && assignment.phase === "open" && !selected.grade && (
                      <button className="btn btn-outline" disabled={busy} onClick={resetRepository}>
                        Reset link
                      </button>
                    )}
                  </div>
                </div>
                {version && (
                  <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3.5 w-3.5" />
                      {version.default_branch}
                    </span>
                    <span className="flex items-center gap-1 font-mono">
                      <GitCommit className="h-3.5 w-3.5" />
                      {version.commit_sha.slice(0, 12)}
                    </span>
                    <span>{formatDateTime(version.submitted_at)}</span>
                    <span className="capitalize">{selected.freeze_state?.status || selected.sync_state?.status || "live"}</span>
                  </div>
                )}
              </header>
              <div className="overflow-x-auto border-b border-slate-200 px-3">
                <div className="flex min-w-max">
                  {TABS.map((item) => (
                    <button
                      key={item}
                      disabled={(!version && item !== "grading") || (item === "grading" && !canEvaluate)}
                      onClick={() => setTab(item)}
                      className={`min-h-11 px-4 text-sm font-semibold capitalize ${tab === item ? "border-b-2 border-primary-600 text-primary-700" : "text-slate-500 disabled:opacity-40"}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                {!version && tab !== "grading" ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No repository submitted.</div>
                ) : version && version.analysis_status !== "ready" && tab !== "grading" ? (
                  <div className="rounded-xl border border-slate-200 p-8 text-center">
                    {version.analysis_status === "failed" ? (
                      <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
                    ) : version.analysis_status === "pending_teacher" ? (
                      <Search className="mx-auto h-10 w-10 text-amber-500" />
                    ) : (
                      <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary-600" />
                    )}
                    <h3 className="mt-3 font-bold">{`Analysis ${version.analysis_status}`}</h3>
                    <p className="mt-1 text-sm text-slate-500">{version.analysis_error || "CampusGrade is archiving and inspecting the latest synchronized commit."}</p>
                    {version.analysis_status === "failed" && <p className="mt-3 text-xs font-semibold text-rose-600">CampusGrade will retry this immutable snapshot automatically.</p>}
                  </div>
                ) : (
                  <>
                    {tab === "overview" && (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                          {(
                            [
                              ["Files", version.analysis_summary?.file_count || 0],
                              ["Folders", version.analysis_summary?.folder_count || 0],
                              ["Size", `${Math.ceil((version.analysis_summary?.size_bytes || 0) / 1024)} KB`],
                              ["Dependencies", version.analysis_summary?.dependency_files?.length || 0],
                            ] as [string, string | number][]
                          ).map(([label, value]) => (
                            <div key={label} className="rounded-xl bg-slate-50 p-4">
                              <p className="text-xs uppercase text-slate-500">{label}</p>
                              <p className="mt-1 text-xl font-bold">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="grid gap-5 lg:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Language distribution</h3>
                            <div className="mt-3 space-y-2">
                              {Object.entries(version.analysis_summary?.languages || {})
                                .slice(0, 8)
                                .map(([lang, bytes]) => (
                                  <div key={lang} className="flex justify-between text-sm">
                                    <span className="uppercase">{lang}</span>
                                    <span>{Math.ceil((bytes as number) / 1024)} KB</span>
                                  </div>
                                ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Integrity insights</h3>
                            {visibleIntegrityFlags.length ? (
                              <div className="mt-3 space-y-2">
                                {visibleIntegrityFlags.map((flag: AnyRecord) => (
                                  <div key={flag.id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                                    {flag.type.replaceAll("_", " ")} · {Math.round(flag.similarity * 100)}%
                                    similarity{flag.type === "code_similarity" ? " · automatic 50% mark limit" : " · automatic zero candidate"}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-3 text-sm text-emerald-600">No basic duplicate flags found.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {tab === "files" && (
                      <div className="grid min-h-[470px] gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
                        <div className="overflow-hidden rounded-xl border border-slate-200">
                          <div className="flex items-center gap-2 border-b border-slate-200 p-3">
                            <Search className="h-4 w-4 text-slate-400" />
                            <input value={search} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search files" />
                          </div>
                          <div className="max-h-[430px] overflow-y-auto p-2">
                            {filteredFiles.map((item: AnyRecord) => (
                              <button key={item.path} onClick={() => openFile(item)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs ${selectedPath === item.path ? "bg-primary-50 text-primary-700" : "hover:bg-slate-50"}`}>
                                <File className="h-3.5 w-3.5 flex-none" />
                                <span className="truncate">{item.path}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
                          <div className="border-b border-slate-200 px-4 py-3 text-xs font-semibold">{selectedPath || "Select a source file"}</div>
                          <pre className="max-h-[430px] overflow-auto p-4 text-xs leading-6">
                            <code>{fileContent}</code>
                          </pre>
                        </div>
                      </div>
                    )}
                    {tab === "readme" && (
                      <div className="rounded-xl border border-slate-200 p-5">
                        <MarkdownPreview source={version.readme_markdown} emptyText="No README was found in the submitted snapshot." />
                      </div>
                    )}
                    {tab === "activity" && (
                      <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Submitted commit</h3>
                            <p className="mt-3 break-all font-mono text-xs">{version.commit_sha}</p>
                            <p className="mt-3 text-sm">{version.commit_message}</p>
                            <p className="mt-2 text-xs text-slate-500">Committed {formatDateTime(version.commit_at)}</p>
                          </div>
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Submission record</h3>
                            <p className="mt-3 text-sm">Branch: {version.default_branch}</p>
                            <p className="mt-2 text-sm">Submitted: {formatDateTime(version.submitted_at)}</p>
                            <p className="mt-2 text-sm">Status: {version.is_late ? "Late" : "On time"}</p>
                          </div>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Recent commits</h3>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {(version.analysis_summary?.recent_commits || []).map((commit: AnyRecord) => (
                                <div key={commit.sha} className="rounded-lg bg-slate-50 p-3 text-sm">
                                  <p className="truncate font-semibold">{commit.message}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {commit.author || "Unknown"} · {String(commit.sha).slice(0, 8)} · {formatDateTime(commit.date)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-slate-200 p-4">
                            <h3 className="font-bold">Contributors & branches</h3>
                            <p className="mt-2 text-sm text-slate-500">
                              {version.analysis_summary?.contributors?.length || 0} contributors · {version.analysis_summary?.branches?.length || 0} branches
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(version.analysis_summary?.contributors || []).slice(0, 20).map((contributor: AnyRecord) => (
                                <span key={contributor.login} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">
                                  @{contributor.login} · {contributor.contributions}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {tab === "dependencies" && (
                      <div>
                        <h3 className="font-bold">Detected manifests</h3>
                        <div className="mt-3 space-y-2">
                          {(version.analysis_summary?.dependency_files || []).map((path: string) => (
                            <div key={path} className="rounded-xl border border-slate-200 p-3 text-sm">
                              <div className="flex items-center gap-2 font-semibold">
                                <FileCode2 className="h-4 w-4 text-primary-600" />
                                {path}
                              </div>
                              {(version.analysis_summary?.dependency_details?.[path] || []).length > 0 && <p className="mt-2 break-words text-xs leading-5 text-slate-500">{version.analysis_summary.dependency_details[path].join(" · ")}</p>}
                            </div>
                          ))}
                          {!version.analysis_summary?.dependency_files?.length && <p className="text-sm text-slate-500">No recognized dependency manifests found.</p>}
                        </div>
                      </div>
                    )}
                    <GradingPanel
                      tab={tab}
                      assignment={assignment}
                      selected={selected}
                      version={version}
                      grade={grade}
                      scores={scores}
                      setScores={setScores}
                      rubricFeedback={rubricFeedback}
                      setRubricFeedback={setRubricFeedback}
                      total={total}
                      hasSimilarityLimit={hasSimilarityLimit}
                      busy={busy}
                      canEvaluate={canEvaluate}
                      rubricFeedbackComplete={rubricFeedbackComplete}
                      save={save}
                      publishOne={publishOne}
                      assignmentId={id}
                      toast={toast}
                      load={load}
                    />
                  </>
                )}
              </div>
            </>
          )}
    </>
  );
};

"use client";

import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2, Save } from "lucide-react";
import { withdrawAssignmentGrade } from "@/features/grading/api";
import type { AnyRecord } from "./shared";

export const GradingPanel = ({
  tab, assignment, selected, version, grade, scores, setScores, rubricFeedback, setRubricFeedback, total,
  hasSimilarityLimit, busy, canEvaluate, rubricFeedbackComplete, save, publishOne, assignmentId, toast, load,
}: {
  tab: string; assignment: AnyRecord; selected: AnyRecord; version: AnyRecord | null; grade: AnyRecord | null;
  scores: Record<string, number>; setScores: Dispatch<SetStateAction<Record<string, number>>>;
  rubricFeedback: Record<string, AnyRecord>; setRubricFeedback: Dispatch<SetStateAction<Record<string, AnyRecord>>>;
  total: number; hasSimilarityLimit: boolean; busy: boolean; canEvaluate: boolean; rubricFeedbackComplete: boolean;
  save: (missing: boolean) => void; publishOne: () => void; assignmentId: string;
  toast: { success: (message: string) => void; error: (message: string) => void };
  load: (selection?: string) => void;
}) => (
<>
{tab === "grading" && (
                      <div className="mx-auto max-w-3xl">
                        <div className="mb-5 flex items-center justify-between">
                          <div>
                            <h3 className="text-lg font-bold">Rubric grading</h3>
                            <p className="text-sm text-slate-500">Saved evaluations remain private until publication.</p>
                          </div>
                          <p className="text-xl font-bold">
                            {total}/{hasSimilarityLimit ? Number(assignment.total_marks) / 2 : assignment.total_marks}
                          </p>
                        </div>
                        {hasSimilarityLimit && (
                          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
                            CampusGrade detected code similarity above 70%. This evaluation is automatically limited to {Number(assignment.total_marks) / 2} marks from the original {assignment.total_marks}.
                          </p>
                        )}
                        <div className="space-y-3">
                          {assignment.rubric.map((item: AnyRecord) => (
                            <div key={item.id} className="rounded-xl border border-slate-200 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold">{item.title}</p>
                                  <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                                </div>
                                <label className="w-36">
                                  <span className="text-xs text-slate-500">Marks / {item.max_marks}</span>
                                  <input type="number" min="0" max={item.max_marks} className="input-field mt-1" value={scores[item.id] ?? ""} onChange={(e) => setScores({ ...scores, [item.id]: Number(e.target.value) })} />
                                </label>
                              </div>
                              <div className="mt-4 grid gap-3 md:grid-cols-2">
                                <label>
                                  <span className="ui-field-label">What was done well</span>
                                  <textarea
                                    className="input-field mt-1.5 min-h-24"
                                    value={rubricFeedback[item.id]?.what_was_done_well || ""}
                                    onChange={(e) => setRubricFeedback({ ...rubricFeedback, [item.id]: { ...rubricFeedback[item.id], what_was_done_well: e.target.value } })}
                                    placeholder="Describe the evidence that earned marks for this criterion."
                                  />
                                </label>
                                <label>
                                  <span className="ui-field-label">What is missing</span>
                                  <textarea
                                    className="input-field mt-1.5 min-h-24"
                                    value={rubricFeedback[item.id]?.what_is_missing || ""}
                                    onChange={(e) => setRubricFeedback({ ...rubricFeedback, [item.id]: { ...rubricFeedback[item.id], what_is_missing: e.target.value } })}
                                    placeholder="Explain absent or incomplete rubric requirements. Use ‘No rubric requirements are missing’ when complete."
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                          {!version && (
                            <button disabled={busy || !canEvaluate} onClick={() => save(true)} className="btn btn-outline">
                              Record missing / zero
                            </button>
                          )}
                          <button disabled={busy || !canEvaluate || !rubricFeedbackComplete || grade?.status === "published" || (hasSimilarityLimit && total > Number(assignment.total_marks) / 2)} onClick={() => save(false)} className="btn btn-outline">
                            <Save className="h-4 w-4" />
                            Save evaluation
                          </button>
                          {grade?.status === "draft" && (
                            <button disabled={busy || !canEvaluate || !rubricFeedbackComplete || assignment.phase !== "closed" || (hasSimilarityLimit && total > Number(assignment.total_marks) / 2)} onClick={publishOne} className="btn btn-primary">
                              <CheckCircle2 className="h-4 w-4" />
                              Publish grade
                            </button>
                          )}
                          {grade?.status === "published" && (
                            <button
                              onClick={async () => {
                                const reason = window.prompt("Reason for withdrawing this grade?");
                                if (!reason) return;
                                try {
                                  await withdrawAssignmentGrade(assignmentId, selected.student.id, reason);
                                  toast.success("Grade withdrawn");
                                  load(selected.student.id);
                                } catch (error) {
                                  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
                                  toast.error(message || "Withdrawal failed");
                                }
                              }}
                              className="btn btn-outline text-rose-600"
                            >
                              Withdraw grade
                            </button>
                          )}
                        </div>
                      </div>
                    )}
</>
);

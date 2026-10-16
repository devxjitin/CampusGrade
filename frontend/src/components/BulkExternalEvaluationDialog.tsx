"use client";

// Ported from frontend-legacy/src/components/BulkExternalEvaluationDialog.jsx
import { AlertTriangle, CheckCircle2, Clipboard, Download, Loader2, Minus, Plus, Sparkles, X } from "lucide-react";
import { downloadText, type AnyRecord } from "./bulkExternalEvaluation/shared";
import { useBulkExternalEvaluation } from "./bulkExternalEvaluation/useBulkExternalEvaluation";

export default function BulkExternalEvaluationDialog({ assignmentId, assignment, onSaved }: { assignmentId: string; assignment: AnyRecord; onSaved?: () => void | Promise<void> }) {
  const {
    open,
    setOpen,
    busy,
    exportData,
    activeBatch,
    setActiveBatch,
    responses,
    setResponses,
    validated,
    setValidated,
    confirmations,
    setConfirmations,
    batch,
    reviewedStudents,
    allValidated,
    canSave,
    generate,
    copyPrompt,
    validate,
    updateRubricScore,
    updateRubricFeedback,
    saveAll
  } = useBulkExternalEvaluation({ assignmentId, assignment, onSaved });

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" />
        External AI evaluator
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <h2 className="text-xl font-bold">External AI batch evaluation</h2>
                <p className="mt-1 text-sm text-slate-500">{assignment.title} · imported marks remain private until publication</p>
              </div>
              <button className="rounded-xl border border-slate-200 p-2" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-5 p-6">
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                <p>Student source code and names will leave CampusGrade when you paste a prompt into an external service. Use only an institution-approved AI account and review its data policy.</p>
              </div>
              {!exportData && (
                <div className="rounded-2xl border border-slate-200 p-8 text-center">
                  <Sparkles className="mx-auto h-9 w-9 text-primary-600" />
                  <h3 className="mt-3 text-lg font-bold">Prepare evaluation batches</h3>
                  <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">Analyzed submissions are divided into batches of up to 10 students. Every repository file is included in full.</p>
                  <button className="btn btn-primary mt-5" disabled={busy} onClick={generate}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Prepare batches
                  </button>
                </div>
              )}
              {exportData && batch && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {exportData.batches.map((item: AnyRecord, index: number) => (
                      <button key={item.batch_number} onClick={() => setActiveBatch(index)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${activeBatch === index ? "border-primary-600 bg-primary-50 text-primary-700" : "border-slate-200"}`}>
                        Batch {item.batch_number} · {item.students.length} students {validated[item.batch_number] && "✓"}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-bold">
                          Batch {batch.batch_number} of {batch.batch_count}
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          {batch.character_count.toLocaleString()} characters · ≈{batch.estimated_tokens.toLocaleString()} tokens · {batch.included_file_count} complete files{batch.omitted_file_count ? ` · ${batch.omitted_file_count} archive read errors` : ""}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-outline" onClick={() => downloadText(batch.prompt, batch.filename)}>
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                        <button className="btn btn-primary" onClick={copyPrompt}>
                          <Clipboard className="h-4 w-4" />
                          Copy prompt
                        </button>
                      </div>
                    </div>
                    {batch.truncated && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">One or more archive files could not be read. The prompt contains the complete error list.</p>}
                    <label className="mt-5 block">
                      <span className="ui-field-label">Paste the AI JSON response for this batch</span>
                      <textarea
                        className="input-field mt-2 min-h-48 font-mono text-xs"
                        value={responses[batch.batch_number] || ""}
                        onChange={(event) => {
                          setResponses((current) => ({ ...current, [batch.batch_number]: event.target.value }));
                          setValidated((current) => {
                            const next = { ...current };
                            delete next[batch.batch_number];
                            return next;
                          });
                        }}
                        placeholder="Paste raw JSON or a fenced JSON block…"
                      />
                    </label>
                    <div className="mt-3 flex justify-end">
                      <button className="btn btn-outline" disabled={busy || !responses[batch.batch_number]?.trim()} onClick={validate}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Validate batch
                      </button>
                    </div>
                  </div>
                  {exportData.excluded_students.length > 0 && (
                    <details className="rounded-xl border border-slate-200 p-4">
                      <summary className="cursor-pointer font-semibold">{exportData.excluded_students.length} excluded students</summary>
                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        {exportData.excluded_students.map((student: AnyRecord) => (
                          <p key={student.student_id}>
                            {student.name}
                            {student.roll_no ? ` (${student.roll_no})` : ""} — {student.reason}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  {reviewedStudents.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-end justify-between">
                        <div>
                          <h3 className="text-lg font-bold">Class review</h3>
                          <p className="text-sm text-slate-500">Review and edit before saving. Nothing is published here.</p>
                        </div>
                        <span className="text-sm font-semibold">{reviewedStudents.length} validated</span>
                      </div>
                      <div className="space-y-4">
                        {reviewedStudents.map((student: AnyRecord) => (
                          <div key={student.student_id} className="rounded-2xl border border-slate-200 p-5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="font-bold">{student.student_name}</p>
                                <p className="text-xs text-slate-500">
                                  Confidence {Math.round(student.confidence * 100)}%{student.similarity_limited ? " · automatic similarity limit" : ""}
                                </p>
                              </div>
                              <p className="text-lg font-bold">
                                {Object.values(student.rubric_scores).reduce((sum: number, value) => sum + Number(value || 0), 0)}/{student.mark_limit ?? assignment.total_marks}
                              </p>
                            </div>
                            {Object.values(student.rubric_scores).reduce((sum: number, value) => sum + Number(value || 0), 0) > Number(student.mark_limit ?? assignment.total_marks) && (
                              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">Reduce the total to {student.mark_limit} marks or less before saving this batch.</p>
                            )}
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              {assignment.rubric.map((criterion: AnyRecord) => {
                                const score = Number(student.rubric_scores[criterion.id] || 0);
                                return (
                                  <div key={criterion.id} className="group rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg hover:shadow-primary-100/50">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-bold text-slate-900">{criterion.title}</p>
                                        <p className="mt-1 text-xs font-medium text-slate-500">{criterion.description}</p>
                                      </div>
                                      <span className="rounded-full bg-primary-50 px-3 py-1 text-sm font-bold text-primary-700">
                                        {score}/{criterion.max_marks}
                                      </span>
                                    </div>
                                    <input
                                      type="range"
                                      min="0"
                                      max={criterion.max_marks}
                                      step="0.5"
                                      className="mt-5 w-full cursor-pointer accent-primary-600"
                                      value={score}
                                      onChange={(event) => updateRubricScore(student.student_id, criterion, event.target.value)}
                                      aria-label={`${criterion.title} marks`}
                                    />
                                    <div className="mt-3 flex items-center justify-between gap-2">
                                      <button
                                        type="button"
                                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-primary-300 hover:text-primary-700"
                                        onClick={() => updateRubricScore(student.student_id, criterion, score - 0.5)}
                                        aria-label={`Decrease ${criterion.title} marks`}
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        max={criterion.max_marks}
                                        step="0.5"
                                        className="h-10 w-24 rounded-xl border border-slate-200 bg-white px-3 text-center font-bold outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                                        value={score}
                                        onChange={(event) => updateRubricScore(student.student_id, criterion, event.target.value)}
                                      />
                                      <button
                                        type="button"
                                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-primary-300 hover:text-primary-700"
                                        onClick={() => updateRubricScore(student.student_id, criterion, score + 0.5)}
                                        aria-label={`Increase ${criterion.title} marks`}
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                    </div>
                                    <div className="mt-4 space-y-3">
                                      <label className="block">
                                        <span className="ui-field-label">What was done well</span>
                                        <textarea
                                          className="input-field mt-1.5 min-h-24"
                                          value={student.rubric_feedback?.[criterion.id]?.what_was_done_well || ""}
                                          onChange={(event) => updateRubricFeedback(student.student_id, criterion.id, "what_was_done_well", event.target.value)}
                                          placeholder="Describe the repository evidence that earned marks."
                                        />
                                      </label>
                                      <label className="block">
                                        <span className="ui-field-label">What is missing</span>
                                        <textarea
                                          className="input-field mt-1.5 min-h-24"
                                          value={student.rubric_feedback?.[criterion.id]?.what_is_missing || ""}
                                          onChange={(event) => updateRubricFeedback(student.student_id, criterion.id, "what_is_missing", event.target.value)}
                                          placeholder="Explain absent or incomplete rubric requirements."
                                        />
                                      </label>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            {student.duplicate_review?.status !== "none" && (
                              <div className={`mt-3 rounded-xl p-3 text-sm ${student.duplicate_review.status === "exact_match" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}>
                                <p className="font-semibold">{student.duplicate_review.status.replaceAll("_", " ")} review</p>
                                <p className="mt-1">{student.duplicate_review.explanation || "Review the platform duplicate evidence before grading."}</p>
                                {student.duplicate_review.platform_evidence?.map((evidence: AnyRecord) => (
                                  <p key={evidence.flag_id} className="mt-1 text-xs">
                                    {evidence.type.replaceAll("_", " ")} · {Math.round(evidence.similarity * 100)}%
                                    {evidence.matched_student ? ` · matched with ${evidence.matched_student.name}${evidence.matched_student.roll_no ? ` (${evidence.matched_student.roll_no})` : ""}` : ""}
                                  </p>
                                ))}
                                {student.duplicate_review.status === "exact_match" && Object.values(student.rubric_scores).every((value) => Number(value) === 0) && (
                                  <label className="mt-3 flex items-start gap-2 font-semibold">
                                    <input
                                      type="checkbox"
                                      className="mt-1"
                                      checked={Boolean(confirmations[student.student_id])}
                                      onChange={(event) => setConfirmations((current) => ({ ...current, [student.student_id]: event.target.checked }))}
                                    />
                                    I reviewed the duplicate evidence and confirm this student should receive zero.
                                  </label>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white py-4">
                    <p className="text-sm text-slate-500">{allValidated ? "All batches are valid." : `${Object.keys(validated).length}/${exportData.batches.length} batches validated. Validated batches can be saved independently.`}</p>
                    <div className="flex gap-2">
                      <button className="btn btn-outline" disabled={busy} onClick={generate}>
                        Prepare fresh batches
                      </button>
                      <button className="btn btn-primary" disabled={busy || !canSave} onClick={saveAll}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Save validated batches
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

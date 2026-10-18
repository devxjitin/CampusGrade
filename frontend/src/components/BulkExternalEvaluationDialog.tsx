"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clipboard, Download, EyeOff, Link2, Loader2, Sparkles } from "lucide-react";
import Dialog from "@/components/ui/Dialog";
import { downloadText, type AnyRecord } from "./bulkExternalEvaluation/shared";
import ProblemList from "./bulkExternalEvaluation/ProblemList";
import ReviewStudentCard from "./bulkExternalEvaluation/ReviewStudentCard";
import Stepper from "./bulkExternalEvaluation/Stepper";
import { useBulkExternalEvaluation } from "./bulkExternalEvaluation/useBulkExternalEvaluation";

// Four steps: copy the prompt -> paste the AI's JSON -> review the proposed changes -> save.
export default function BulkExternalEvaluationDialog({ assignmentId, assignment, filesReady = true, onSaved }: { assignmentId: string; assignment: AnyRecord; filesReady?: boolean; onSaved?: () => void | Promise<void> }) {
  const {
    open,
    setOpen,
    mode,
    setMode,
    busy,
    exportData,
    activeBatch,
    setActiveBatch,
    responses,
    setResponses,
    validated,
    setValidated,
    problems,
    setProblems,
    confirmations,
    setConfirmations,
    batch,
    reviewedStudents,
    allValidated,
    needsConfirmation,
    canSave,
    generate,
    copyPrompt,
    validate,
    updateRubricScore,
    updateRubricFeedback,
    saveAll,
  } = useBulkExternalEvaluation({ assignmentId, assignment, onSaved });
  const [step, setStep] = useState(0);

  const reachable = reviewedStudents.length > 0 ? 3 : exportData ? 1 : 0;
  const batchProblems = batch ? problems[batch.batch_number] || [] : [];
  const unconfirmed = needsConfirmation.filter((student: AnyRecord) => !confirmations[student.student_id]).length;
  const totalMarks = useMemo(
    () => reviewedStudents.reduce((sum: number, student: AnyRecord) => sum + Object.values(student.rubric_scores).reduce<number>((inner, value) => inner + Number(value || 0), 0), 0),
    [reviewedStudents],
  );

  const prepare = async () => {
    setStep(0);
    await generate();
  };
  const runValidate = async () => {
    const ok = await validate();
    if (ok) {
      // Move on to the review as soon as every batch is valid; otherwise stay to paste the next batch.
      const remaining = exportData ? exportData.batches.findIndex((item: AnyRecord) => item.batch_number !== batch.batch_number && !validated[item.batch_number]) : -1;
      if (remaining >= 0) setActiveBatch(remaining);
      else setStep(2);
    }
  };

  const wholeClass = mode === "links";
  const batchTabs = exportData && exportData.batches.length > 1 && (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Batches">
      {exportData.batches.map((item: AnyRecord, index: number) => (
        <button
          key={item.batch_number}
          role="tab"
          aria-selected={activeBatch === index}
          onClick={() => setActiveBatch(index)}
          className={`rounded-xl border px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-200 ${activeBatch === index ? "border-primary-600 bg-primary-50 text-primary-800" : "border-slate-300 text-slate-800"}`}
        >
          Batch {item.batch_number} · {item.students.length} students {validated[item.batch_number] && <span aria-label="validated">✓</span>}
        </button>
      ))}
    </div>
  );

  const footer = (
    <>
      {step > 0 && (
        <button type="button" className="btn btn-outline" onClick={() => setStep(step - 1)} disabled={busy}>
          Back
        </button>
      )}
      {step === 0 && exportData && (
        <button type="button" className="btn btn-primary" onClick={() => setStep(1)}>
          I have the AI response — next
        </button>
      )}
      {step === 1 && (
        <button type="button" className="btn btn-primary" disabled={busy || !batch || !responses[batch.batch_number]?.trim()} onClick={runValidate}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          {wholeClass ? "Validate response" : "Validate batch"}
        </button>
      )}
      {step === 2 && (
        <button type="button" className="btn btn-primary" onClick={() => setStep(3)} disabled={!reviewedStudents.length}>
          Continue to save
        </button>
      )}
      {step === 3 && (
        <button type="button" className="btn btn-primary" disabled={busy || !canSave} onClick={saveAll}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
          Save {reviewedStudents.length} evaluation{reviewedStudents.length === 1 ? "" : "s"}
        </button>
      )}
    </>
  );

  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        External AI evaluator
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="External AI evaluation"
        description={`${assignment.title} · imported marks stay private until you publish them`}
        footer={footer}
      >
        <div className="space-y-5">
          <Stepper current={step} onSelect={setStep} reachable={reachable} />

          {step === 0 && (
            <section aria-labelledby="step-prompt" className="space-y-4">
              <h3 id="step-prompt" className="text-lg font-bold">Copy the prompt</h3>
              {!exportData && (
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Evaluation mode">
                  {(
                    [
                      ["links", Link2, "Whole class with GitHub links", "One prompt and one JSON for the whole class. The AI opens each repository itself, so nothing is copied. Public repositories only."],
                      ["files", EyeOff, "Full files in batches", `Every repository file is included in full, in batches of up to 10 students. Works with any AI, private repositories too.${filesReady ? "" : " Available after every repository is fetched."}`],
                    ] as const
                  ).map(([value, Icon, title, text]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      disabled={value === "files" && !filesReady}
                      onClick={() => setMode(value)}
                      className={`rounded-xl border p-4 text-left focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-4 focus-visible:ring-primary-200 ${mode === value ? "border-primary-600 bg-primary-50" : "border-slate-300"}`}
                    >
                      <span className="flex items-center gap-2 font-bold text-slate-900">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {title}
                      </span>
                      <span className="mt-1 block text-xs text-slate-600">{text}</span>
                    </button>
                  ))}
                </div>
              )}
              {wholeClass ? (
                <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
                  <p>Students appear as <strong>Student-01, Student-02…</strong>, and names, roll numbers and emails are not in the prompt. The GitHub links do contain each student&apos;s GitHub username, so this mode is not anonymous. Use only an institution-approved AI account that can browse GitHub.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">
                    <EyeOff className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
                    <p>Students appear only as <strong>Student-01, Student-02…</strong> in the prompt. Names, roll numbers, emails and GitHub usernames are removed, and the mapping back to real students stays in this browser.</p>
                  </div>
                  <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" aria-hidden="true" />
                    <p>Student source code still leaves CampusGrade when you paste the prompt into an external service. Use only an institution-approved AI account and review its data policy.</p>
                  </div>
                </>
              )}
              {!exportData && (
                <div className="rounded-2xl border border-slate-300 p-8 text-center">
                  <Sparkles className="mx-auto h-9 w-9 text-primary-700" aria-hidden="true" />
                  <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-700">{wholeClass ? "Every submitted repository is linked at its submitted commit in a single prompt for the whole class." : "Analyzed submissions are divided into batches of up to 10 students. Every repository file is included in full."}</p>
                  <button className="btn btn-primary mt-5" disabled={busy} onClick={prepare}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {wholeClass ? "Prepare class prompt" : "Prepare batches"}
                  </button>
                </div>
              )}
              {exportData && batch && (
                <>
                  {batchTabs}
                  <div className="rounded-2xl border border-slate-300 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="font-bold">{wholeClass ? `Whole class · ${batch.students.length} students` : `Batch ${batch.batch_number} of ${batch.batch_count}`}</h4>
                        <p className="mt-1 text-xs text-slate-600">
                          {batch.character_count.toLocaleString()} characters · ≈{batch.estimated_tokens.toLocaleString()} tokens{wholeClass ? "" : ` · ${batch.included_file_count} complete files${batch.omitted_file_count ? ` · ${batch.omitted_file_count} archive read errors` : ""}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-outline" onClick={() => downloadText(batch.prompt, batch.filename)}>
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Download
                        </button>
                        <button className="btn btn-primary" onClick={copyPrompt}>
                          <Clipboard className="h-4 w-4" aria-hidden="true" />
                          Copy prompt
                        </button>
                      </div>
                    </div>
                    {batch.truncated && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">One or more archive files could not be read. The prompt contains the complete error list.</p>}
                    <p className="mt-3 text-xs text-slate-600">In this batch: {batch.students.map((student: AnyRecord) => `${student.pseudonym} = ${student.student_name}`).join(" · ")}</p>
                  </div>
                  {exportData.excluded_students.length > 0 && (
                    <details className="rounded-xl border border-slate-300 p-4">
                      <summary className="cursor-pointer font-semibold">{exportData.excluded_students.length} excluded students</summary>
                      <div className="mt-3 space-y-1 text-sm text-slate-700">
                        {exportData.excluded_students.map((student: AnyRecord) => (
                          <p key={student.student_id}>
                            {student.name}
                            {student.roll_no ? ` (${student.roll_no})` : ""} — {student.reason}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              )}
            </section>
          )}

          {step === 1 && exportData && batch && (
            <section aria-labelledby="step-paste" className="space-y-4">
              <h3 id="step-paste" className="text-lg font-bold">Paste the AI response</h3>
              {batchTabs}
              <label className="block">
                <span className="ui-field-label">{wholeClass ? "JSON response for the whole class" : `JSON response for batch ${batch.batch_number}`}</span>
                <textarea
                  className="input-field mt-2 min-h-56 font-mono text-xs"
                  value={responses[batch.batch_number] || ""}
                  onChange={(event) => {
                    setResponses((current) => ({ ...current, [batch.batch_number]: event.target.value }));
                    setValidated((current) => {
                      const next = { ...current };
                      delete next[batch.batch_number];
                      return next;
                    });
                    setProblems((current) => ({ ...current, [batch.batch_number]: [] }));
                  }}
                  placeholder="Paste raw JSON or a fenced JSON block…"
                  aria-invalid={batchProblems.length > 0}
                />
              </label>
              <ProblemList problems={batchProblems} />
              {validated[batch.batch_number] && !batchProblems.length && (
                <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {wholeClass ? "The response is valid." : `Batch ${batch.batch_number} is valid.`}
                </p>
              )}
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="step-review" className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="step-review" className="text-lg font-bold">Review the changes</h3>
                  <p className="text-sm text-slate-600">Compare each student&apos;s proposed marks with what is saved, and edit before saving. Nothing is published here.</p>
                </div>
                <span className="text-sm font-semibold">{reviewedStudents.length} validated</span>
              </div>
              {reviewedStudents.length === 0 && <p className="text-sm text-slate-600">Validate at least one batch to review it.</p>}
              {reviewedStudents.map((student: AnyRecord) => (
                <ReviewStudentCard
                  key={student.student_id}
                  student={student}
                  assignment={assignment}
                  confirmed={Boolean(confirmations[student.student_id])}
                  onConfirm={(checked) => setConfirmations((current) => ({ ...current, [student.student_id]: checked }))}
                  onScore={(criterion, value) => updateRubricScore(student.student_id, criterion, value)}
                  onFeedback={(criterionId, field, value) => updateRubricFeedback(student.student_id, criterionId, field, value)}
                />
              ))}
            </section>
          )}

          {step === 3 && (
            <section aria-labelledby="step-save" className="space-y-3">
              <h3 id="step-save" className="text-lg font-bold">Save as private evaluations</h3>
              <p className="text-sm text-slate-700">
                {reviewedStudents.length} student{reviewedStudents.length === 1 ? "" : "s"} · {Math.round(totalMarks * 100) / 100} marks in total across them. They are saved as drafts only the teacher can see; real names are restored in the grading screens.
              </p>
              <p className="text-sm text-slate-700">{allValidated ? "All batches are valid." : `${Object.keys(validated).length}/${exportData?.batches.length ?? 0} batches validated. Validated batches can be saved on their own.`}</p>
              {!canSave && (
                <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Not ready to save: {unconfirmed ? `${unconfirmed} exact-duplicate zero${unconfirmed === 1 ? " needs" : "s need"} your confirmation, ` : ""}every criterion needs both feedback fields and each total must stay within its limit. Go back to review.
                </p>
              )}
              <button type="button" className="btn btn-outline" disabled={busy} onClick={prepare}>
                Discard and prepare again
              </button>
            </section>
          )}
        </div>
      </Dialog>
    </>
  );
}

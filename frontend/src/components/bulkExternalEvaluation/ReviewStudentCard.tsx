import { Minus, Plus } from "lucide-react";
import DiffTable from "./DiffTable";
import type { AnyRecord } from "./shared";

const sum = (values: unknown[]) => Math.round(values.reduce<number>((total, value) => total + Number(value || 0), 0) * 100) / 100;

// Review and edit one student's proposed evaluation. Marks and feedback stay editable until saved.
export default function ReviewStudentCard({
  student,
  assignment,
  confirmed,
  onConfirm,
  onScore,
  onFeedback,
}: {
  student: AnyRecord;
  assignment: AnyRecord;
  confirmed: boolean;
  onConfirm: (checked: boolean) => void;
  onScore: (criterion: AnyRecord, value: string | number) => void;
  onFeedback: (criterionId: string, field: string, value: string) => void;
}) {
  const total = sum(Object.values(student.rubric_scores));
  const limit = Number(student.mark_limit ?? assignment.total_marks);
  return (
    <article className="rounded-2xl border border-slate-300 p-5" aria-labelledby={`student-${student.student_id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 id={`student-${student.student_id}`} className="font-bold text-slate-950">
            {student.student_name} <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{student.pseudonym}</span>
          </h4>
          <p className="text-xs text-slate-600">
            Confidence {Math.round(student.confidence * 100)}%{student.similarity_limited ? " · automatic similarity limit" : ""}
          </p>
        </div>
        <p className="text-lg font-bold" aria-label={`Total ${total} of ${limit}`}>
          {total}/{limit}
        </p>
      </div>
      {total > limit && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
          Reduce the total to {limit} marks or less before saving.
        </p>
      )}
      <DiffTable student={student} scores={student.rubric_scores} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {assignment.rubric.map((criterion: AnyRecord) => {
          const score = Number(student.rubric_scores[criterion.id] || 0);
          const inputId = `${student.student_id}-${criterion.id}`;
          return (
            <fieldset key={criterion.id} className="rounded-2xl border border-slate-300 bg-white p-4">
              <legend className="px-1 text-sm font-bold text-slate-900">
                {criterion.title} <span className="font-semibold text-primary-800">({score}/{criterion.max_marks})</span>
              </legend>
              {criterion.description && <p className="text-xs text-slate-600">{criterion.description}</p>}
              <input
                type="range"
                min="0"
                max={criterion.max_marks}
                step="0.5"
                className="mt-4 w-full cursor-pointer accent-primary-700"
                value={score}
                onChange={(event) => onScore(criterion, event.target.value)}
                aria-label={`${criterion.title} marks slider`}
              />
              <div className="mt-3 flex items-center justify-between gap-2">
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-700 hover:border-primary-600 hover:text-primary-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-200" onClick={() => onScore(criterion, score - 0.5)} aria-label={`Decrease ${criterion.title} marks`}>
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <input
                  id={`${inputId}-marks`}
                  type="number"
                  min="0"
                  max={criterion.max_marks}
                  step="0.5"
                  className="h-10 w-24 rounded-xl border border-slate-400 bg-white px-3 text-center font-bold focus:border-primary-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-200"
                  value={score}
                  onChange={(event) => onScore(criterion, event.target.value)}
                  aria-label={`${criterion.title} marks`}
                />
                <button type="button" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-400 bg-white text-slate-700 hover:border-primary-600 hover:text-primary-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-200" onClick={() => onScore(criterion, score + 0.5)} aria-label={`Increase ${criterion.title} marks`}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block" htmlFor={`${inputId}-well`}>
                  <span className="ui-field-label">What was done well</span>
                  <textarea
                    id={`${inputId}-well`}
                    className="input-field mt-1.5 min-h-24"
                    value={student.rubric_feedback?.[criterion.id]?.what_was_done_well || ""}
                    onChange={(event) => onFeedback(criterion.id, "what_was_done_well", event.target.value)}
                    placeholder="Describe the repository evidence that earned marks."
                  />
                </label>
                <label className="block" htmlFor={`${inputId}-missing`}>
                  <span className="ui-field-label">What is missing</span>
                  <textarea
                    id={`${inputId}-missing`}
                    className="input-field mt-1.5 min-h-24"
                    value={student.rubric_feedback?.[criterion.id]?.what_is_missing || ""}
                    onChange={(event) => onFeedback(criterion.id, "what_is_missing", event.target.value)}
                    placeholder="Explain absent or incomplete rubric requirements."
                  />
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>
      {student.duplicate_review?.status !== "none" && (
        <div className={`mt-3 rounded-xl p-3 text-sm ${student.duplicate_review.status === "exact_match" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
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
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} />
              I reviewed the duplicate evidence and confirm this student should receive zero.
            </label>
          )}
        </div>
      )}
    </article>
  );
}

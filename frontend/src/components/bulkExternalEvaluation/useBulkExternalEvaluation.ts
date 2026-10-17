"use client";

import { useMemo, useState } from "react";
import { exportAssignmentExternalEvaluation, saveAssignmentExternalEvaluations, validateAssignmentExternalEvaluation } from "@/features/ai/api";
import { useToast } from "@/components/Toast";
import { parseExternalJson } from "@/lib/parseExternalJson";
import { downloadText, errorMessage, validationProblems, type AnyRecord, type ValidationProblem } from "./shared";

export const useBulkExternalEvaluation = ({
  assignmentId,
  assignment,
  onSaved,
}: {
  assignmentId: string;
  assignment: AnyRecord;
  onSaved?: () => void | Promise<void>;
}) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportData, setExportData] = useState<AnyRecord | null>(null);
  const [activeBatch, setActiveBatch] = useState(0);
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [validated, setValidated] = useState<Record<number, AnyRecord>>({});
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<number, ValidationProblem[]>>({});

  const batch = exportData?.batches?.[activeBatch];
  const reviewedStudents = useMemo(
    () =>
      Object.values(validated)
        .sort((a, b) => a.batch_number - b.batch_number)
        .flatMap((value) =>
          value.students.map((student: AnyRecord) => ({
            ...student,
            batch_token: exportData?.batches.find((item: AnyRecord) => item.batch_number === value.batch_number)?.batch_id,
          })),
        ),
    [validated, exportData],
  );
  const allValidated = Boolean(exportData?.batches?.length) && Object.keys(validated).length === exportData?.batches.length;
  const needsConfirmation = reviewedStudents.filter((student: AnyRecord) => student.duplicate_review?.status === "exact_match" && Object.values(student.rubric_scores).every((value) => Number(value) === 0));
  const canSave =
    reviewedStudents.length > 0 &&
    reviewedStudents.every((student: AnyRecord) => assignment.rubric.every((criterion: AnyRecord) => student.rubric_feedback?.[criterion.id]?.what_was_done_well?.trim() && student.rubric_feedback?.[criterion.id]?.what_is_missing?.trim())) &&
    reviewedStudents.every((student: AnyRecord) => Object.values(student.rubric_scores).reduce((sum: number, value) => sum + Number(value || 0), 0) <= Number(student.mark_limit ?? assignment.total_marks)) &&
    needsConfirmation.every((student: AnyRecord) => confirmations[student.student_id]);

  const reset = () => {
    setExportData(null);
    setResponses({});
    setValidated({});
    setConfirmations({});
    setProblems({});
    setActiveBatch(0);
  };
  const generate = async () => {
    setBusy(true);
    reset();
    try {
      const result = await exportAssignmentExternalEvaluation(assignmentId);
      setExportData(result);
      toast.success(`${result.batches.length} secure evaluation batch${result.batches.length === 1 ? "" : "es"} prepared`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not prepare class evaluation"));
    } finally {
      setBusy(false);
    }
  };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(batch.prompt);
      toast.success(`Batch ${batch.batch_number} prompt copied`);
    } catch {
      downloadText(batch.prompt, batch.filename);
      toast.info("Clipboard was unavailable. The prompt was downloaded instead.");
    }
  };
  const validate = async () => {
    let result;
    try {
      result = parseExternalJson(responses[batch.batch_number] || "");
    } catch {
      setProblems((current) => ({ ...current, [batch.batch_number]: [{ student: "", criterion: null, path: "", message: "That is not valid JSON. Paste the raw JSON or a fenced JSON block from the AI tool." }] }));
      return false;
    }
    setBusy(true);
    try {
      const value = await validateAssignmentExternalEvaluation(assignmentId, {
        batch_token: batch.batch_id,
        result: result as Record<string, unknown>,
      });
      setValidated((current) => ({ ...current, [batch.batch_number]: value }));
      setProblems((current) => ({ ...current, [batch.batch_number]: [] }));
      toast.success(`Batch ${batch.batch_number} is valid`);
      return true;
    } catch (error) {
      const list = validationProblems(error);
      setProblems((current) => ({ ...current, [batch.batch_number]: list.length ? list : [{ student: "", criterion: null, path: "", message: errorMessage(error, "The AI response is invalid") }] }));
      setValidated((current) => {
        const next = { ...current };
        delete next[batch.batch_number];
        return next;
      });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const updateStudent = (studentId: string, updater: (student: AnyRecord) => AnyRecord) => {
    setValidated((current) => {
      const next: Record<number, AnyRecord> = { ...current };
      Object.keys(next).forEach((key) => {
        const k = Number(key);
        next[k] = { ...next[k], students: next[k].students.map((student: AnyRecord) => (student.student_id === studentId ? updater(student) : student)) };
      });
      return next;
    });
  };
  const updateRubricScore = (studentId: string, criterion: AnyRecord, rawScore: string | number) => {
    const numericScore = Number(rawScore);
    const score = Number.isFinite(numericScore) ? Math.min(Number(criterion.max_marks), Math.max(0, numericScore)) : 0;
    updateStudent(studentId, (student) => ({ ...student, rubric_scores: { ...student.rubric_scores, [criterion.id]: score } }));
  };
  const updateRubricFeedback = (studentId: string, criterionId: string, field: string, value: string) => {
    updateStudent(studentId, (student) => ({ ...student, rubric_feedback: { ...student.rubric_feedback, [criterionId]: { ...student.rubric_feedback?.[criterionId], [field]: value } } }));
  };
  const saveAll = async () => {
    setBusy(true);
    try {
      const students = reviewedStudents.map((student: AnyRecord) => ({
        student_id: student.student_id,
        submission_version_id: student.submission_version_id,
        rubric_scores: student.rubric_scores,
        rubric_feedback: student.rubric_feedback,
        expected_revision: student.expected_revision,
        batch_token: student.batch_token,
        duplicate_confirmed: Boolean(confirmations[student.student_id]),
        duplicate_flag_ids: confirmations[student.student_id] ? student.duplicate_review?.exact_flag_ids || [] : [],
      }));
      const result = await saveAssignmentExternalEvaluations(assignmentId, { schema_version: 1, students });
      toast.success(result.message);
      setOpen(false);
      reset();
      await onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error, "Class evaluations could not be saved"));
    } finally {
      setBusy(false);
    }
  };

  return {
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
    problems,
    setProblems,
    confirmations,
    setConfirmations,
    batch,
    reviewedStudents,
    allValidated,
    needsConfirmation,
    canSave,
    reset,
    generate,
    copyPrompt,
    validate,
    updateRubricScore,
    updateRubricFeedback,
    saveAll
  };
};

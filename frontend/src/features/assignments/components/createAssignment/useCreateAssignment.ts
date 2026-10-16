"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTeacherCourses } from "@/features/academics/api";
import { generateExternalAIPrompt, importExternalAIProposal } from "@/features/ai/api";
import { createAssignment, getTeacherAssignment, updateAssignment, uploadAssignmentAttachment } from "@/features/assignments/api";
import { useToast } from "@/components/Toast";
import { toLocalInputDateTime, toServerDateTime } from "@/lib/datetime";
import { getCachedUser } from "@/lib/session";
import { parseExternalJson } from "@/lib/parseExternalJson";
import type { ApiRequestBody } from "@/types/api-client";
import {
  TABS,
  blank,
  normalizeTeachingAssignments,
  parseCommaSeparatedValues,
  type AnyRecord,
  type AssignmentDifficulty,
} from "./shared";

export const useCreateAssignment = () => {
  const user = useMemo(() => getCachedUser(), []);
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const editing = Boolean(id);
  const [form, setForm] = useState<AnyRecord>(blank());
  const [assignments, setAssignments] = useState<AnyRecord[]>([]);
  const [tab, setTab] = useState("basics");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<AnyRecord[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [learningOutcomesInput, setLearningOutcomesInput] = useState("");
  const [requiredFilesInput, setRequiredFilesInput] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiTotalMarks, setAiTotalMarks] = useState(20);
  const [aiRubricCount, setAiRubricCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<AssignmentDifficulty>("intermediate");
  const [aiRequireReadme, setAiRequireReadme] = useState(true);
  const [aiPreview, setAiPreview] = useState<AnyRecord | null>(null);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [externalPrompt, setExternalPrompt] = useState("");
  const [externalJson, setExternalJson] = useState("");
  const [importingProposal, setImportingProposal] = useState(false);
  const [showAiStudio, setShowAiStudio] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const hydrateAssignment = useCallback((item: AnyRecord) => {
    setForm({
      ...blank(),
      ...item,
      status: "published",
      opens_at: toLocalInputDateTime(item.opens_at),
      due_at: toLocalInputDateTime(item.due_at),
      result_release_at: toLocalInputDateTime(item.result_release_at),
      rubric: item.rubric || blank().rubric,
      links: (item.resources || []).filter((x: AnyRecord) => x.kind === "link").map((x: AnyRecord) => ({ label: x.label, url: x.url })),
    });
    setAttachments((item.resources || []).filter((x: AnyRecord) => x.kind === "attachment"));
    setTagsInput((item.tags || []).join(", "));
    setLearningOutcomesInput((item.learning_outcomes || []).join(", "));
    setRequiredFilesInput((item.repository_requirements?.required_files || []).join(", "));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const courses = await getTeacherCourses();
        if (!active) return;
        setAssignments(normalizeTeachingAssignments(courses.assignments));
        if (editing && id) {
          const result = await getTeacherAssignment(id);
          if (!active) return;
          const item = result.assignment;
          hydrateAssignment(item);
          if (!item.edit_allowed) {
            toast.error("This assignment is locked because a student has submitted work");
            router.replace(`/assignments/${id}/review`);
          }
        }
      } catch (error) {
        if (!active) return;
        const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast.error(message || "Failed to load assignment form");
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id]);

  const programs = useMemo(() => {
    const seen = new Set<string>();
    return assignments.filter((x) => {
      const key = `${x.program_id || x.course_id}|${x.batch_id || ""}|${x.section_id || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [assignments]);
  const selectedKey = `${form.target_course_id}|${form.target_batch_id}|${form.target_section_id}`;
  const selectedProgram = useMemo(() => programs.find((item) => `${item.program_id || item.course_id}|${item.batch_id || ""}|${item.section_id || ""}` === selectedKey), [programs, selectedKey]);
  const subjects = useMemo(
    () =>
      assignments
        .filter((x) => `${x.program_id || x.course_id}|${x.batch_id || ""}|${x.section_id || ""}` === selectedKey)
        .flatMap((x) => (x.subjects || (x.subject ? [x.subject] : [])).map((name: string, index: number) => ({ name, id: (x.subject_ids || [])[index] || "" })))
        .filter((item, index, rows) => item.name && rows.findIndex((other) => other.id === item.id && other.name === item.name) === index),
    [assignments, selectedKey],
  );

  const selectAiAudience = (value: string) => {
    const item = programs.find((program) => `${program.program_id || program.course_id}|${program.batch_id || ""}|${program.section_id || ""}` === value);
    setForm((current: AnyRecord) => ({
      ...current,
      target_course_id: item?.program_id || item?.course_id || "",
      target_batch_id: item?.batch_id || "",
      target_section_id: item?.section_id || "",
      subject: "",
      subject_id: "",
    }));
  };
  const selectAiCourse = (subjectId: string) => {
    const selected = subjects.find((item) => item.id === subjectId);
    setForm((current: AnyRecord) => ({ ...current, subject_id: subjectId, subject: selected?.name || "" }));
  };
  const rubricTotal = form.rubric.reduce((sum: number, item: AnyRecord) => sum + Number(item.max_marks || 0), 0);

  const generateWithAI = async () => {
    const totalMarks = Number(aiTotalMarks);
    const rubricCount = Number(aiRubricCount);
    if (!aiPrompt.trim()) {
      toast.error("Describe the assignment for the external AI");
      return;
    }
    if (!selectedProgram || !form.subject) {
      toast.error("Select the program, program year/batch, section, and course in the AI assistant before generating a prompt");
      return;
    }
    if (!Number.isFinite(totalMarks) || totalMarks <= 0 || !Number.isInteger(rubricCount) || rubricCount < 1 || rubricCount > 20) {
      toast.error("Enter a positive total mark and between 1 and 20 rubric criteria");
      return;
    }
    setGeneratingAI(true);
    try {
      const result = await generateExternalAIPrompt({
        sourcePrompt: aiPrompt,
        course: form.subject,
        program: selectedProgram?.program || selectedProgram?.course || "",
        programYear: selectedProgram?.program_year || selectedProgram?.year || selectedProgram?.batch || "",
        batch: selectedProgram?.batch || "",
        section: selectedProgram?.section || "",
        difficulty: aiDifficulty,
        requireReadme: aiRequireReadme,
        customInstructions: aiInstructions,
        totalMarks,
        rubricCount,
      });
      setExternalPrompt(result.prompt);
      setAiPreview(null);
      try {
        await navigator.clipboard.writeText(result.prompt);
        toast.success("External-AI prompt copied. Paste the JSON response here when ready.");
      } catch {
        toast.success("External-AI prompt is ready. Use Copy prompt to copy it.");
      }
    } catch (error) {
      const err = error as { response?: { data?: { detail?: string; message?: string } } };
      toast.error(err.response?.data?.detail || err.response?.data?.message || "Could not prepare the external-AI prompt");
    } finally {
      setGeneratingAI(false);
    }
  };
  const copyExternalPrompt = async () => {
    try {
      await navigator.clipboard.writeText(externalPrompt);
      toast.success("Prompt copied. Paste the JSON response here when ready.");
    } catch {
      toast.error("Copy is unavailable. Select and copy the prompt manually.");
    }
  };
  const importExternalProposalJson = async () => {
    if (!externalJson.trim()) {
      toast.error("Paste the JSON response from your external AI service");
      return;
    }
    setImportingProposal(true);
    try {
      // parseExternalJson strips optional ```json...``` fences before parsing —
      // identical behavior to BulkExternalEvaluationDialog and the legacy app.
      const parsed = parseExternalJson(externalJson) as Record<string, unknown>;
      const result = await importExternalAIProposal(parsed, { totalMarks: Number(aiTotalMarks), rubricCount: Number(aiRubricCount), difficulty: aiDifficulty, requireReadme: aiRequireReadme });
      setAiPreview(result.proposal);
      toast.success("JSON proposal validated and ready to apply");
    } catch (error) {
      const message =
        error instanceof SyntaxError ? "The pasted response is not valid JSON" : (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data?.detail || (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Could not import the JSON proposal";
      toast.error(message);
    } finally {
      setImportingProposal(false);
    }
  };
  const applyAIPreview = () => {
    if (!aiPreview) return;
    setForm((current: AnyRecord) => ({
      ...current,
      title: aiPreview.title,
      short_description: aiPreview.short_description,
      instructions: aiPreview.instructions,
      difficulty: aiPreview.difficulty,
      learning_outcomes: aiPreview.learning_outcomes,
      tags: aiPreview.tags,
      repository_requirements: aiPreview.repository_requirements,
      total_marks: aiPreview.total_marks,
      rubric: aiPreview.rubric.map((item: AnyRecord) => ({ ...item, id: item.id || crypto.randomUUID() })),
    }));
    setTagsInput((aiPreview.tags || []).join(", "));
    setLearningOutcomesInput((aiPreview.learning_outcomes || []).join(", "));
    setRequiredFilesInput((aiPreview.repository_requirements?.required_files || []).join(", "));
    setAiPreview(null);
    setShowAiStudio(false);
    setTab("basics");
    toast.success("AI proposal applied. Complete the schedule and publish when ready.");
  };

  const issues: string[] = [];
  if (!form.title.trim()) issues.push("Title is required");
  if (!form.instructions.trim()) issues.push("Instructions are required");
  if (Number(form.total_marks) <= 0) issues.push("Total marks must be greater than zero");
  if (!form.target_course_id) issues.push("Program audience is required");
  if (!form.subject) issues.push("Course is required");
  if (!form.subject_id) issues.push("Official course record is required");
  if (!form.due_at) issues.push("Deadline is required");
  if (form.result_release_mode === "scheduled" && !form.result_release_at) issues.push("Scheduled result release time is required");
  if (form.result_release_mode === "scheduled" && form.due_at && form.result_release_at && form.result_release_at < form.due_at) issues.push("Result release must be at or after the deadline");
  if (!form.rubric.length) issues.push("At least one rubric criterion is required");
  if (Math.abs(rubricTotal - Number(form.total_marks)) > 0.001) issues.push("Rubric marks must equal total marks");

  const stepIssues = (step: string): string[] => {
    if (step === "basics")
      return [!form.title.trim() && "Assignment title is required", !form.short_description.trim() && "Short description is required", !form.instructions.trim() && "Instructions are required", Number(form.total_marks) <= 0 && "Total marks must be greater than zero"].filter(
        Boolean,
      ) as string[];
    if (step === "audience")
      return [
        !form.target_course_id && "Program, batch, and section are required",
        !form.target_batch_id && "Batch is required",
        !form.target_section_id && "Section is required",
        !form.subject_id && "Course is required",
        !form.due_at && "Normal deadline is required",
        form.opens_at && form.due_at && form.opens_at >= form.due_at && "Opening time must be before the deadline",
      ].filter(Boolean) as string[];
    if (step === "rubric")
      return [
        !form.rubric.length && "Add at least one rubric criterion",
        form.rubric.some((item: AnyRecord) => !item.title.trim() || !item.description.trim() || Number(item.max_marks) <= 0) && "Complete every rubric criterion with a positive mark value",
        Math.abs(rubricTotal - Number(form.total_marks)) > 0.001 && "Rubric marks must equal total marks",
      ].filter(Boolean) as string[];
    if (step === "results")
      return [
        form.result_release_mode === "scheduled" && !form.result_release_at && "Scheduled result release time is required",
        form.result_release_mode === "scheduled" && form.due_at && form.result_release_at && form.result_release_at < form.due_at && "Result release must be at or after the deadline",
      ].filter(Boolean) as string[];
    if (step === "resources") return form.links.some((link: AnyRecord) => (link.label && !link.url) || (!link.label && link.url)) ? ["Each reference link needs both a label and URL"] : [];
    return issues;
  };

  const goToTab = (nextTab: string) => {
    const currentIndex = TABS.findIndex((item) => item[0] === tab);
    const nextIndex = TABS.findIndex((item) => item[0] === nextTab);
    if (nextIndex > currentIndex) {
      for (let index = currentIndex; index < nextIndex; index += 1) {
        const invalid = stepIssues(TABS[index][0]);
        if (invalid.length) {
          setTab(TABS[index][0]);
          toast.error(invalid[0]);
          return;
        }
      }
    }
    setTab(nextTab);
  };

  const payload = (): ApiRequestBody<"/assignments/teacher", "post"> => ({
    ...form,
    status: "published",
    tags: parseCommaSeparatedValues(tagsInput),
    learning_outcomes: parseCommaSeparatedValues(learningOutcomesInput),
    repository_requirements: { ...form.repository_requirements, required_files: parseCommaSeparatedValues(requiredFilesInput) },
    opens_at: form.opens_at ? toServerDateTime(form.opens_at) : null,
    due_at: form.due_at ? toServerDateTime(form.due_at) : null,
    allow_late: false,
    late_until: null,
    result_release_at: form.result_release_mode === "scheduled" && form.result_release_at ? toServerDateTime(form.result_release_at) : null,
    rubric: form.rubric.map(({ id: criterionId, ...item }: AnyRecord) => ({ ...item, id: criterionId })),
    links: form.links.filter((x: AnyRecord) => x.label && x.url),
  }) as ApiRequestBody<"/assignments/teacher", "post">;

  // Computed at form-change time so JSX can read it without calling Date.now() during render.
  // The save() handler re-evaluates inline to get a fresh timestamp at the moment of saving.
  // eslint-disable-next-line react-hooks/purity
  const isScheduled = useMemo(() => Boolean(form.opens_at) && new Date(form.opens_at).getTime() > Date.now(), [form.opens_at]);

  const save = async () => {
    if (issues.length) {
      toast.error(issues[0]);
      return;
    }
    setSaving(true);
    try {
      let result;
      let assignmentId = id;
      if (editing && id) {
        result = await updateAssignment(id, payload());
        hydrateAssignment(result.assignment);
      } else {
        result = await createAssignment(payload());
        assignmentId = result.assignment.id;
      }
      for (const file of pendingFiles) await uploadAssignmentAttachment(assignmentId!, file);
      setPendingFiles([]);
      toast.success(editing ? "Assignment updated. Students have been notified." : isScheduled ? "Assignment scheduled" : "Assignment published live");
      if (!editing) router.replace("/assignments");
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to save assignment");
    } finally {
      setSaving(false);
    }
  };

  const tabIndex = TABS.findIndex((x) => x[0] === tab);

  return {
    user,
    id,
    editing,
    form,
    setForm,
    tab,
    setTab,
    saving,
    attachments,
    setAttachments,
    pendingFiles,
    setPendingFiles,
    tagsInput,
    setTagsInput,
    learningOutcomesInput,
    setLearningOutcomesInput,
    requiredFilesInput,
    setRequiredFilesInput,
    aiPrompt,
    setAiPrompt,
    aiInstructions,
    setAiInstructions,
    aiTotalMarks,
    setAiTotalMarks,
    aiRubricCount,
    setAiRubricCount,
    aiDifficulty,
    setAiDifficulty,
    aiRequireReadme,
    setAiRequireReadme,
    aiPreview,
    generatingAI,
    externalPrompt,
    externalJson,
    setExternalJson,
    importingProposal,
    showAiStudio,
    setShowAiStudio,
    router,
    toast,
    programs,
    selectedKey,
    selectedProgram,
    subjects,
    selectAiAudience,
    selectAiCourse,
    rubricTotal,
    generateWithAI,
    copyExternalPrompt,
    importExternalProposalJson,
    applyAIPreview,
    issues,
    stepIssues,
    goToTab,
    isScheduled,
    save,
    tabIndex
  };
};

export type CreateAssignmentModel = ReturnType<typeof useCreateAssignment>;

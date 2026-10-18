"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTeacherContextOptions } from "@/features/academics/api";
import { generateExternalAIPrompt, validateExternalAIProposal } from "@/features/ai/api";
import { createAssignment, getTeacherAssignment, updateAssignment, uploadAssignmentAttachment } from "@/features/assignments/api";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui";
import { toLocalInputDateTime, toServerDateTime } from "@/lib/datetime";
import { getCachedUser } from "@/lib/session";
import { parseExternalJson } from "@/lib/parseExternalJson";
import { validationProblems, type ValidationProblem } from "@/components/bulkExternalEvaluation/shared";
import type { ApiRequestBody } from "@/types/api-client";
import {
  TABS,
  blank,
  parseCommaSeparatedValues,
  type AnyRecord,
  type AssignmentDifficulty,
  type ContextProgram,
} from "./shared";

export const useCreateAssignment = () => {
  const user = useMemo(() => getCachedUser(), []);
  const params = useParams<{ id?: string }>();
  const id = params?.id;
  const editing = Boolean(id);
  const [form, setForm] = useState<AnyRecord>(blank());
  const [contextOptions, setContextOptions] = useState<ContextProgram[]>([]);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [tab, setTab] = useState(id ? "basics" : "context");
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<AnyRecord[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; percent: number } | null>(null);
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
  const [aiStep, setAiStep] = useState(0);
  const [draftToken, setDraftToken] = useState("");
  const [aiProblems, setAiProblems] = useState<ValidationProblem[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [externalJson, setExternalJson] = useState("");
  const [importingProposal, setImportingProposal] = useState(false);
  const [showAiStudio, setShowAiStudio] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

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
        const options = await getTeacherContextOptions();
        if (!active) return;
        setContextOptions(options.programs as ContextProgram[]);
        setContextLoaded(true);
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

  const selectedProgram = contextOptions.find((item) => item.id === form.target_course_id);
  const selectedBatch = selectedProgram?.batches.find((item) => item.id === form.target_batch_id);
  const selectedSection = selectedBatch?.sections.find((item) => item.id === form.target_section_id);
  const selectedSubject = selectedSection?.subjects.find((item) => item.id === form.subject_id);
  const contextReady = Boolean(selectedProgram && selectedBatch && selectedSection && selectedSubject);
  const contextLabel = contextReady ? [selectedProgram?.name, selectedBatch?.name, `Section ${selectedSection?.name}`, selectedSubject?.name].join(" · ") : "";

  // Choosing a level clears every level below it. A generated AI prompt or proposal belongs to the
  // class it was made for, so it is dropped when the class changes.
  const setContextLevel = async (level: "program" | "batch" | "section" | "subject", value: string) => {
    if ((externalPrompt || aiPreview) && value !== { program: form.target_course_id, batch: form.target_batch_id, section: form.target_section_id, subject: form.subject_id }[level]) {
      const ok = await confirm({ title: "Change class or subject?", description: "The AI prompt and any pasted proposal were made for the current selection and will be discarded.", confirmLabel: "Change", cancelLabel: "Keep current" });
      if (!ok) return;
    }
    setExternalPrompt("");
    setExternalJson("");
    setAiPreview(null);
    setAiProblems([]);
    setAiWarnings([]);
    setAiStep(0);
    setDraftToken("");
    setForm((current: AnyRecord) => {
      const next = { ...current };
      if (level === "program") Object.assign(next, { target_course_id: value, target_batch_id: "", target_section_id: "", subject_id: "", subject: "" });
      if (level === "batch") Object.assign(next, { target_batch_id: value, target_section_id: "", subject_id: "", subject: "" });
      if (level === "section") Object.assign(next, { target_section_id: value, subject_id: "", subject: "" });
      if (level === "subject") {
        const subject = contextOptions.find((p) => p.id === current.target_course_id)?.batches.find((b) => b.id === current.target_batch_id)?.sections.find((sec) => sec.id === current.target_section_id)?.subjects.find((sub) => sub.id === value);
        Object.assign(next, { subject_id: value, subject: subject?.name || "" });
      }
      return next;
    });
  };
  const rubricTotal = form.rubric.reduce((sum: number, item: AnyRecord) => sum + Number(item.max_marks || 0), 0);

  const generateWithAI = async () => {
    const totalMarks = Number(aiTotalMarks);
    const rubricCount = Number(aiRubricCount);
    if (!aiPrompt.trim()) {
      toast.error("Describe the assignment for the external AI");
      return;
    }
    if (!contextReady) {
      toast.error("Select program, batch, section and subject first");
      return;
    }
    if (!Number.isFinite(totalMarks) || totalMarks <= 0 || !Number.isInteger(rubricCount) || rubricCount < 1 || rubricCount > 20) {
      toast.error("Enter a positive total mark and between 1 and 20 rubric criteria");
      return;
    }
    setGeneratingAI(true);
    try {
      const result = await generateExternalAIPrompt({
        program_id: form.target_course_id,
        batch_id: form.target_batch_id,
        section_id: form.target_section_id,
        subject_id: form.subject_id,
        brief: aiPrompt,
        guidance: aiInstructions,
        total_marks: totalMarks,
        rubric_count: rubricCount,
        difficulty: aiDifficulty,
        require_readme: aiRequireReadme,
      });
      setExternalPrompt(result.prompt);
      setDraftToken(result.draft_token);
      setAiPreview(null);
      setAiStep(1);
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
    setAiProblems([]);
    setAiWarnings([]);
    try {
      // parseExternalJson strips optional ```json...``` fences before parsing.
      const parsed = parseExternalJson(externalJson) as Record<string, unknown>;
      const result = await validateExternalAIProposal(draftToken, parsed);
      setAiPreview(result.proposal);
      setAiWarnings(result.warnings ?? []);
      setAiStep(3);
      toast.success("JSON validated. Review it before applying.");
    } catch (error) {
      setAiPreview(null);
      if (error instanceof SyntaxError) {
        setAiProblems([{ student: "", criterion: null, path: "", message: `The pasted text is not valid JSON (${error.message})` }]);
        return;
      }
      const problems = validationProblems(error);
      if (problems.length) {
        setAiProblems(problems);
        return;
      }
      const data = (error as { response?: { data?: { detail?: string; message?: string } } })?.response?.data;
      toast.error(data?.detail || data?.message || "Could not validate the JSON");
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
    setAiStep(0);
    setTab("basics");
    toast.success("AI proposal applied. Complete the schedule and publish when ready.");
  };

  const issues: string[] = [];
  if (!form.title.trim()) issues.push("Title is required");
  if (!form.instructions.trim()) issues.push("Instructions are required");
  if (Number(form.total_marks) <= 0) issues.push("Total marks must be greater than zero");
  if (!contextReady && contextLoaded) issues.push("Select program, batch, section and subject");
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
    if (step === "context")
      return [!form.target_course_id && "Select a program", !form.target_batch_id && "Select a batch", !form.target_section_id && "Select a section", !form.subject_id && "Select a subject", !contextReady && contextLoaded && "Pick a class and subject you are allocated to"].filter(Boolean) as string[];
    if (step === "audience")
      return [
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
    if (nextTab !== "context" && contextLoaded && !contextReady) {
      setTab("context");
      toast.error(stepIssues("context")[0] || "Select program, batch, section and subject first");
      return;
    }
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
      try {
        for (const file of pendingFiles) {
          setUploadProgress({ name: file.name, percent: 0 });
          await uploadAssignmentAttachment(assignmentId!, file, (percent) => setUploadProgress({ name: file.name, percent }));
        }
      } finally {
        setUploadProgress(null);
      }
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
    uploadProgress,
    setUploadProgress,
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
    aiStep,
    setAiStep,
    draftToken,
    aiProblems,
    aiWarnings,
    generatingAI,
    externalPrompt,
    externalJson,
    setExternalJson,
    importingProposal,
    showAiStudio,
    setShowAiStudio,
    router,
    toast,
    contextOptions,
    contextLoaded,
    contextReady,
    contextLabel,
    selectedProgram,
    selectedBatch,
    selectedSection,
    selectedSubject,
    setContextLevel,
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getAssignmentRepository, getAssignmentRepositoryFile, getAssignmentRoster, publishAssignmentGrade, resetStudentRepository, saveAssignmentGrade, startStudentEvaluation } from "@/features/grading/api";
import { useToast } from "@/components/Toast";
import { getCachedUser } from "@/lib/session";
import type { AnyRecord } from "./shared";

export const useAssignmentReview = () => {
  const user = useMemo(() => getCachedUser(), []);
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [data, setData] = useState<AnyRecord | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState("overview");
  const [repo, setRepo] = useState<AnyRecord | null>(null);
  const [search, setSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterFilter, setRosterFilter] = useState("all");
  const [fileContent, setFileContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [rubricFeedback, setRubricFeedback] = useState<Record<string, AnyRecord>>({});

  const load = async (keepSelection?: string) => {
    try {
      const result = await getAssignmentRoster(id);
      setData(result);
      const next = keepSelection || selectedId || result.roster.find((x: AnyRecord) => x.submission)?.student.id || result.roster[0]?.student.id || "";
      setSelectedId(next);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to load submissions");
      router.push("/assignments");
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") load(selectedId);
    }, 10000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const selected = data?.roster.find((x: AnyRecord) => x.student.id === selectedId);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRepo(null);
     
    setSelectedPath("");
     
    setFileContent("");
    if (selected?.grade) {
       
      setScores(selected.grade.rubric_scores || {});
       
      setRubricFeedback(selected.grade.rubric_feedback || {});
    } else {
       
      setScores({});
       
      setRubricFeedback({});
    }
    if (selected?.version?.id && selected.version.analysis_status === "ready")
      getAssignmentRepository(id, selected.version.id)
        .then(setRepo)
        .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.version?.id]);

  if (!data || !user) return null;

  const assignment = data.assignment;
  const evaluation = data.evaluation_workflow || assignment.evaluation_workflow || {};
  const canEvaluate = Boolean(selected?.grade?.is_missing || (selected?.freeze_state?.status === "frozen" && selected?.version?.analysis_status === "ready"));
  const version = selected?.version;
  const grade = selected?.grade;
  const filteredFiles = (repo?.manifest || []).filter((x: AnyRecord) => x.path.toLowerCase().includes(search.toLowerCase()));
  const selectedFlags = (data.duplicate_flags || []).filter((x: AnyRecord) => x.left_version_id === version?.id || x.right_version_id === version?.id);
  const visibleIntegrityFlags = selectedFlags.filter((flag: AnyRecord) => ["same_repository", "same_commit", "identical_content"].includes(flag.type) || (flag.type === "code_similarity" && Number(flag.similarity) > 0.7));
  const hasSimilarityLimit = selectedFlags.some((flag: AnyRecord) => flag.type === "code_similarity" && Number(flag.similarity) > 0.7);

  const openFile = async (item: AnyRecord) => {
    if (!item.is_text || item.size > 1024 * 1024) {
      setSelectedPath(item.path);
      setFileContent("This file is binary or exceeds the 1 MB source-view limit.");
      return;
    }
    setSelectedPath(item.path);
    setFileContent("Loading…");
    try {
      setFileContent(await getAssignmentRepositoryFile(id, version.id, item.path));
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFileContent(message || "Unable to open file");
    }
  };

  const save = async (missing: boolean) => {
    setBusy(true);
    try {
      const result = await saveAssignmentGrade(id, selected.student.id, { rubric_scores: missing ? {} : scores, rubric_feedback: missing ? {} : rubricFeedback, expected_revision: grade?.revision, missing });
      toast.success("Grade saved");
      await load(selected.student.id);
      setScores(result.grade.rubric_scores);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to save grade");
    } finally {
      setBusy(false);
    }
  };
  const publishOne = async () => {
    setBusy(true);
    try {
      await publishAssignmentGrade(id, selected.student.id);
      toast.success("Grade published");
      await load(selected.student.id);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Cannot publish grade");
    } finally {
      setBusy(false);
    }
  };
  const startEvaluation = async () => {
    if (!window.confirm("Freeze the latest synchronized commit for this student? This cannot be undone.")) return;
    setBusy(true);
    try {
      await startStudentEvaluation(id, selected.student.id);
      toast.success("Repository frozen for evaluation");
      await load(selected.student.id);
    } catch (error) {
      const message = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(message || "Could not start evaluation");
    } finally {
      setBusy(false);
    }
  };
  const resetRepository = async () => {
    const reason = window.prompt("Why is this repository link being reset?");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await resetStudentRepository(id, selected.student.id, reason.trim());
      toast.success("Repository link reset");
      await load(selected.student.id);
    } catch (error) {
      const message = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(message || "Could not reset repository");
    } finally {
      setBusy(false);
    }
  };

  const total = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);
  const rubricFeedbackComplete = assignment.rubric.every((item: AnyRecord) => rubricFeedback[item.id]?.what_was_done_well?.trim() && rubricFeedback[item.id]?.what_is_missing?.trim());
  const rosterStatus = (row: AnyRecord) => row.grade?.status || row.version?.analysis_status || "missing";
  const rosterStats = (data?.roster || []).reduce(
    (stats: AnyRecord, row: AnyRecord) => {
      stats.assigned += 1;
      if (row.submission) stats.submitted += 1;
      else stats.pending += 1;
      if (row.submission && !row.grade) stats.awaitingGrading += 1;
      return stats;
    },
    { assigned: 0, submitted: 0, pending: 0, awaitingGrading: 0 },
  );
  const visibleRoster = (data?.roster || []).filter((row: AnyRecord) => {
    const matchesQuery = `${row.student.name} ${row.student.roll_no || ""} ${row.student.email || ""}`.toLowerCase().includes(rosterQuery.toLowerCase().trim());
    const matchesFilter =
      rosterFilter === "all" || (rosterFilter === "submitted" && Boolean(row.submission)) || (rosterFilter === "pending" && !row.submission) || (rosterFilter === "awaiting" && Boolean(row.submission) && !row.grade) || (rosterFilter === "graded" && Boolean(row.grade));
    return matchesQuery && matchesFilter;
  });

  return {
    user,
    id,
    router,
    toast,
    queryClient,
    data,
    selectedId,
    setSelectedId,
    tab,
    setTab,
    repo,
    search,
    setSearch,
    selectedPath,
    rosterQuery,
    setRosterQuery,
    rosterFilter,
    setRosterFilter,
    fileContent,
    busy,
    scores,
    setScores,
    rubricFeedback,
    setRubricFeedback,
    load,
    selected,
    assignment,
    evaluation,
    canEvaluate,
    version,
    grade,
    filteredFiles,
    visibleIntegrityFlags,
    hasSimilarityLimit,
    openFile,
    save,
    publishOne,
    startEvaluation,
    resetRepository,
    total,
    rubricFeedbackComplete,
    rosterStatus,
    rosterStats,
    visibleRoster
  };
};

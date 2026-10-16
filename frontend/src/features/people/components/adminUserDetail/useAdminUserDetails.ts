"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookOpenCheck, CheckCircle2, ClipboardList, GraduationCap, Users } from "lucide-react";
import { getAdminUserDetails } from "@/features/people/api";
import type { UserDetails } from "./shared";

export const useAdminUserDetails = () => {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const router = useRouter();
  const [data, setData] = useState<UserDetails | null>(null);
  const [error, setError] = useState("");
  const [studentSubjectFilter, setStudentSubjectFilter] = useState("all");

  useEffect(() => {
    let active = true;
    getAdminUserDetails(userId)
      .then((result) => active && setData(result.user))
      .catch((requestError) => {
        const message = (requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        if (active) setError(message || "Unable to load this account.");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const isTeacher = data?.role === "teacher";
  const backPath = isTeacher ? "/admin/teachers" : "/admin/students";

  const stats = useMemo((): [string, string | number, typeof ClipboardList][] => {
    if (!data) return [];
    if (isTeacher)
      return [
        ["Assignments created", data.assignment_summary?.created || 0, ClipboardList],
        [
          "Submission rate",
          data.assignment_summary?.submission_rate == null
            ? "N/A"
            : `${data.assignment_summary.submission_rate}% (${data.assignment_summary.submissions}/${data.assignment_summary.closed_eligible})`,
          Users,
        ],
        [
          "Missed rate",
          data.assignment_summary?.missed_rate == null
            ? "N/A"
            : `${data.assignment_summary.missed_rate}% (${data.assignment_summary.missed}/${data.assignment_summary.closed_eligible})`,
          GraduationCap,
        ],
        ["Pending evaluations", data.assignment_summary?.pending_evaluations || 0, CheckCircle2],
      ];
    return [
      ["Eligible assignments", data.assignment_summary?.eligible || 0, ClipboardList],
      ["Submitted", data.assignment_summary?.submitted || 0, CheckCircle2],
      ["Missed assignments", data.assignment_summary?.missed || 0, BookOpenCheck],
      ["Average score", data.assignment_summary?.average_score == null ? "—" : `${data.assignment_summary.average_score}%`, GraduationCap],
    ];
  }, [data, isTeacher]);

  const subjectProgress = useMemo(() => {
    if (!data || data.role !== "student") return [];
    const groups = (data.assignment_activity || []).reduce(
      (result: Record<string, { key: string; name: string; total: number; submitted: number; closedEligible: number; closedSubmitted: number; missed: number; scores: number[] }>, item) => {
        if (!item.in_reporting_range) return result;
        const name = item.subject || "Unassigned subject";
        const key = item.subject_id || `legacy:${name}`;
        if (!result[key]) result[key] = { key, name, total: 0, submitted: 0, closedEligible: 0, closedSubmitted: 0, missed: 0, scores: [] };
        const group = result[key];
        group.total += 1;
        if (item.has_valid_submission) group.submitted += 1;
        if (item.deadline_passed) {
          group.closedEligible += 1;
          if (item.has_valid_submission) group.closedSubmitted += 1;
          if (item.status === "missed") group.missed += 1;
        }
        if (item.percentage != null) group.scores.push(Number(item.percentage));
        return result;
      },
      {},
    );
    return Object.values(groups)
      .map((group) => ({
        ...group,
        submissionRate: group.closedEligible ? Math.round((group.closedSubmitted / group.closedEligible) * 10000) / 100 : null,
        missedRate: group.closedEligible ? Math.round((group.missed / group.closedEligible) * 10000) / 100 : null,
        averageScore: group.scores.length ? Math.round((group.scores.reduce((total, score) => total + score, 0) / group.scores.length) * 10) / 10 : null,
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [data]);

  const filteredStudentAssignments = useMemo(() => {
    if (!data || data.role !== "student") return [];
    return (data.assignment_activity || []).filter(
      (item) => studentSubjectFilter === "all" || (item.subject_id || `legacy:${item.subject || "Unassigned subject"}`) === studentSubjectFilter,
    );
  }, [data, studentSubjectFilter]);

  return {
    router,
    data,
    error,
    studentSubjectFilter,
    setStudentSubjectFilter,
    isTeacher,
    backPath,
    stats,
    subjectProgress,
    filteredStudentAssignments
  };
};


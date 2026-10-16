"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Archive, BookOpen, BookOpenCheck, Building2, CheckCircle2, Clock3, FileCode2, GraduationCap, Layers, Users } from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import { getBatches, getCourses, getSections, getSubjects } from "@/features/academics/api";
import { getAdminAssignmentDashboard, getAdminAssignments, getStudentAssignments, getTeacherAssignments } from "@/features/assignments/api";
import { getTeachingScope } from "@/features/auth/api";
import { getAdminUsers } from "@/features/people/api";
import { useToast } from "@/components/Toast";
import { getCachedUser, isAdminRole } from "@/lib/session";
import { ACADEMIC_SESSION_CHANGED_EVENT, getSelectedAcademicSessionId } from "@/lib/academicSession";
import { countValue, type Assignment } from "./shared";

export const useAssignmentDashboard = (initialView = "overview") => {
  const user = useMemo(() => getCachedUser() || ({} as Assignment), []);
  const searchParams = useSearchParams();
  // Captures URL params at mount only — intentional: we want initial filter state from the URL,
  // not to re-seed filters every time searchParams changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialAdminParams = useMemo(() => searchParams, []);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [summary, setSummary] = useState<Assignment | null>(null);
  const [adminOverviewCounts, setAdminOverviewCounts] = useState({ students: 0, teachers: 0, programs: 0, batches: 0, sections: 0, subjects: 0 });
  const [adminDashboard, setAdminDashboard] = useState<Assignment | null>(null);
  const [adminRange, setAdminRange] = useState({ from: "", to: "" });
  const [teacherScope, setTeacherScope] = useState<Assignment>({ students: 0, programs: 0, batches: 0, sections: 0, subjects: 0, allocations: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [teacherFilter, setTeacherFilter] = useState(initialAdminParams.get("teacher_id") || "all");
  const [adminStatusFilter, setAdminStatusFilter] = useState(initialAdminParams.get("status") || "all");
  const [adminProgramFilter, setAdminProgramFilter] = useState(initialAdminParams.get("program_id") || "all");
  const [adminSubjectFilter, setAdminSubjectFilter] = useState(initialAdminParams.get("subject_id") || "all");
  const [adminBatchFilter, setAdminBatchFilter] = useState(initialAdminParams.get("batch_id") || "all");
  const [adminSectionFilter, setAdminSectionFilter] = useState(initialAdminParams.get("section_id") || "all");
  const [adminFromDate, setAdminFromDate] = useState(initialAdminParams.get("from") || "");
  const [adminToDate, setAdminToDate] = useState(initialAdminParams.get("to") || "");
  const [adminPage, setAdminPage] = useState(Number(initialAdminParams.get("page")) || 1);
  const [adminTotalAssignments, setAdminTotalAssignments] = useState(0);
  const [adminFilterOptions, setAdminFilterOptions] = useState<{ programs: Assignment[]; teachers: Assignment[]; subjects: Assignment[]; batches: Assignment[]; sections: Assignment[] }>({ programs: [], teachers: [], subjects: [], batches: [], sections: [] });
  const [query, setQuery] = useState(initialAdminParams.get("q") || "");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const filtersMounted = useRef(false);
  const router = useRouter();
  const navigate = (path: string) => router.push(path);
  const toast = useToast();
  const isAdminAllAssignmentsPage = isAdminRole(user.role) && initialView === "all";
  const isAnalyticsPage = initialView === "analytics" && (isAdminRole(user.role) || user.role === "teacher");
  const isAdminOverviewPage = isAdminRole(user.role) && initialView === "overview";
  const isStudentSubjectsPage = user.role === "student" && initialView === "subjects";

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const result =
        user.role === "teacher"
          ? await getTeacherAssignments()
          : isAdminRole(user.role)
            ? await getAdminAssignments(
                isAdminAllAssignmentsPage
                  ? {
                      page: adminPage,
                      per_page: 25,
                      q: query.trim() || undefined,
                      program_id: adminProgramFilter === "all" ? undefined : adminProgramFilter,
                      teacher_id: teacherFilter === "all" ? undefined : teacherFilter,
                      subject_id: adminSubjectFilter === "all" ? undefined : adminSubjectFilter,
                      batch_id: adminBatchFilter === "all" ? undefined : adminBatchFilter,
                      section_id: adminSectionFilter === "all" ? undefined : adminSectionFilter,
                      status: adminStatusFilter === "all" ? undefined : adminStatusFilter,
                      from: adminFromDate || undefined,
                      to: adminToDate || undefined,
                    }
                  : isAdminOverviewPage
                    ? getSelectedAcademicSessionId()
                      ? { per_page: 500, session_id: getSelectedAcademicSessionId() }
                      : adminRange.from && adminRange.to
                        ? { per_page: 500, from: adminRange.from, to: adminRange.to }
                        : { per_page: 500 }
                    : { per_page: 500 },
              )
            : await getStudentAssignments();
      const rows = result.assignments || [];
      setSummary(user.role === "teacher" ? result.summary || null : null);
      if (isAdminAllAssignmentsPage) setAdminTotalAssignments(result.total || 0);
      setAssignments(user.role === "teacher" ? rows.filter((item: Assignment) => !["completed", "archived"].includes(item.workflow_status)) : rows);
      if (user.role === "teacher") setTeacherScope(await getTeachingScope().catch(() => ({ students: 0, programs: 0, batches: 0, sections: 0, subjects: 0, allocations: 0 })));
      if (isAdminOverviewPage) {
        const [studentsData, teachersData, programsData, batchesData, sectionsData, subjectsData, dashboardData] = await Promise.all([
          getAdminUsers({ role: "student" }).catch(() => ({ users: [] })),
          getAdminUsers({ role: "teacher" }).catch(() => ({ users: [] })),
          getCourses().catch(() => ({ courses: [] })),
          getBatches().catch(() => ({ batches: [] })),
          getSections().catch(() => ({ sections: [] })),
          getSubjects().catch(() => ({ subjects: [] })),
          getAdminAssignmentDashboard(
            getSelectedAcademicSessionId()
              ? { session_id: getSelectedAcademicSessionId() }
              : adminRange.from && adminRange.to
                ? { from: adminRange.from, to: adminRange.to }
                : {},
          ).catch(() => null),
        ]);
        setAdminOverviewCounts({
          students: countValue(studentsData.total ?? (studentsData.users || []).length),
          teachers: countValue(teachersData.total ?? (teachersData.users || []).length),
          programs: (programsData.courses || programsData.items || []).length,
          batches: (batchesData.batches || batchesData.items || []).length,
          sections: (sectionsData.sections || sectionsData.items || []).length,
          subjects: (subjectsData.subjects || subjectsData.items || []).length,
        });
        if (dashboardData) {
          setAdminDashboard(dashboardData);
          setAdminRange(dashboardData.range);
        }
      }
      setLastUpdated(new Date());
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to load assignments");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isAdminAllAssignmentsPage) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdminOverviewPage) return undefined;
    const onSessionChanged = () => load();
    window.addEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    return () => window.removeEventListener(ACADEMIC_SESSION_CHANGED_EVENT, onSessionChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOverviewPage]);

  useEffect(() => {
    if (!isAdminAllAssignmentsPage) return undefined;
    const timer = window.setTimeout(() => load(), query ? 300 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminAllAssignmentsPage, adminPage, adminProgramFilter, teacherFilter, adminSubjectFilter, adminBatchFilter, adminSectionFilter, adminStatusFilter, adminFromDate, adminToDate, query]);

  useEffect(() => {
    if (!isAdminAllAssignmentsPage) return;
    Promise.all([getCourses(), getAdminUsers({ role: "teacher", per_page: 100 }), getSubjects(), getBatches(), getSections()])
      .then(([programs, teachers, subjects, batches, sections]) =>
        setAdminFilterOptions({
          programs: programs.courses || programs.items || [],
          teachers: teachers.users || [],
          subjects: subjects.subjects || subjects.items || [],
          batches: batches.batches || batches.items || [],
          sections: sections.sections || sections.items || [],
        }),
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdminAllAssignmentsPage) return;
    const params = new URLSearchParams();
    (
      [
        ["program_id", adminProgramFilter],
        ["teacher_id", teacherFilter],
        ["subject_id", adminSubjectFilter],
        ["batch_id", adminBatchFilter],
        ["section_id", adminSectionFilter],
        ["status", adminStatusFilter],
        ["from", adminFromDate],
        ["to", adminToDate],
      ] as [string, string][]
    ).forEach(([key, value]) => {
      if (value && value !== "all") params.set(key, value);
    });
    if (query.trim()) params.set("q", query.trim());
    if (adminPage > 1) params.set("page", String(adminPage));
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }, [isAdminAllAssignmentsPage, adminProgramFilter, teacherFilter, adminSubjectFilter, adminBatchFilter, adminSectionFilter, adminStatusFilter, adminFromDate, adminToDate, adminPage, query]);

  useEffect(() => {
    if (!isAdminAllAssignmentsPage) return;
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    setAdminPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminProgramFilter, teacherFilter, adminSubjectFilter, adminBatchFilter, adminSectionFilter, adminStatusFilter, adminFromDate, adminToDate, query]);

  useEffect(() => {
    if (user.role !== "teacher") return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adminAssignmentStats: [string, number, typeof FileCode2][] = [
    ["Total assignments", adminDashboard?.summary?.assignments ?? assignments.length, FileCode2],
    ["Open assignments", adminDashboard?.summary?.open_assignments ?? assignments.filter((item) => ["open", "late_window"].includes(item.phase)).length, Clock3],
    ["Missed assignments by students", adminDashboard?.summary?.missed ?? assignments.reduce((sum, item) => sum + countValue(item.missed_count), 0), AlertTriangle],
  ];
  const universityStats: [string, number, typeof GraduationCap][] = [
    ["Students", adminOverviewCounts.students, GraduationCap],
    ["Teachers", adminOverviewCounts.teachers, Users],
    ["Programs", adminOverviewCounts.programs, BookOpenCheck],
    ["Batches", adminOverviewCounts.batches, Layers],
    ["Sections", adminOverviewCounts.sections, Archive],
    ["Subjects", adminOverviewCounts.subjects, BookOpen],
  ];
  const stats: [string, number, typeof BookOpenCheck][] = [
    ...(user.role === "teacher" && summary
      ? ([
          ["Active assignments", assignments.length, BookOpenCheck],
          ["Assigned students", teacherScope.students, GraduationCap],
          ["Programs", teacherScope.programs, Building2],
          ["Subjects", teacherScope.subjects, BookOpen],
          ["Batches", teacherScope.batches, Layers],
          ["Sections", teacherScope.sections, Archive],
          ["Awaiting review", summary.pending_grade_count, CheckCircle2],
        ] as [string, number, typeof BookOpenCheck][])
      : []),
    ...(user.role === "teacher" && summary
      ? []
      : ([
          ["Total", assignments.length, BookOpenCheck],
          ["Open", assignments.filter((x) => ["open", "late_window"].includes(x.phase)).length, Clock3],
          [
            user.role === "teacher" ? "Submissions" : "Submitted",
            assignments.reduce((sum, x) => sum + (user.role === "teacher" || isAdminRole(user.role) ? Number(x.submission_count || 0) : Number(Boolean(x.submission))), 0),
            GithubIcon,
          ],
          [
            user.role === "teacher" ? "Published grades" : "Results",
            assignments.reduce((sum, x) => sum + (user.role === "teacher" || isAdminRole(user.role) ? Number(x.published_grade_count || x.graded_count || 0) : Number(Boolean(x.grade))), 0),
            CheckCircle2,
          ],
        ] as [string, number, typeof BookOpenCheck][])),
  ];
  const filteredAssignments = assignments.filter((item) => {
    if (user.role === "teacher") {
      const matchesFilter = teacherFilter === "all" || item.workflow_status === teacherFilter || item.phase === teacherFilter;
      const search = `${item.title} ${item.subject || ""}`.toLowerCase();
      return matchesFilter && search.includes(query.toLowerCase().trim());
    }
    if (isAdminAllAssignmentsPage) {
      const status = item.workflow_status || item.phase || item.status || "open";
      const search = `${item.title} ${item.subject || ""} ${item.teacher_name || ""}`.toLowerCase();
    
      return (
        (adminStatusFilter === "all" || status === adminStatusFilter) &&
        (adminProgramFilter === "all" || String(item.target_course_id) === adminProgramFilter) &&
        (teacherFilter === "all" || String(item.created_by) === teacherFilter) &&
        (adminSubjectFilter === "all" || String(item.subject_id) === adminSubjectFilter) &&
        (adminBatchFilter === "all" || String(item.target_batch_id) === adminBatchFilter) &&
        (adminSectionFilter === "all" || String(item.target_section_id) === adminSectionFilter) &&
        (!adminFromDate || String(item.due_at || "").slice(0, 10) >= adminFromDate) &&
        (!adminToDate || String(item.due_at || "").slice(0, 10) <= adminToDate) &&
        search.includes(query.toLowerCase().trim())
      );
    }
    return user.role !== "student" || filter === "all"
      ? true
      : filter === "upcoming"
        ? item.phase === "scheduled"
        : filter === "open"
          ? item.phase === "open" && !item.submission
          : filter === "submitted"
            ? item.submission && !item.grade
            : filter === "results"
              ? Boolean(item.grade)
              : true;
  });
  const adminPageSize = 25;
  const adminTotalPages = Math.max(1, Math.ceil((isAdminAllAssignmentsPage ? adminTotalAssignments : filteredAssignments.length) / adminPageSize));
  const displayedAssignments = isAdminOverviewPage ? filteredAssignments.slice(0, 5) : filteredAssignments;
  const studentSubjects = useMemo(() => {
    const grouped = new Map<string, { name: string; assignments: Assignment[] }>();
    assignments.forEach((assignment) => {
      const name = assignment.subject || "General";
      const current = grouped.get(name) || { name, assignments: [] as Assignment[] };
      current.assignments.push(assignment);
      grouped.set(name, current);
    });
    return [...grouped.values()]
      .map((subject) => ({
        ...subject,
        openCount: subject.assignments.filter((assignment) => assignment.phase === "open" && !assignment.submission).length,
        resultCount: subject.assignments.filter((assignment) => Boolean(assignment.grade)).length,
      }))
      .sort((first, second) => first.name.localeCompare(second.name));
  }, [assignments]);
  const overdueEvaluationAlerts = isAdminRole(user.role) ? assignments.filter((item) => item.evaluation_overdue && Number(item.overdue_ungraded_submission_count || 0) > 0) : [];
  const openItem = (item: Assignment) => (user.role === "teacher" ? navigate(`/assignments/${item.id}/review`) : user.role === "student" ? navigate(`/assignments/${item.id}`) : navigate(`/assignments/admin/${item.id}`));


  return {
    user,
    loading,
    refreshing,
    filter,
    setFilter,
    teacherFilter,
    setTeacherFilter,
    adminStatusFilter,
    setAdminStatusFilter,
    adminProgramFilter,
    setAdminProgramFilter,
    adminSubjectFilter,
    setAdminSubjectFilter,
    adminBatchFilter,
    setAdminBatchFilter,
    adminSectionFilter,
    setAdminSectionFilter,
    adminFromDate,
    setAdminFromDate,
    adminToDate,
    setAdminToDate,
    adminPage,
    setAdminPage,
    adminTotalAssignments,
    adminFilterOptions,
    adminRange,
    setAdminRange,
    query,
    setQuery,
    lastUpdated,
    assignments,
    summary,
    adminDashboard,
    teacherScope,
    isAdminAllAssignmentsPage,
    isAnalyticsPage,
    isAdminOverviewPage,
    isStudentSubjectsPage,
    load,
    navigate,
    toast,
    adminAssignmentStats,
    universityStats,
    stats,
    displayedAssignments,
    studentSubjects,
    overdueEvaluationAlerts,
    openItem,
    adminPageSize,
    adminTotalPages
  };
};

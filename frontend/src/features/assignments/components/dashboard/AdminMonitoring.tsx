"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDateTime } from "@/lib/datetime";
import { setSelectedAcademicSessionId } from "@/lib/academicSession";
import { DateField } from "@/components/ui";
import { insightTooltip, type Assignment } from "./shared";

export const AdminMonitoring = ({
  data,
  allAssignments = [],
  range,
  setRange,
  refresh,
  navigate,
}: {
  data: Assignment | null;
  allAssignments?: Assignment[];
  range: { from: string; to: string };
  setRange: React.Dispatch<React.SetStateAction<{ from: string; to: string }>>;
  refresh: () => void;
  navigate: (path: string) => void;
}) => {
  const computedPrograms = useMemo(() => {
    if (data?.programs && data.programs.length > 0) return data.programs;
    const map = new Map<string, Assignment>();
    (allAssignments || []).forEach((item) => {
      const pId = item.target_course_id || item.program_id || "unassigned";
      const pName = item.program_name || item.course || item.subject || "General Program";
      if (!map.has(pId)) {
        map.set(pId, { program_id: pId, program_name: pName, assignments: 0, closed_eligible: 0, submissions: 0, missed: 0, pending_evaluations: 0, overdue_evaluations: 0 });
      }
      const p = map.get(pId)!;
      p.assignments += 1;
      const eligible = Number(item.eligible_count || 0) || Number(item.submission_count || 0) + Number(item.missed_count || 0);
      p.closed_eligible += eligible;
      p.submissions += Number(item.submission_count || 0);
      p.missed += Number(item.missed_count || item.pending_submission_count || 0);
      p.pending_evaluations += Number(item.pending_grade_count || 0);
      if (item.evaluation_overdue) p.overdue_evaluations += Number(item.overdue_ungraded_submission_count || 1);
    });
    return Array.from(map.values()).map((p) => ({
      ...p,
      submission_rate: p.closed_eligible ? Math.round((p.submissions / p.closed_eligible) * 100) : p.assignments ? Math.round((p.submissions / Math.max(1, p.submissions + p.missed)) * 100) : null,
      missed_rate: p.closed_eligible ? Math.round((p.missed / p.closed_eligible) * 100) : p.assignments ? Math.round((p.missed / Math.max(1, p.submissions + p.missed)) * 100) : null,
    }));
  }, [data?.programs, allAssignments]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const computedTeachers = useMemo(() => {
    if (data?.teachers && data.teachers.length > 0) return data.teachers;
    const map = new Map<string, Assignment>();
    (allAssignments || []).forEach((item) => {
      const tId = item.created_by || item.teacher_id || "unassigned";
      const tName = item.teacher_name || "Faculty Teacher";
      if (!map.has(tId)) {
        map.set(tId, { teacher_id: tId, teacher_name: tName, assignments: 0, closed_eligible: 0, submissions: 0, missed: 0, pending_evaluations: 0, overdue_evaluations: 0 });
      }
      const t = map.get(tId)!;
      t.assignments += 1;
      const eligible = Number(item.eligible_count || 0) || Number(item.submission_count || 0) + Number(item.missed_count || 0);
      t.closed_eligible += eligible;
      t.submissions += Number(item.submission_count || 0);
      t.missed += Number(item.missed_count || item.pending_submission_count || 0);
      t.pending_evaluations += Number(item.pending_grade_count || 0);
      if (item.evaluation_overdue) t.overdue_evaluations += Number(item.overdue_ungraded_submission_count || 1);
    });
    return Array.from(map.values()).map((t) => ({
      ...t,
      submission_rate: t.closed_eligible ? Math.round((t.submissions / t.closed_eligible) * 100) : t.assignments ? Math.round((t.submissions / Math.max(1, t.submissions + t.missed)) * 100) : null,
      missed_rate: t.closed_eligible ? Math.round((t.missed / t.closed_eligible) * 100) : t.assignments ? Math.round((t.missed / Math.max(1, t.submissions + t.missed)) * 100) : null,
    }));
  }, [data?.teachers, allAssignments]);

  const programs = computedPrograms;
  const teachers = computedTeachers;
  // No program filter/selector anymore — the chart always shows every
  // program's assigned/submitted/missed counts at once.
  const programData = programs;

  const exportCsv = () => {
    const rows: (string | number)[][] = [["Type", "Name", "Assignments", "Closed students", "Submissions", "Missed", "Submission rate", "Pending evaluations", "Overdue evaluations"]];
    programData.forEach((item: Assignment) => rows.push(["Program", item.program_name, item.assignments, item.closed_eligible, item.submissions, item.missed, item.submission_rate ?? "N/A", item.pending_evaluations, item.overdue_evaluations]));
    teachers.forEach((item: Assignment) => rows.push(["Teacher", item.teacher_name, item.assignments, item.closed_eligible, item.submissions, item.missed, item.submission_rate ?? "N/A", item.pending_evaluations, item.overdue_evaluations]));
    const blob = new Blob([rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `campusgrade-progress-${range?.from || "all"}-${range?.to || "time"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const chartRows = (items: Assignment[], nameKey: string) => items.map((item) => ({ ...item, name: item[nameKey] }));
  const dateOffset = (days: number) => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  };
  return (
    <div className="mb-7 space-y-6">
      <section className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="From" value={range?.from || ""} onChange={(event) => setRange((value) => ({ ...value, from: event.target.value }))} />
          <DateField label="To" value={range?.to || ""} onChange={(event) => setRange((value) => ({ ...value, to: event.target.value }))} />
          <button
            className="btn btn-primary"
            onClick={() => {
              setSelectedAcademicSessionId("");
              refresh();
            }}
          >
            Apply range
          </button>
          {data?.settings && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setSelectedAcademicSessionId("");
                setRange({ from: data.settings.academic_year_start, to: data.settings.academic_year_end });
              }}
            >
              Academic year
            </button>
          )}
          <button
            className="btn btn-outline"
            onClick={() => {
              setSelectedAcademicSessionId("");
              setRange(dateOffset(30));
            }}
          >
            Last 30 days
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              setSelectedAcademicSessionId("");
              setRange(dateOffset(90));
            }}
          >
            Last 90 days
          </button>
          <button className="btn btn-outline" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </section>
      <section>
        <div className="mb-3">
          <h2 className="text-base font-bold text-slate-900">Pending grading</h2>
          <p className="text-xs text-slate-500">Submitted work without a saved evaluation after its deadline.</p>
        </div>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div className="card p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Pending evaluations</p>
            <p className="mt-1 text-3xl font-black text-amber-700">{data?.summary?.pending_evaluations ?? allAssignments.reduce((sum, i) => sum + Number(i.pending_grade_count || 0), 0)}</p>
          </div>
          <div className={`card p-5 ${data?.summary?.overdue_evaluations ? "border-red-200 bg-red-50" : ""}`}>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Overdue more than 24 hours</p>
            <p className="mt-1 text-3xl font-black text-red-700">{data?.summary?.overdue_evaluations ?? allAssignments.filter((i) => i.evaluation_overdue).length}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.pending_grading?.length ? (
            data.pending_grading.map((item: Assignment) => (
              <button key={item.assignment_id} onClick={() => navigate(`/assignments/admin/${item.assignment_id}`)} className={`card p-4 text-left ${item.overdue_evaluations ? "border-red-200 bg-red-50" : ""}`}>
                <p className="font-bold text-slate-900">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.teacher_name} · Due {formatDateTime(item.due_at)}
                </p>
                <p className="mt-3 text-sm font-semibold text-amber-700">
                  {item.pending_evaluations} pending · {item.overdue_evaluations} overdue 24h
                </p>
                {item.overdue_evaluations > 0 && <p className="mt-1 text-xs font-medium text-red-700">Overdue since {formatDateTime(item.overdue_since)}</p>}
              </button>
            ))
          ) : (
            <div className="card p-5 text-sm text-slate-500">No pending evaluations in this period.</div>
          )}
        </div>
      </section>
      <section className="grid gap-5 xl:grid-cols-2">
        <article className="card min-w-0 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">Program Progress</h2>
              <p className="mt-1 text-xs text-slate-500">How many assignments each program has been given, and closed-cohort submission coverage.</p>
            </div>
          </div>
          <div className="mt-4 h-72">
            {programData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows(programData, "program_name")}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip contentStyle={insightTooltip} />
                  <Bar dataKey="assignments" name="Assignments" fill="#64748b" />
                  <Bar dataKey="submissions" name="Submissions" fill="#0c3c8a" />
                  <Bar dataKey="missed" name="Missed" fill="#e3000f" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">No program progress data available</div>
            )}
          </div>
          <div className="mt-3 grid gap-2">
            {programData.map((item: Assignment) => (
              <button key={item.program_id || item.program_name || "unassigned"} className="text-left text-xs font-semibold text-primary-700 hover:underline" onClick={() => navigate(`/assignments/admin/all?program_id=${item.program_id || ""}`)}>
                {item.program_name}: {item.assignments} assignments · submission {item.submission_rate == null ? "N/A" : `${item.submission_rate}% (${item.submissions}/${item.closed_eligible})`} · missed{" "}
                {item.missed_rate == null ? "N/A" : `${item.missed_rate}% (${item.missed}/${item.closed_eligible})`}
              </button>
            ))}
          </div>
        </article>
        <article className="card min-w-0 p-5">
          <h2 className="font-bold text-slate-900">Teacher Progress</h2>
          <p className="mt-1 text-xs text-slate-500">Assignments, student delivery, missed work, and evaluation workload.</p>
          <div className="mt-4 h-72">
            {teachers.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={chartRows(teachers.slice(0, 12), "teacher_name")} margin={{ left: 20 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={insightTooltip} />
                  <Bar dataKey="assignments" name="Assignments" fill="#64748b" />
                  <Bar dataKey="submissions" name="Submissions" fill="#0c3c8a" />
                  <Bar dataKey="missed" name="Missed" fill="#e3000f" />
                  <Bar dataKey="pending_evaluations" name="Pending evaluations" fill="#d97706" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">No teacher progress data available</div>
            )}
          </div>
          <div className="mt-3 grid gap-2">
            {teachers.map((item: Assignment) => (
              <button key={item.teacher_id || item.teacher_name} className="text-left text-xs font-semibold text-primary-700 hover:underline" onClick={() => navigate(`/assignments/admin/all?teacher_id=${item.teacher_id}`)}>
                {item.teacher_name}: {item.assignments} assignments · submission {item.submission_rate == null ? "N/A" : `${item.submission_rate}% (${item.submissions}/${item.closed_eligible})`} · missed{" "}
                {item.missed_rate == null ? "N/A" : `${item.missed_rate}% (${item.missed}/${item.closed_eligible})`} · {item.pending_evaluations} pending
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
};



"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2 } from "lucide-react";
import { insightTooltip, type Assignment } from "./shared";

const ProgressRing = ({ value, label, detail, color, track }: { value: number; label: string; detail: string; color: string; track: string }) => {
  const normalized = Math.max(0, Math.min(100, Math.round(value || 0)));
  return (
    <div className="flex min-w-0 items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${label}: ${normalized}%`}>
          <circle cx="50" cy="50" r="40" fill="none" stroke={track} strokeWidth="10" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" pathLength={100} strokeDasharray={`${normalized} 100`} className="transition-all duration-700" />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-xl font-extrabold text-slate-950">{normalized}%</span>
      </div>
      <div className="min-w-0">
        <p className="font-bold text-slate-900">{label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
    </div>
  );
};

export const AssignmentInsights = ({ assignments, summary, role }: { assignments: Assignment[]; summary: Assignment | null; role: string }) => {
  const eligibleFromRows = assignments.reduce((total, item) => total + Number(item.eligible_count || 0), 0);
  const submitted = role === "student" ? assignments.filter((item) => item.submission).length : assignments.reduce((total, item) => total + Number(item.submission_count || 0), 0);
  const eligible = role === "student" ? assignments.length : eligibleFromRows || Number(summary?.submission_count || 0) + Number(summary?.pending_submission_count || 0);
  const published = role === "student" ? assignments.filter((item) => item.grade).length : assignments.reduce((total, item) => total + Number(item.published_grade_count || item.graded_count || 0), 0);
  const submissionRate = eligible ? (submitted / eligible) * 100 : 0;
  const feedbackRate = submitted ? (published / submitted) * 100 : 0;
  const performanceData = assignments
    .filter((item) => item.grade && Number(item.total_marks) > 0)
    .sort((first, second) => {
      const firstDate = Date.parse(first.grade?.published_at || first.due_at || "") || 0;
      const secondDate = Date.parse(second.grade?.published_at || second.due_at || "") || 0;
      return firstDate - secondDate;
    })
    .map((item) => ({
      name: item.title,
      percentage: Math.round((Number(item.grade.total_awarded || 0) / Number(item.total_marks)) * 1000) / 10,
      awarded: Number(item.grade.total_awarded || 0),
      maximum: Number(item.total_marks),
    }));

  return (
    <section className="mb-7 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-label="Assignment insights">
      {role === "student" && (
        <article className="card relative min-w-0 overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary-100/70 blur-3xl" />
          <div className="relative">
            <h2 className="text-lg font-bold text-slate-900">Marks progress</h2>
            <p className="mt-1 text-sm text-slate-500">Your published assignment scores, normalized to a percentage.</p>
          </div>
          {performanceData.length > 0 ? (
            <div className="relative mt-5 h-72 w-full" role="img" aria-label={`Assignment marks progress: ${performanceData.map((item) => `${item.name} ${item.percentage}%`).join(", ")}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={performanceData} margin={{ top: 18, right: 14, left: -12, bottom: 4 }}>
                  <defs>
                    <linearGradient id="assignmentMarksFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.42} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickFormatter={(value) => (value.length > 12 ? `${value.slice(0, 12)}…` : value)} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      const item = payload?.[0]?.payload;
                      return active && item ? (
                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-xl">
                          <p className="text-xs font-semibold text-slate-600">{item.name}</p>
                          <p className="mt-1 font-bold text-slate-950">
                            {item.awarded}/{item.maximum} marks · {item.percentage}%
                          </p>
                        </div>
                      ) : null;
                    }}
                  />
                  <Area type="monotone" dataKey="percentage" name="Score" stroke="#2563eb" strokeWidth={3} fill="url(#assignmentMarksFill)" dot={{ r: 4, fill: "#fff", stroke: "#2563eb", strokeWidth: 3 }} activeDot={{ r: 6 }} animationDuration={800} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="relative mt-5 grid h-72 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
              <div>
                <CheckCircle2 className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 font-semibold text-slate-700">No published marks yet</p>
                <p className="mt-1 text-sm text-slate-500">Your progress graph will appear after an assignment result is published.</p>
              </div>
            </div>
          )}
        </article>
      )}

      <article className="card relative min-w-0 overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-primary-100/60 blur-3xl" />
        <div className="relative">
          <h2 className="text-lg font-bold text-slate-900">Completion pulse</h2>
          <p className="mt-1 text-sm text-slate-500">Submission coverage and the progress from submitted work to released feedback.</p>
        </div>
        <div className="relative mt-7 grid gap-7 md:grid-cols-2">
          <ProgressRing value={submissionRate} label={role === "student" ? "Submission progress" : "Submission coverage"} detail={`${submitted} of ${eligible} expected submission${eligible === 1 ? "" : "s"}`} color="#0c3c8a" track="#e3ebf6" />
          <ProgressRing value={feedbackRate} label={role === "student" ? "Results released" : "Published feedback"} detail={`${published} of ${submitted} submission${submitted === 1 ? "" : "s"} with published feedback`} color="#e3000f" track="#fae6e7" />
        </div>
        <div className="relative mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-bold text-slate-800">Assignment journey</span>
            <span className="font-extrabold text-primary-700">
              {published}/{eligible}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-secondary-600 transition-all duration-700" style={{ width: `${Math.min(100, submissionRate)}%` }}>
              <div className="h-full bg-primary-600 transition-all duration-700" style={{ width: `${Math.min(100, feedbackRate)}%` }} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-secondary-600" />
              Submitted {submitted}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />
              Feedback published {published}
            </span>
            <span>Still expected {Math.max(0, eligible - submitted)}</span>
          </div>
        </div>
      </article>
    </section>
  );
};

const ScopeChart = ({ title, description, data, color }: { title: string; description: string; data: { name: string; value: number }[]; color: string }) => (
  <article className="card min-w-0 p-5">
    <h2 className="text-base font-bold text-slate-900">{title}</h2>
    <p className="mt-1 text-xs text-slate-500">{description}</p>
    <div className="mt-4 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -18, right: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={insightTooltip} />
          <Bar dataKey="value" fill={color} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </article>
);

export const TeacherScopeCharts = ({ scope, summary }: { scope: Assignment; summary: Assignment | null }) => {
  const scopeData = [
    { name: "Students", value: scope.students || 0 },
    { name: "Programs", value: scope.programs || 0 },
    { name: "Subjects", value: scope.subjects || 0 },
    { name: "Batches", value: scope.batches || 0 },
    { name: "Sections", value: scope.sections || 0 },
  ];
  const activityData = [
    { name: "Assignments", value: summary?.total || 0 },
    { name: "Submitted", value: summary?.submission_count || 0 },
    { name: "Awaiting review", value: summary?.pending_grade_count || 0 },
    { name: "Missing", value: summary?.pending_submission_count || 0 },
  ];
  return (
    <section className="mb-7 grid gap-5 xl:grid-cols-2" aria-label="Teaching overview charts">
      <ScopeChart title="Teaching scope" description="Students and academic areas assigned by administration." data={scopeData} color="#0c3c8a" />
      <ScopeChart title="Teaching activity" description="Current assignment and submission workload." data={activityData} color="#e3000f" />
    </section>
  );
};


"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { insightColors, insightTooltip, type Assignment } from "./shared";
import { parseServerDateTime } from "@/lib/datetime";

const ChartCard = ({ title, description, data, children }: { title: string; description: string; data: unknown[]; children: React.ReactNode }) => (
  <article className="card min-w-0 p-5">
    <h2 className="text-base font-bold text-slate-900">{title}</h2>
    <p className="mt-1 text-xs text-slate-500">{description}</p>
    {data.length ? <div className="mt-4 h-72">{children}</div> : <div className="mt-4 grid h-72 place-items-center rounded-xl bg-slate-50 text-sm text-slate-500">No data available</div>}
  </article>
);

export const AssignmentAnalytics = ({ assignments }: { assignments: Assignment[] }) => {
  const label = (value: unknown) =>
    String(value || "Unknown")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const shortLabel = (value: string) => (String(value || "").length > 14 ? `${String(value).slice(0, 14)}…` : value);
  const grouped = (keyFor: (item: Assignment) => string) =>
    Object.values(
      assignments.reduce((result: Record<string, { name: string; value: number }>, item) => {
        const key = keyFor(item) || "Unknown";
        result[key] = result[key] || { name: label(key), value: 0 };
        result[key].value += 1;
        return result;
      }, {}),
    ).sort((a, b) => b.value - a.value);
  const statusData = grouped((item) => item.workflow_status || item.phase || item.status || "open");
  const subjectData = grouped((item) => item.subject || "Unassigned").slice(0, 10);
  const submissionData = assignments
    .map((item) => ({ name: item.title, submitted: Number(item.submission_count || 0), pending: Number(item.pending_submission_count || 0) }))
    .sort((a, b) => b.submitted - a.submitted)
    .slice(0, 10);
  const gradingData = assignments
    .map((item) => ({ name: item.title, published: Number(item.published_grade_count || item.graded_count || 0), waiting: Number(item.pending_grade_count || 0) }))
    .sort((a, b) => b.published + b.waiting - (a.published + a.waiting))
    .slice(0, 10);
  const teacherData = Object.values(
    assignments.reduce((result: Record<string, { name: string; assignments: number; submissions: number }>, item) => {
      const name = item.teacher_name || "Unassigned";
      result[name] = result[name] || { name, assignments: 0, submissions: 0 };
      result[name].assignments += 1;
      result[name].submissions += Number(item.submission_count || 0);
      return result;
    }, {}),
  )
    .sort((a, b) => b.assignments - a.assignments)
    .slice(0, 10);
  const deadlineData = Object.values(
    assignments.reduce((result: Record<string, { name: string; value: number; timestamp: number }>, item) => {
      const date = parseServerDateTime(item.due_at);
      if (!date) return result;
      const month = date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      result[month] = result[month] || { name: month, value: 0, timestamp: new Date(date.getFullYear(), date.getMonth(), 1).getTime() };
      result[month].value += 1;
      return result;
    }, {}),
  ).sort((a, b) => a.timestamp - b.timestamp);
  const submitted = assignments.reduce((total, item) => total + Number(item.submission_count || 0), 0);
  const expected = assignments.reduce((total, item) => total + Number(item.eligible_count || 0), 0);
  const published = assignments.reduce((total, item) => total + Number(item.published_grade_count || item.graded_count || 0), 0);
  const waiting = assignments.reduce((total, item) => total + Number(item.pending_grade_count || 0), 0);
  const metrics: [string, string | number][] = [
    ["Assignments", assignments.length],
    ["Submission rate", `${expected ? Math.round((submitted / expected) * 100) : 0}%`],
    ["Feedback published", published],
    ["Awaiting grading", waiting],
  ];
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Analytics summary">
        {metrics.map(([name, value]) => (
          <article key={name} className="card p-4">
            <p className="text-xs font-semibold text-slate-500">{name}</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
          </article>
        ))}
      </section>
      <section className="grid gap-5 xl:grid-cols-2" aria-label="Assignment charts">
        <ChartCard title="Status distribution" description="Assignments by workflow status." data={statusData}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={3} stroke="none">
                {statusData.map((item, index) => (
                  <Cell key={item.name} fill={insightColors[index % insightColors.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={insightTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Submission coverage" description="Submitted and missing work by assignment." data={submissionData}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={submissionData} margin={{ left: -18, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickFormatter={shortLabel} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={insightTooltip} />
              <Bar dataKey="submitted" stackId="coverage" fill="#0c3c8a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pending" stackId="coverage" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Grading progress" description="Published feedback compared with work awaiting grading." data={gradingData}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={gradingData} margin={{ left: -18, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickFormatter={shortLabel} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={insightTooltip} />
              <Bar dataKey="published" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="waiting" fill="#e3000f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Teacher workload" description="Assignment ownership and received submissions." data={teacherData}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={teacherData} layout="vertical" margin={{ left: 18, right: 8 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={90} tickFormatter={shortLabel} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={insightTooltip} />
              <Bar dataKey="assignments" fill="#0c3c8a" radius={[0, 4, 4, 0]} />
              <Bar dataKey="submissions" fill="#1a70c0" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Deadline trend" description="Number of assignments due each month." data={deadlineData}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={deadlineData} margin={{ left: -18, right: 8 }}>
              <defs>
                <linearGradient id="deadlineFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e3000f" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#e3000f" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={insightTooltip} />
              <Area type="monotone" dataKey="value" name="Assignments" stroke="#e3000f" strokeWidth={3} fill="url(#deadlineFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Subject distribution" description="Assignments across the most active subjects." data={subjectData}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={subjectData} margin={{ left: -18, right: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="name" tickFormatter={shortLabel} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={insightTooltip} />
              <Bar dataKey="value" name="Assignments" fill="#d97706" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </section>
    </div>
  );
};

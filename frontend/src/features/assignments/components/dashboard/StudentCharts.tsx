"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { insightTooltip, type Assignment } from "./shared";
import { scoreOf, type StudentGroups } from "./studentGroups";

export const SEGMENTS = [
  { key: "todo", label: "To do", color: "#e3000f" },
  { key: "upcoming", label: "Upcoming", color: "#0c3c8a" },
  { key: "submitted", label: "Awaiting result", color: "#d97706" },
  { key: "results", label: "Results", color: "#16a34a" },
  { key: "missed", label: "Missed", color: "#64748b" },
] as const;

const BODY = "h-52 p-4";

const ChartCard = ({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) => (
  <section className="card flex h-full flex-col overflow-hidden" aria-label={title}>
    <header className="border-b border-slate-100 px-4 py-3">
      <h2 className="text-sm font-bold text-slate-950">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
    </header>
    <div className={`${BODY} min-h-0 flex-1`}>{children}</div>
  </section>
);

/** Share of assignments that are finished from the student's side: submitted or already graded. */
export const completionPercent = (groups: StudentGroups) => {
  const total = groups.todo.length + groups.upcoming.length + groups.submitted.length + groups.results.length + groups.missed.length;
  return total ? Math.round(((groups.submitted.length + groups.results.length) / total) * 100) : 0;
};

export const StatusDonut = ({ groups }: { groups: StudentGroups }) => {
  const data = SEGMENTS.map((segment) => ({ ...segment, value: groups[segment.key].length }));
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const percent = completionPercent(groups);
  return (
    <ChartCard title="Progress overview" hint="Where all your assignments stand">
      <div className="flex h-full items-center gap-4">
        <div className="relative h-full aspect-square shrink-0" role="img" aria-label={`${percent}% of assignments submitted or graded. ${data.map((item) => `${item.label} ${item.value}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={total ? data : [{ key: "none", label: "None", color: "#e2e8f0", value: 1 }]} dataKey="value" innerRadius="68%" outerRadius="100%" paddingAngle={total ? 2 : 0} stroke="none" isAnimationActive={false}>
                {(total ? data : [{ color: "#e2e8f0" }]).map((item, index) => (
                  <Cell key={index} fill={item.color} />
                ))}
              </Pie>
              {total > 0 && <Tooltip contentStyle={insightTooltip} formatter={(value, name) => [value, name]} />}
            </PieChart>
          </ResponsiveContainer>
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <span>
              <span className="block text-xl font-extrabold text-slate-950">{percent}%</span>
              <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">done</span>
            </span>
          </span>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
          {data.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden="true" />
                {item.label}
              </span>
              <span className="font-bold text-slate-900">{item.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
};

export const MarksChart = ({ results }: { results: Assignment[] }) => {
  // Oldest to newest, so the chart reads left to right in time.
  const data = [...results]
    .slice(0, 6)
    .reverse()
    .map((item) => {
      const score = scoreOf(item);
      return { name: String(item.title), short: String(item.title).length > 10 ? `${String(item.title).slice(0, 9)}…` : String(item.title), percent: Math.round(score.percent), awarded: score.awarded, total: score.total };
    });
  return (
    <ChartCard title="Marks" hint="Published results as a percentage of the maximum">
      {data.length === 0 ? (
        <p className="grid h-full place-items-center text-center text-sm text-slate-500">Your marks will be charted here once results are published.</p>
      ) : (
        <div className="h-full w-full" role="img" aria-label={`Marks: ${data.map((item) => `${item.name} ${item.percent}%`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="short" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} interval={0} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip
                contentStyle={insightTooltip}
                cursor={{ fill: "rgba(148,163,184,0.12)" }}
                formatter={(_value, _name, item) => [`${item.payload.awarded}/${item.payload.total} (${item.payload.percent}%)`, "Marks"]}
                labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.name ?? "")}
              />
              <Bar dataKey="percent" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false}>
                {data.map((item) => (
                  <Cell key={item.name} fill={item.percent >= 75 ? "#16a34a" : item.percent >= 40 ? "#d97706" : "#e3000f"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
};

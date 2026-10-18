"use client";

import { ArrowRight, Award, CalendarClock, CheckCircle2, ClipboardList, Hourglass } from "lucide-react";
import { EmptyState, LoadingState, StatTile } from "@/components/ui";
import { formatDateTime } from "@/lib/datetime";
import { MarksChart, StatusDonut } from "./StudentCharts";
import { dueLabel, groupStudentAssignments, scoreOf } from "./studentGroups";
import type { Assignment } from "./shared";

const TONE: Record<string, string> = {
  overdue: "bg-rose-100 text-rose-700",
  soon: "bg-amber-100 text-amber-800",
  normal: "bg-slate-100 text-slate-600",
};

const Section = ({ title, count, hint, empty, children }: { title: string; count: number; hint?: string; empty?: string; children: React.ReactNode }) => (
  <section className="card flex h-full flex-col overflow-hidden" aria-label={title}>
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-slate-950">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">{count}</span>
    </header>
    {count === 0 ? <p className="px-4 py-5 text-sm text-slate-500">{empty ?? "Nothing here."}</p> : <ul className="flex-1 divide-y divide-slate-100">{children}</ul>}
  </section>
);

const Row = ({ item, onOpen, meta, end }: { item: Assignment; onOpen: (item: Assignment) => void; meta: React.ReactNode; end: React.ReactNode }) => (
  <li>
    <button type="button" onClick={() => onOpen(item)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">{item.title}</span>
        <span className="mt-0.5 block text-xs text-slate-500 [overflow-wrap:anywhere]">{meta}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">{end}</span>
    </button>
  </li>
);

const subjectLine = (item: Assignment) => [item.subject, item.total_marks ? `${item.total_marks} marks` : ""].filter(Boolean).join(" · ");

export const StudentHome = ({ user, loading, assignments, openItem, navigate }: { user: Assignment; loading: boolean; assignments: Assignment[]; openItem: (item: Assignment) => void; navigate: (path: string) => void }) => {
  if (loading) return <LoadingState label="Loading your assignments…" />;
  const groups = groupStudentAssignments(assignments);
  const visible = groups.todo.length + groups.upcoming.length + groups.submitted.length + groups.results.length + groups.missed.length;
  if (visible === 0) {
    return <EmptyState title="No assignments yet" description="When your teachers publish assignments for your subjects, they will appear here." action={<button className="btn btn-outline" onClick={() => navigate("/assignments/subjects")}>Browse subjects</button>} />;
  }
  const next = groups.todo[0];
  const firstName = String(user.name || "").trim().split(/\s+/)[0] || "there";
  const nextDue = next ? dueLabel(next.due_at) : null;

  return (
    <div className="space-y-5">
      <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Summary">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-950">Hi {firstName}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {groups.todo.length === 0
              ? "You are all caught up. Nothing is waiting for a submission."
              : `${groups.todo.length} ${groups.todo.length === 1 ? "assignment needs" : "assignments need"} your submission. Next up: ${next.title}${nextDue ? ` (${nextDue.text.toLowerCase()})` : ""}.`}
          </p>
        </div>
        {next && (
          <button type="button" className="btn btn-primary shrink-0" onClick={() => openItem(next)}>
            Open next
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="To do" value={groups.todo.length} icon={ClipboardList} />
        <StatTile label="Upcoming" value={groups.upcoming.length} icon={CalendarClock} />
        <StatTile label="Awaiting result" value={groups.submitted.length} icon={Hourglass} />
        <StatTile label="Results" value={groups.results.length} icon={Award} />
      </div>

      <div className="grid items-stretch gap-5 lg:grid-cols-2">
        <StatusDonut groups={groups} />
        <MarksChart results={groups.results} />

        <Section title="To do" count={groups.todo.length} hint="Open for submission, earliest deadline first" empty="Nothing to submit right now.">
          {groups.todo.map((item) => {
            const due = dueLabel(item.due_at);
            return <Row key={item.id} item={item} onOpen={openItem} meta={subjectLine(item)} end={<span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[due.tone]}`}>{due.text}</span>} />;
          })}
        </Section>
        <Section title="Recent results" count={groups.results.length} hint="Published by your teachers" empty="No results published yet.">
          {groups.results.slice(0, 5).map((item) => {
            const score = scoreOf(item);
            return (
              <Row
                key={item.id}
                item={item}
                onOpen={openItem}
                meta={subjectLine(item)}
                end={
                  <span className="flex items-center gap-2">
                    <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden="true">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${score.percent}%` }} />
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {score.awarded}/{score.total}
                    </span>
                  </span>
                }
              />
            );
          })}
        </Section>

        <Section title="Upcoming" count={groups.upcoming.length} hint="Scheduled, not open yet" empty="No assignments are scheduled.">
          {groups.upcoming.map((item) => (
            <Row key={item.id} item={item} onOpen={openItem} meta={subjectLine(item)} end={<span className="text-xs font-semibold text-slate-500">Opens {formatDateTime(item.opens_at || item.due_at, { day: "2-digit", month: "short" })}</span>} />
          ))}
        </Section>
        <Section title="Awaiting result" count={groups.submitted.length} hint="Submitted, being graded" empty="Nothing is waiting for marks.">
          {groups.submitted.map((item) => (
            <Row key={item.id} item={item} onOpen={openItem} meta={subjectLine(item)} end={<CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Submitted" />} />
          ))}
        </Section>

        {groups.missed.length > 0 && (
          <div className="lg:col-span-2">
            <Section title="Missed" count={groups.missed.length} hint="Closed without a submission">
              {groups.missed.slice(0, 5).map((item) => (
                <Row key={item.id} item={item} onOpen={openItem} meta={subjectLine(item)} end={<span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE.overdue}`}>Closed</span>} />
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
};

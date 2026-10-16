"use client";

import { BookOpen } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { phaseBadge, type Assignment } from "./shared";

interface SubjectGroup {
  name: string;
  assignments: Assignment[];
  openCount: number;
  resultCount: number;
}

export const StudentSubjectsPanel = ({
  loading,
  subjects,
  openItem,
}: {
  loading: boolean;
  subjects: SubjectGroup[];
  openItem: (assignment: Assignment) => void;
}) => {
  return loading ? (
          <div className="card p-10 text-center text-slate-500">Loading subjects…</div>
        ) : subjects.length === 0 ? (
          <div className="card p-12 text-center">
            <BookOpen className="mx-auto h-12 w-12 text-slate-300" />
            <h2 className="mt-4 text-lg font-bold">No subjects available yet</h2>
            <p className="mt-1 text-sm text-slate-500">Subjects will appear when assignments are published for you.</p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {subjects.map((subject) => (
              <section key={subject.name} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-xl bg-primary-50 p-2.5 text-primary-700">
                      <BookOpen className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-bold text-slate-950">{subject.name}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {subject.assignments.length} assignment{subject.assignments.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  {subject.openCount > 0 && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">{subject.openCount} open</span>}
                </div>
                <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
                  {subject.assignments.map((assignment) => (
                    <button key={assignment.id} type="button" onClick={() => openItem(assignment)} className="flex w-full items-center justify-between gap-3 py-3 text-left transition hover:text-primary-700">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-800">{assignment.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">Due {formatDateTime(assignment.due_at)}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${phaseBadge[assignment.phase] || phaseBadge.open}`}>{String(assignment.phase || assignment.status || "open").replaceAll("_", " ")}</span>
                    </button>
                  ))}
                </div>
                {subject.resultCount > 0 && (
                  <p className="mt-4 text-xs font-semibold text-primary-700">
                    {subject.resultCount} result{subject.resultCount === 1 ? "" : "s"} published
                  </p>
                )}
              </section>
            ))}
          </div>
        );
};

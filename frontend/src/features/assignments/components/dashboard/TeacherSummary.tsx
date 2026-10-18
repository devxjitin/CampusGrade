"use client";

import { ArrowRight } from "lucide-react";
import type { Assignment } from "./shared";

/** One-line plain-language summary at the top of the teacher Home, mirroring the student greeting. */
export const TeacherSummary = ({ user, summary, onReview }: { user: Assignment; summary: Assignment | null; onReview: () => void }) => {
  // Keep an honorific with the name ("Dr. Neha"), so the greeting is never just "Hi Dr.".
  const [first = "", second = ""] = String(user.name || "").trim().split(/\s+/);
  const firstName = /^(dr|prof|mr|mrs|ms)\.?$/i.test(first) && second ? `${first} ${second}` : first || "there";
  const total = Number(summary?.total || 0);
  const awaiting = Number(summary?.pending_grade_count || 0);
  const missing = Number(summary?.pending_submission_count || 0);
  const message =
    total === 0
      ? "You have not created an assignment yet."
      : awaiting === 0
        ? `All caught up: no submissions are waiting for marks.${missing ? ` ${missing} submission${missing === 1 ? " is" : "s are"} still expected.` : ""}`
        : `${awaiting} submission${awaiting === 1 ? " is" : "s are"} waiting for marks.${missing ? ` ${missing} still expected from students.` : ""}`;
  return (
    <section className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Summary">
      <div className="min-w-0">
        <h2 className="text-base font-bold text-slate-950">Hi {firstName}</h2>
        <p className="mt-0.5 text-sm text-slate-600">{message}</p>
      </div>
      {awaiting > 0 && (
        <button type="button" className="btn btn-primary shrink-0" onClick={onReview}>
          Review submissions
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </section>
  );
};

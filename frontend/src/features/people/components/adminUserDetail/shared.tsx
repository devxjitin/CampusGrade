import { formatDateTime } from "@/lib/datetime";

export interface AssignmentActivityItem {
  assignment_id: string;
  title: string;
  subject?: string;
  subject_id?: string;
  due_at?: string;
  status: string;
  percentage?: number | null;
  marks_obtained?: number;
  total_marks?: number;
  grade_status?: string;
  in_reporting_range?: boolean;
  has_valid_submission?: boolean;
  deadline_passed?: boolean;
}

export interface UserDetails {
  name: string;
  email: string;
  role: string;
  avatar?: string;
  is_active?: boolean;
  teacher_id?: string;
  roll_no?: string;
  last_login?: string;
  contact_number?: string;
  github_username?: string;
  leetcode_username?: string;
  created_at?: string;
  designation?: string;
  bio?: string;
  course?: string;
  batch?: string;
  section?: string;
  year?: string | number;
  reporting_range?: { from?: string; to?: string };
  assignment_summary?: {
    created?: number;
    submission_rate?: number | null;
    submissions?: number;
    closed_eligible?: number;
    missed_rate?: number | null;
    missed?: number;
    pending_evaluations?: number;
    eligible?: number;
    submitted?: number;
    average_score?: number | null;
    at_risk?: boolean;
    missed_rate_threshold_percent?: number;
    overdue_evaluations?: number;
  };
  evaluation_overdue?: boolean;
  teaching_assignments?: { program?: string; course?: string; batch?: string; section?: string }[];
  subject_progress?: {
    subject_id?: string;
    subject?: string;
    assignments?: number;
    submission_rate?: number | null;
    submissions?: number;
    closed_eligible?: number;
    missed_rate?: number | null;
    missed?: number;
    pending_evaluations?: number;
    overdue_evaluations?: number;
  }[];
  owned_assignments?: { id: string; title: string; due_at?: string }[];
  assignment_activity?: AssignmentActivityItem[];
}

export const formatDate = (value?: string) => (value ? formatDateTime(value) : "Not available");
export const valueOrDash = (value: unknown) => (value as string) || "—";

export const DetailItem = ({ label, value }: { label: string; value: unknown }) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3">
    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-slate-800">{valueOrDash(value)}</p>
  </div>
);



"use client";

import { Bell, Mail, Laptop, LockKeyhole, Trash2 } from "lucide-react";
import { isAdminRole } from "@/lib/session";
import { formatDateTime } from "@/lib/datetime";

interface SessionRow {
  id: string;
  current?: boolean;
  device_info?: string;
  ip_address?: string;
  last_seen_at?: string;
  created_at?: string;
}

const rolePreferences: Record<string, Array<[string, string, string]>> = {
  student: [["assignment_updates", "Assignment updates", "New assignments, changed deadlines, and announcements."], ["grade_updates", "Grade updates", "Published grades and feedback."]],
  teacher: [["submission_updates", "Submission updates", "Student submissions and repository sync changes."], ["grading_reminders", "Grading reminders", "Pending and overdue grading alerts."]],
  admin: [["system_updates", "System updates", "Administrative and platform activity."], ["grading_reminders", "Grading reminders", "University-wide grading alerts."]],
};

const emailPreferences: Array<[string, string, string]> = [
  ["email_assignment_grades", "Results published", "An email when a grade for one of your assignments is published."],
  ["email_assignment_deadlines", "Deadline reminders", "An email 24 hours before an assignment is due, if you have not submitted."],
  ["email_discussions", "Discussion replies", "An email when someone replies in one of your assignment discussions."],
];

export const EmailNotificationSettingsSection = ({ loading, preferences, savePreference }: { loading: boolean; preferences: Record<string, boolean>; savePreference: (key: string, enabled: boolean) => void }) => (
  <section className="card p-6" aria-labelledby="email-notifications-heading">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-sky-50 p-2.5 text-sky-600"><Mail className="h-5 w-5" /></span><div><h2 id="email-notifications-heading" className="text-lg font-bold text-slate-900">Email notifications</h2><p className="mt-1 text-sm text-slate-500">Choose which updates are also sent to your email address.</p></div></div>
    <div className="mt-5 divide-y divide-slate-100">{emailPreferences.map(([key, title, description]) => <label key={key} className="flex cursor-pointer items-center justify-between gap-4 py-3"><span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span><input aria-label={`Email: ${title}`} type="checkbox" disabled={loading} checked={preferences[key] !== false} onChange={(event) => savePreference(key, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /></label>)}</div>
    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Security emails are always sent.</p>
  </section>
);

export const NotificationSettingsSection = ({ role, loading, preferences, savePreference }: { role: string; loading: boolean; preferences: Record<string, boolean>; savePreference: (key: string, enabled: boolean) => void }) => (
  <section className="card p-6" aria-labelledby="notifications-heading">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-violet-50 p-2.5 text-violet-600"><Bell className="h-5 w-5" /></span><div><h2 id="notifications-heading" className="text-lg font-bold text-slate-900">In-app notifications</h2><p className="mt-1 text-sm text-slate-500">Choose the academic updates that appear in your notification centre.</p></div></div>
    <div className="mt-5 divide-y divide-slate-100">{(rolePreferences[isAdminRole(role) ? "admin" : role] || rolePreferences.student).map(([key, title, description]) => <label key={key} className="flex cursor-pointer items-center justify-between gap-4 py-3"><span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span><input aria-label={title} type="checkbox" disabled={loading} checked={preferences[key] !== false} onChange={(event) => savePreference(key, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /></label>)}</div>
    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Security alerts remain enabled for every account.</p>
  </section>
);

export const SessionsSettingsSection = ({ loading, sessions, revokeOthers, revoke }: { loading: boolean; sessions: SessionRow[]; revokeOthers: () => void; revoke: (session: SessionRow) => void }) => (
  <section className="card p-6" aria-labelledby="sessions-heading">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="rounded-xl bg-slate-100 p-2.5 text-slate-700"><Laptop className="h-5 w-5" /></span><div><h2 id="sessions-heading" className="text-lg font-bold text-slate-900">Active sessions</h2><p className="mt-1 text-sm text-slate-500">Review signed-in devices and revoke access you no longer recognise.</p></div></div><button type="button" className="btn btn-outline text-sm" onClick={revokeOthers} disabled={loading || sessions.every((item) => item.current)}>Sign out other devices</button></div>
    <div className="mt-5 divide-y divide-slate-100">{loading ? <p className="py-5 text-sm text-slate-500">Loading active sessions…</p> : sessions.length === 0 ? <p className="py-5 text-sm text-slate-500">No active device sessions were found.</p> : sessions.map((session) => <div key={session.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-slate-900">{session.current ? "This device" : session.device_info}</p><p className="mt-1 text-xs text-slate-500">{session.ip_address || "IP unavailable"} · Last active {formatDateTime(session.last_seen_at || session.created_at)}</p></div><button type="button" onClick={() => revoke(session)} className="btn btn-outline text-sm text-rose-700 hover:border-rose-200 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{session.current ? "Sign out" : "Revoke"}</button></div>)}</div>
  </section>
);

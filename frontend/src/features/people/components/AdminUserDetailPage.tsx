"use client";

// Ported from frontend-legacy/src/pages/AdminUserDetails.jsx (route: /admin/users/:userId)
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { DetailItem, formatDate, valueOrDash } from "./adminUserDetail/shared";
import { useAdminUserDetails } from "./adminUserDetail/useAdminUserDetails";

export default function AdminUserDetailsPage() {
  const {
    router,
    data,
    error,
    studentSubjectFilter,
    setStudentSubjectFilter,
    isTeacher,
    backPath,
    stats,
    subjectProgress,
    filteredStudentAssignments
  } = useAdminUserDetails();

  return (
    <>
      <PageHeader
        eyebrow="User directory"
        title={data ? data.name : "Account details"}
        description={
          data
            ? `Progress metrics cover ${data.reporting_range?.from || "the configured academic year"} to ${data.reporting_range?.to || "present"}; assignment records remain complete.`
            : "Loading account information."
        }
        actions={
          <button className="btn btn-outline" onClick={() => router.push(backPath)}>
            <ArrowLeft className="h-4 w-4" />
            Back to {isTeacher ? "teachers" : "students"}
          </button>
        }
      />
      {error ? (
        <div className="card p-8 text-center">
          <p className="font-bold text-red-700">{error}</p>
          <Link className="mt-4 inline-flex text-sm font-bold text-primary-700 hover:underline" href="/admin/students">
            Return to user directory
          </Link>
        </div>
      ) : !data ? (
        <div className="card p-10 text-center text-slate-500">Loading account details…</div>
      ) : (
        <div className={`space-y-6 rounded-2xl ${(!isTeacher && data.assignment_summary?.at_risk) || (isTeacher && data.evaluation_overdue) ? "bg-red-50/70 p-3" : ""}`}>
          {((!isTeacher && data.assignment_summary?.at_risk) || (isTeacher && data.evaluation_overdue)) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {isTeacher
                ? `${data.assignment_summary?.overdue_evaluations} evaluation(s) remain pending more than 24 hours after deadline.`
                : `Missed rate ${data.assignment_summary?.missed_rate}% exceeds the ${data.assignment_summary?.missed_rate_threshold_percent}% institution threshold.`}
            </div>
          )}
          <section className="card overflow-hidden">
            <div className="flex flex-col gap-5 bg-gradient-to-r from-primary-50 via-white to-red-50 px-5 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary-100 text-xl font-black text-primary-700">
                  {data.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    data.name?.charAt(0)?.toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-black text-slate-950">{data.name}</h2>
                  <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                    <Mail className="h-4 w-4" />
                    {data.email}
                  </p>
                </div>
              </div>
              <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${data.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {data.is_active ? "Active account" : "Inactive account"}
              </span>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem label="Role" value={data.role} />
              <DetailItem label={isTeacher ? "Teacher ID" : "Roll number"} value={isTeacher ? data.teacher_id : data.roll_no} />
              <DetailItem label="Account email" value={data.email} />
              <DetailItem label="Last sign-in" value={formatDate(data.last_login)} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold text-slate-900">Assignment activity</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stats.map(([label, value, Icon]) => (
                <div key={label} className="card p-5">
                  <Icon className="mb-3 h-5 w-5 text-primary-600" />
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="card p-5">
              <h2 className="mb-4 text-base font-bold text-slate-900">Personal and contact information</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Email" value={data.email} />
                <DetailItem label="Contact number" value={data.contact_number} />
                <DetailItem label="GitHub username" value={data.github_username} />
                <DetailItem label="LeetCode" value={data.leetcode_username} />
                <DetailItem label="Account created" value={formatDate(data.created_at)} />
                <DetailItem label="Designation" value={data.designation} />
                <DetailItem label="Bio" value={data.bio} />
              </div>
            </div>
            <div className="card p-5">
              <h2 className="mb-4 text-base font-bold text-slate-900">Academic</h2>
              {isTeacher ? (
                <div className="space-y-3">
                  {data.teaching_assignments?.length ? (
                    data.teaching_assignments.map((item, index) => (
                      <div key={index} className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-700">
                        <p>Assigned Program: {item.program || item.course || "—"}</p>
                        <p>
                          Assigned Batch: {item.batch || "—"} · Assigned Section: {item.section || "—"}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No teaching allocations.</p>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <DetailItem label="Program" value={data.course} />
                  <DetailItem label="Batch" value={data.batch} />
                  <DetailItem label="Section" value={data.section} />
                  <DetailItem label="Year" value={data.year} />
                </div>
              )}
            </div>
          </section>

          {isTeacher ? (
            <>
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-bold text-slate-900">Subject-wise progress</h2>
                </div>
                <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
                  {data.subject_progress?.length ? (
                    data.subject_progress.map((subject) => (
                      <article key={subject.subject_id || subject.subject} className={`bg-white p-5 ${subject.overdue_evaluations ? "bg-red-50" : ""}`}>
                        <h3 className="font-bold">{subject.subject}</h3>
                        <p className="mt-2 text-sm">{subject.assignments} assignments</p>
                        <p className="text-sm">
                          Submission: {subject.submission_rate == null ? "N/A" : `${subject.submission_rate}% (${subject.submissions}/${subject.closed_eligible})`}
                        </p>
                        <p className="text-sm">Missed: {subject.missed_rate == null ? "N/A" : `${subject.missed_rate}% (${subject.missed}/${subject.closed_eligible})`}</p>
                        <p className="text-sm">
                          Pending: {subject.pending_evaluations} · Overdue: {subject.overdue_evaluations}
                        </p>
                      </article>
                    ))
                  ) : (
                    <p className="bg-white p-7 text-sm text-slate-500">No subject progress available.</p>
                  )}
                </div>
              </section>
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-bold text-slate-900">Created assignments</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {data.owned_assignments?.length ? (
                    data.owned_assignments.map((item) => (
                      <Link key={item.id} href={`/assignments/admin/${item.id}`} className="flex justify-between px-5 py-4 hover:bg-slate-50">
                        <span className="font-bold">{item.title}</span>
                        <span className="text-xs text-slate-500">Due {formatDate(item.due_at)}</span>
                      </Link>
                    ))
                  ) : (
                    <p className="p-7 text-sm text-slate-500">No assignments have been created yet.</p>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="font-bold text-slate-900">Subject-wise progress</h2>
                </div>
                <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
                  {subjectProgress.length ? (
                    subjectProgress.map((subject) => (
                      <article
                        key={subject.key}
                        className={`p-5 ${subject.missedRate != null && subject.missedRate > Number(data.assignment_summary?.missed_rate_threshold_percent ?? 25) ? "bg-red-50" : "bg-white"}`}
                      >
                        <h3 className="font-bold text-slate-900">{subject.name}</h3>
                        <p className="mt-3 text-sm">
                          Total assignments: {subject.total} · Submitted: {subject.submitted}
                        </p>
                        <p className="text-sm">Missed: {subject.missed} ({subject.missedRate == null ? "N/A" : `${subject.missedRate}%`})</p>
                        <p className="text-sm">
                          Submission rate: {subject.submissionRate == null ? "N/A" : `${subject.submissionRate}% (${subject.closedSubmitted}/${subject.closedEligible})`}
                        </p>
                        <p className="text-sm">Average: {subject.averageScore == null ? "—" : `${subject.averageScore}%`}</p>
                      </article>
                    ))
                  ) : (
                    <p className="bg-white p-7 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">No subject progress is available in this academic year.</p>
                  )}
                </div>
              </section>
              <section className="card overflow-hidden">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="font-bold text-slate-900">Assignment record by subject</h2>
                    <p className="mt-1 text-xs text-slate-500">All years are shown. Draft and published marks are visible to administrators; editing remains teacher-controlled.</p>
                  </div>
                  <label>
                    <span className="ui-field-label">Subject</span>
                    <select className="input-field mt-1 w-auto" value={studentSubjectFilter} onChange={(event) => setStudentSubjectFilter(event.target.value)}>
                      <option value="all">All subjects</option>
                      {Array.from(
                        new Map(
                          (data.assignment_activity || []).map((item) => [
                            item.subject_id || `legacy:${item.subject || "Unassigned subject"}`,
                            item.subject || "Unassigned subject",
                          ]),
                        ),
                      ).map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="divide-y divide-slate-100">
                  {filteredStudentAssignments.length ? (
                    filteredStudentAssignments.map((item) => (
                      <div key={item.assignment_id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {valueOrDash(item.subject)} · Due {formatDate(item.due_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-semibold">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 capitalize text-slate-700">{item.status.replaceAll("_", " ")}</span>
                          {item.percentage != null && (
                            <span className="text-primary-700">
                              {item.marks_obtained}/{item.total_marks} · {item.percentage}% · <span className="capitalize">{item.grade_status}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="p-7 text-center text-sm text-slate-500">No assignments match this subject.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </>
  );
}

"use client";

// Ported from frontend-legacy/src/pages/AssignmentDashboard.jsx
import {
  AlertTriangle,
  RefreshCw,
  Users,
} from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { AdminMonitoring } from "./dashboard/AdminMonitoring";
import { AssignmentAnalytics } from "./dashboard/AssignmentAnalytics";
import { AssignmentInsights, TeacherScopeCharts } from "./dashboard/AssignmentInsights";
import { useAssignmentDashboard } from "./dashboard/useAssignmentDashboard";
import { AssignmentList } from "./dashboard/AssignmentList";
import { StudentSubjectsPanel } from "./dashboard/StudentSubjectsPanel";
import { StudentHome } from "./dashboard/StudentHome";
import { TeacherSummary } from "./dashboard/TeacherSummary";
import { DashboardHeader } from "./dashboard/DashboardHeader";
import { DateField, LoadingState, StatGrid, StatTile } from "@/components/ui";

export default function AssignmentDashboardView({ initialView = "overview" }: { initialView?: string }) {
  const {
    user,
    loading,
    refreshing,
    teacherFilter,
    setTeacherFilter,
    adminStatusFilter,
    setAdminStatusFilter,
    adminProgramFilter,
    setAdminProgramFilter,
    adminSubjectFilter,
    setAdminSubjectFilter,
    adminBatchFilter,
    setAdminBatchFilter,
    adminSectionFilter,
    setAdminSectionFilter,
    adminFromDate,
    setAdminFromDate,
    adminToDate,
    setAdminToDate,
    adminPage,
    setAdminPage,
    adminTotalAssignments,
    adminFilterOptions,
    adminRange,
    setAdminRange,
    query,
    setQuery,
    lastUpdated,
    assignments,
    summary,
    adminDashboard,
    teacherScope,
    isAdminAllAssignmentsPage,
    isAnalyticsPage,
    isAdminOverviewPage,
    isStudentSubjectsPage,
    load,
    navigate,
    adminAssignmentStats,
    universityStats,
    stats,
    displayedAssignments,
    studentSubjects,
    overdueEvaluationAlerts,
    openItem,
    adminPageSize,
    adminTotalPages
  } = useAssignmentDashboard(initialView);

  return (
    <>
      <DashboardHeader
        user={user}
        isAnalyticsPage={isAnalyticsPage}
        isAdminAllAssignmentsPage={isAdminAllAssignmentsPage}
        isAdminOverviewPage={isAdminOverviewPage}
        isStudentSubjectsPage={isStudentSubjectsPage}
        refreshing={refreshing}
        refresh={() => load(true)}
        navigate={navigate}
      />
      {isStudentSubjectsPage ? (
        <StudentSubjectsPanel loading={loading} subjects={studentSubjects} openItem={openItem} />
      ) : user.role === "student" ? (
        <StudentHome user={user} loading={loading} assignments={assignments} openItem={openItem} navigate={navigate} />
      ) : isAnalyticsPage ? (
        loading ? <LoadingState label="Loading analytics…" /> : <AssignmentAnalytics assignments={assignments} />
      ) : (
        <>
          {overdueEvaluationAlerts.length > 0 && (
            <section role="alert" aria-labelledby="overdue-evaluation-heading" className="mb-7 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
              <div className="flex flex-col gap-3 border-b border-amber-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-amber-100 p-2 text-amber-700">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 id="overdue-evaluation-heading" className="font-bold text-amber-950">
                      Grading overdue
                    </h2>
                    <p className="mt-0.5 text-sm text-amber-800">Submitted work is waiting for marks.</p>
                  </div>
                </div>
                <span className="self-start rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900 sm:self-auto">
                  {overdueEvaluationAlerts.length} item{overdueEvaluationAlerts.length === 1 ? "" : "s"} need attention
                </span>
              </div>
              <div className="divide-y divide-amber-200">
                {overdueEvaluationAlerts.map((item) => (
                  <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="[overflow-wrap:anywhere] font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-1 text-sm text-amber-800">
                        {item.teacher_name || "No teacher assigned"} has not graded {item.overdue_ungraded_submission_count} submitted
                        {Number(item.overdue_ungraded_submission_count) === 1 ? " assignment" : " assignments"}. Due {formatDateTime(item.due_at)}
                      </p>
                    </div>
                    <button type="button" onClick={() => openItem(item)} className="btn btn-outline shrink-0 border-amber-400 bg-white text-amber-900 hover:bg-amber-100">
                      <Users className="h-4 w-4" />
                      Review
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {isAdminOverviewPage && (
            <div className="mb-7 space-y-6">
              <section aria-labelledby="university-summary-heading">
                <div className="mb-3">
                  <h2 id="university-summary-heading" className="text-base font-bold text-slate-900">
                    University information
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">People and academic structure across the university.</p>
                </div>
                <StatGrid>
                  {universityStats.map(([label, value, Icon]) => (
                    <StatTile key={label} label={label} value={value} icon={Icon} />
                  ))}
                </StatGrid>
              </section>
              <section aria-labelledby="assignment-summary-heading">
                <div className="mb-3">
                  <h2 id="assignment-summary-heading" className="text-base font-bold text-slate-900">
                    Assignment information
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">Current assignment, submission, and grading activity.</p>
                </div>
                <StatGrid>
                  {adminAssignmentStats.map(([label, value, Icon]) => (
                    <StatTile key={label} label={label} value={value} icon={Icon} />
                  ))}
                </StatGrid>
              </section>
            </div>
          )}
          {isAdminOverviewPage && <AdminMonitoring data={adminDashboard} allAssignments={assignments} range={adminRange} setRange={setAdminRange} refresh={() => load(true)} navigate={navigate} />}
          {user.role === "teacher" && !loading && <TeacherSummary user={user} summary={summary} onReview={() => setTeacherFilter("awaiting_grading")} />}
          {!isAdminAllAssignmentsPage && !isAdminOverviewPage && (
            <div className="mb-7">
              <StatGrid>
                {stats.map(([label, value, Icon]) => (
                  <StatTile key={label} label={label} value={value} icon={Icon} />
                ))}
              </StatGrid>
            </div>
          )}
          {!isAdminAllAssignmentsPage && !loading && user.role === "teacher" && <TeacherScopeCharts scope={teacherScope} summary={summary} />}
          {!isAdminAllAssignmentsPage && !isAdminOverviewPage && !loading && assignments.length > 0 && <AssignmentInsights assignments={assignments} summary={summary} role={user.role} />}
          {user.role === "teacher" && (
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="input-field sm:max-w-sm" placeholder="Search assignments or subjects" />
              <div className="flex flex-wrap gap-2">
                {["all", "scheduled", "open", "awaiting_grading", "results_partial"].map((value) => (
                  <button key={value} onClick={() => setTeacherFilter(value)} className={`btn ${teacherFilter === value ? "btn-primary" : "btn-outline"}`}>
                    {value.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
              {lastUpdated && <span className="text-xs text-slate-500">Updated {lastUpdated.toLocaleTimeString()}</span>}
            </div>
          )}
          {isAdminAllAssignmentsPage && (
            <section className="mb-5 rounded-xl border border-slate-200 bg-white p-3" aria-label="Assignment filters">
              <div className="flex items-center gap-3">
                <input value={query} onChange={(event) => setQuery(event.target.value)} className="input-field min-w-0 flex-1" placeholder="Search title, subject, or teacher" />
                <button onClick={() => load(true)} disabled={refreshing} className="btn btn-outline shrink-0">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <DateField label="Due from" value={adminFromDate} onChange={(event) => setAdminFromDate(event.target.value)} />
                <DateField label="Due to" value={adminToDate} onChange={(event) => setAdminToDate(event.target.value)} />
                <select className="input-field w-auto" value={adminProgramFilter} onChange={(event) => setAdminProgramFilter(event.target.value)}>
                  <option value="all">All programs</option>
                  {adminFilterOptions.programs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.display_name || item.name}
                    </option>
                  ))}
                </select>
                <select className="input-field w-auto" value={teacherFilter} onChange={(event) => setTeacherFilter(event.target.value)}>
                  <option value="all">All teachers</option>
                  {adminFilterOptions.teachers.map((item) => (
                    <option key={item._id || item.id} value={item._id || item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select className="input-field w-auto" value={adminSubjectFilter} onChange={(event) => setAdminSubjectFilter(event.target.value)}>
                  <option value="all">All subjects</option>
                  {adminFilterOptions.subjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select className="input-field w-auto" value={adminBatchFilter} onChange={(event) => setAdminBatchFilter(event.target.value)}>
                  <option value="all">All batches</option>
                  {adminFilterOptions.batches.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label || item.display_name || item.name || `${item.start_year}-${item.end_year}`}
                    </option>
                  ))}
                </select>
                <select className="input-field w-auto" value={adminSectionFilter} onChange={(event) => setAdminSectionFilter(event.target.value)}>
                  <option value="all">All sections</option>
                  {adminFilterOptions.sections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {["all", "scheduled", "open", "late_window", "closed", "completed", "archived"].map((value) => (
                  <button key={value} onClick={() => setAdminStatusFilter(value)} className={`btn min-h-0 px-3 py-2 text-sm ${adminStatusFilter === value ? "btn-primary" : "btn-outline"}`}>
                    {value === "all" ? "All statuses" : value.replaceAll("_", " ")}
                  </button>
                ))}
              </div>
            </section>
          )}
          <AssignmentList
            loading={loading}
            assignments={displayedAssignments}
            user={user}
            isAdminAllAssignmentsPage={isAdminAllAssignmentsPage}
            isAdminOverviewPage={isAdminOverviewPage}
            adminPage={adminPage}
            adminPageSize={adminPageSize}
            adminTotalAssignments={adminTotalAssignments}
            adminTotalPages={adminTotalPages}
            setAdminPage={setAdminPage}
            navigate={navigate}
            openItem={openItem}
            onDeleted={() => load()}
          />
        </>
      )}
    </>
  );
}

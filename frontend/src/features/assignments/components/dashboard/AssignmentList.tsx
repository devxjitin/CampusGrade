"use client";

import type { Dispatch, SetStateAction } from "react";
import { Archive, CalendarClock, FileCode2, Users } from "lucide-react";
import GithubIcon from "@/components/icons/GithubIcon";
import { useToast } from "@/components/Toast";
import { deleteAssignment } from "@/features/assignments/api";
import { formatDateTime } from "@/lib/datetime";
import { isAdminRole } from "@/lib/session";
import { phaseBadge, type Assignment } from "./shared";

export const AssignmentList = ({
  loading,
  assignments,
  user,
  isAdminAllAssignmentsPage,
  isAdminOverviewPage,
  adminPage,
  adminPageSize,
  adminTotalAssignments,
  adminTotalPages,
  setAdminPage,
  navigate,
  openItem,
  onDeleted,
}: {
  loading: boolean;
  assignments: Assignment[];
  user: Assignment;
  isAdminAllAssignmentsPage: boolean;
  isAdminOverviewPage: boolean;
  adminPage: number;
  adminPageSize: number;
  adminTotalAssignments: number;
  adminTotalPages: number;
  setAdminPage: Dispatch<SetStateAction<number>>;
  navigate: (path: string) => void;
  openItem: (assignment: Assignment) => void;
  onDeleted: () => void;
}) => {
  const toast = useToast();
  return loading ? (
            <div className="card p-10 text-center text-slate-500">Loading assignments…</div>
          ) : assignments.length === 0 ? (
            <div className="card p-12 text-center">
              <FileCode2 className="mx-auto h-12 w-12 text-slate-300" />
              <h2 className="mt-4 text-lg font-bold">No assignments yet</h2>
              <p className="mt-1 text-sm text-slate-500">{user.role === "teacher" ? "Create the first GitHub repository assignment." : isAdminAllAssignmentsPage ? "Try a different search or status." : "Assignments will appear here."}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {isAdminAllAssignmentsPage && (
                <p className="text-xs font-semibold text-slate-500">
                  Showing {(adminPage - 1) * adminPageSize + 1}–{Math.min(adminPage * adminPageSize, adminTotalAssignments)} of {adminTotalAssignments} assignments
                </p>
              )}
              {isAdminOverviewPage && (
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">Recent assignments</h2>
                  <button onClick={() => navigate("/assignments/admin/all")} className="text-xs font-semibold text-primary-700 hover:text-primary-800">
                    View all
                  </button>
                </div>
              )}
              {assignments.map((item) => (
                <article key={item.id} className="card p-5 transition hover:border-primary-200 hover:shadow-md">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold">{item.title}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${phaseBadge[item.phase] || phaseBadge.open}`}>{String(item.workflow_status || item.phase || item.status).replaceAll("_", " ")}</span>
                        {item.version?.is_late && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">Late</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <CalendarClock className="h-4 w-4" />
                          Due {formatDateTime(item.due_at)}
                        </span>
                        <span>{item.total_marks} marks</span>
                        {item.subject && <span>{item.subject}</span>}
                        {isAdminRole(user.role) && <span>Teacher: {item.teacher_name}</span>}
                      </div>
                      {user.role === "teacher" && (
                        <div className="mt-4 max-w-xl">
                          <div className="mb-1 flex flex-wrap justify-between gap-x-4 text-xs font-medium text-slate-600">
                            <span>
                              {item.submission_count}/{item.eligible_count} students submitted
                            </span>
                            <span>{item.pending_submission_count} pending</span>
                            <span>{item.pending_grade_count} awaiting grading</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-primary-600" style={{ width: `${item.eligible_count ? Math.min(100, (item.submission_count / item.eligible_count) * 100) : 0}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => openItem(item)} className="btn btn-primary">
                        {user.role === "teacher" || isAdminRole(user.role) ? <Users className="h-4 w-4" /> : <GithubIcon className="h-4 w-4" />}
                        {user.role === "teacher" ? "Review submissions" : isAdminRole(user.role) ? "Inspect assignment" : item.submission ? "View submission" : "Open assignment"}
                      </button>
                      {user.role === "teacher" && (
                        <button disabled={!item.edit_allowed} title={!item.edit_allowed ? "Locked after the first student submission" : "Edit assignment"} onClick={() => navigate(`/assignments/${item.id}/edit`)} className="btn btn-outline disabled:cursor-not-allowed disabled:opacity-50">
                          Edit
                        </button>
                      )}
                      {user.role === "teacher" && item.teacher_delete_allowed && (
                        <button
                          onClick={async () => {
                            try {
                              await deleteAssignment(item.id);
                              toast.success("Assignment deleted");
                              onDeleted();
                            } catch (e) {
                              const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
                              toast.error(message || "Action failed");
                            }
                          }}
                          className="btn btn-outline"
                        >
                          <Archive className="h-4 w-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
              {isAdminAllAssignmentsPage && adminTotalPages > 1 && (
                <nav className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3" aria-label="Assignment pages">
                  <button className="btn btn-outline" disabled={adminPage <= 1} onClick={() => setAdminPage((value) => Math.max(1, value - 1))}>
                    Previous
                  </button>
                  <span className="text-sm font-semibold text-slate-600">
                    Page {adminPage} of {adminTotalPages}
                  </span>
                  <button className="btn btn-outline" disabled={adminPage >= adminTotalPages} onClick={() => setAdminPage((value) => Math.min(adminTotalPages, value + 1))}>
                    Next
                  </button>
                </nav>
              )}
            </div>
          );
};

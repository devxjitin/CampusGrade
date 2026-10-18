"use client";

// Ported from frontend-legacy/src/pages/AdminTeachers.jsx
import { getCachedUser } from "@/lib/session";
import { canAccess } from "@/lib/permissions";
import { Eye, Pencil, Power, Trash2, Upload } from "lucide-react";
import { FilterToolbar, IconAction, LoadingState, PageHeader, SearchField, SelectField, StatusBadge } from "@/components/ui";
import { useAdminTeachers } from "./adminTeachers/useAdminTeachers";
import { assignmentSummary } from "./adminTeachers/shared";
import { AddTeacherDialog } from "./adminTeachers/AddTeacherDialog";
import { EditTeacherDialog } from "./adminTeachers/EditTeacherDialog";
import { UploadTeachersDialog } from "./adminTeachers/UploadTeachersDialog";

export default function AdminTeachersPage() {
  const canEdit = canAccess(getCachedUser(), "users", "edit");
  const canDelete = canAccess(getCachedUser(), "users", "full");
  const model = useAdminTeachers();
  const {
    loading,
    error,
    searchTeacher,
    setSearchTeacher,
    filterDesignation,
    setFilterDesignation,
    filterStatus,
    setFilterStatus,
    getTeacherId,
    handleToggleStatus,
    handleDeleteTeacher,
    handleOpenEditTeacher,
    handleOpenAddModal,
    handleOpenUploadModal,
    designationOptions,
    filteredTeachers
  } = model;

  return (
    <>
      <div className="w-full">
        <PageHeader
          eyebrow="User directory"
          title="Teachers"
          description="Manage teacher accounts, academic assignments, and course responsibilities."
          actions={
            !canEdit ? undefined : <>
              <button onClick={handleOpenUploadModal} className="btn btn-outline">
                <Upload className="h-4 w-4" />
                Import teachers
              </button>
              <button onClick={handleOpenAddModal} className="btn btn-primary">
                Add teacher
              </button>
            </>
          }
        />

        <FilterToolbar
          search={<SearchField value={searchTeacher} onChange={(e) => setSearchTeacher(e.target.value)} placeholder="Search by ID, name or email" aria-label="Search teachers" />}
          filters={
            <>
              <SelectField aria-label="Designation" value={filterDesignation} onChange={(e) => setFilterDesignation(e.target.value)}>
                <option value="">All designations</option>
                {designationOptions.map((designation) => (
                  <option key={designation} value={designation}>{designation}</option>
                ))}
              </SelectField>
              <SelectField aria-label="Status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </SelectField>
            </>
          }
          resultSummary={loading ? undefined : `${filteredTeachers.length} teacher${filteredTeachers.length === 1 ? "" : "s"}`}
        />

        <div className="ui-data-card">
          {loading ? (
            <LoadingState label="Loading teachers…" />
          ) : error ? (
            <div className="p-6 text-center text-red-500" role="alert">{error}</div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Designation</th>
                    <th>Assignments</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTeachers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">No teachers found.</td>
                    </tr>
                  ) : (
                    filteredTeachers.map((teacher) => (
                      <tr key={getTeacherId(teacher)} className={teacher.evaluation_overdue ? "bg-red-50/70" : ""}>
                        <td>
                          <p className="cell-primary">{teacher.name}</p>
                          <p className="cell-muted">{teacher.teacher_id || "No teacher ID"}</p>
                        </td>
                        <td className="whitespace-nowrap">{teacher.designation || "N/A"}</td>
                        <td className="min-w-[15rem] max-w-md">
                          {teacher.assignments?.length ? (
                            <ul className="space-y-1">
                              {teacher.assignments.map((item, index) => (
                                <li key={index} className="text-xs leading-5 text-slate-600">{assignmentSummary(item)}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-400">Unassigned</span>
                          )}
                          {teacher.evaluation_overdue && (
                            <span className="mt-1 block text-xs font-bold text-red-700">{teacher.overdue_evaluations} evaluation(s) overdue 24h</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={teacher.is_active ? "active" : "inactive"} />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <IconAction label="View teacher details" tone="info" href={`/admin/users/${getTeacherId(teacher)}`}>
                              <Eye className="h-4 w-4" />
                            </IconAction>
                            {canEdit && (
                              <>
                                <IconAction label="Edit teacher" onClick={() => handleOpenEditTeacher(teacher)}>
                                  <Pencil className="h-4 w-4" />
                                </IconAction>
                                <IconAction
                                  label={teacher.is_active ? "Deactivate teacher" : "Activate teacher"}
                                  tone={teacher.is_active ? "danger" : "success"}
                                  onClick={() => handleToggleStatus(getTeacherId(teacher), teacher.is_active)}
                                >
                                  <Power className="h-4 w-4" />
                                </IconAction>
                              </>
                            )}
                            {canDelete && (
                              <IconAction label="Remove teacher" tone="danger" onClick={() => handleDeleteTeacher(teacher)}>
                                <Trash2 className="h-4 w-4" />
                              </IconAction>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>


      <AddTeacherDialog model={model} />
      <UploadTeachersDialog model={model} />
      <EditTeacherDialog model={model} />
    </>
  );
}

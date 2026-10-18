"use client";

// Ported from frontend-legacy/src/pages/AdminStudents.jsx
import { getCachedUser } from "@/lib/session";
import { canAccess } from "@/lib/permissions";
import { Eye, Pencil, Power, Trash2, Upload } from "lucide-react";
import { FilterToolbar, IconAction, LoadingState, PageHeader, SearchField, SelectField, StatusBadge } from "@/components/ui";
import ViewingSessionBanner from "@/components/ViewingSessionBanner";
import { useAdminStudents } from "./adminStudents/useAdminStudents";
import { getStudentId } from "./adminStudents/shared";
import { AddStudentDialog } from "./adminStudents/AddStudentDialog";
import { EditStudentDialog } from "./adminStudents/EditStudentDialog";
import { UploadStudentsDialog } from "./adminStudents/UploadStudentsDialog";

export default function AdminStudentsPage() {
  const canEdit = canAccess(getCachedUser(), "users", "edit");
  const canDelete = canAccess(getCachedUser(), "users", "full");
  const model = useAdminStudents();
  const {
    loading,
    error,
    searchName,
    setSearchName,
    filterCourse,
    setFilterCourse,
    filterBatch,
    setFilterBatch,
    filterSection,
    setFilterSection,
    handleToggleStatus,
    handleDeleteStudent,
    handleOpenEditStudent,
    handleOpenAddModal,
    handleOpenUploadModal,
    courseFilterOptions,
    batchFilterOptions,
    sectionFilterOptions,
    filteredStudents
  } = model;

  return (
    <>
      <div className="w-full">
        <ViewingSessionBanner />
        <PageHeader
          eyebrow="User directory"
          title="Students"
          description="Manage student accounts and academic placement for assignment delivery."
          actions={
            !canEdit ? undefined : <>
              <button onClick={handleOpenUploadModal} className="btn btn-outline">
                <Upload className="h-4 w-4" />
                Import students
              </button>
              <button onClick={handleOpenAddModal} className="btn btn-primary">
                Add student
              </button>
            </>
          }
        />

        <FilterToolbar
          search={<SearchField value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Search by student name" aria-label="Search students by name" />}
          filters={
            <>
              <SelectField
                aria-label="Program"
                value={filterCourse}
                onChange={(e) => {
                  setFilterCourse(e.target.value);
                  setFilterBatch("");
                  setFilterSection("");
                }}
              >
                <option value="">All programs</option>
                {courseFilterOptions.map((course) => (
                  <option key={course} value={course}>{course}</option>
                ))}
              </SelectField>
              <SelectField
                aria-label="Batch"
                value={filterBatch}
                onChange={(e) => {
                  setFilterBatch(e.target.value);
                  setFilterSection("");
                }}
              >
                <option value="">All batches</option>
                {batchFilterOptions.map((batch) => (
                  <option key={batch} value={batch}>{batch}</option>
                ))}
              </SelectField>
              <SelectField aria-label="Section" value={filterSection} onChange={(e) => setFilterSection(e.target.value)}>
                <option value="">All sections</option>
                {sectionFilterOptions.map((section) => (
                  <option key={section} value={section}>{section}</option>
                ))}
              </SelectField>
            </>
          }
          resultSummary={loading ? undefined : `${filteredStudents.length} student${filteredStudents.length === 1 ? "" : "s"}`}
        />

        <div className="ui-data-card">
          {loading ? (
            <LoadingState label="Loading students…" />
          ) : error ? (
            <div className="p-6 text-center text-red-500" role="alert">{error}</div>
          ) : (
            <div className="ui-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Roll no</th>
                    <th>Placement</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">No students found.</td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => (
                      <tr key={getStudentId(student)}>
                        <td>
                          <p className="cell-primary">{student.name}</p>
                          <p className="cell-muted">{student.email}</p>
                        </td>
                        <td className="whitespace-nowrap">{student.roll_no || "-"}</td>
                        <td>
                          <p className="font-medium text-slate-700">{student.course || "-"}</p>
                          <p className="cell-muted">
                            Batch {student.batch || "-"} · Section {student.section_name || "-"}
                            {student.semester ? ` · Semester ${student.semester}` : ""}
                          </p>
                        </td>
                        <td>
                          <StatusBadge status={student.is_active ? "active" : "inactive"} />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <IconAction label="View student details" tone="info" href={`/admin/users/${getStudentId(student)}`}>
                              <Eye className="h-4 w-4" />
                            </IconAction>
                            {canEdit && (
                              <>
                                <IconAction label="Edit student" onClick={() => handleOpenEditStudent(student)}>
                                  <Pencil className="h-4 w-4" />
                                </IconAction>
                                <IconAction
                                  label={student.is_active ? "Deactivate student" : "Activate student"}
                                  tone={student.is_active ? "danger" : "success"}
                                  onClick={() => handleToggleStatus(student, student.is_active)}
                                >
                                  <Power className="h-4 w-4" />
                                </IconAction>
                              </>
                            )}
                            {canDelete && (
                              <IconAction label="Remove student" tone="danger" onClick={() => handleDeleteStudent(student)}>
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


      <AddStudentDialog model={model} />
      <UploadStudentsDialog model={model} />
      <EditStudentDialog model={model} />
    </>
  );
}

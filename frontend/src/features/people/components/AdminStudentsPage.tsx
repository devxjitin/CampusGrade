"use client";

// Ported from frontend-legacy/src/pages/AdminStudents.jsx
import Link from "next/link";
import { getCachedUser } from "@/lib/session";
import { canAccess } from "@/lib/permissions";
import { Eye, KeyRound, Pencil, Trash2, Upload } from "lucide-react";
import { LoadingState, PageHeader } from "@/components/ui";
import TemporaryPasswordDialog from "@/components/TemporaryPasswordDialog";
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
    passwordResetResult,
    setPasswordResetResult,
    resettingPasswordId,
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
    handleResetPassword,
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

        <div className="ui-toolbar flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search by Name</label>
            <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} className="input-field" placeholder="Student name" />
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
            <select
              value={filterCourse}
              onChange={(e) => {
                setFilterCourse(e.target.value);
                setFilterBatch("");
                setFilterSection("");
              }}
              className="w-full border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All Programs</option>
              {courseFilterOptions.map((course) => (
                <option key={course} value={course}>
                  {course}
                </option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
            <select
              value={filterBatch}
              onChange={(e) => {
                setFilterBatch(e.target.value);
                setFilterSection("");
              }}
              className="w-full border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">All Batches</option>
              {batchFilterOptions.map((batch) => (
                <option key={batch} value={batch}>
                  {batch}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
            <select value={filterSection} onChange={(e) => setFilterSection(e.target.value)} className="w-full border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500">
              <option value="">All Sections</option>
              {sectionFilterOptions.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ui-data-card overflow-x-auto">
          {loading ? (
            <LoadingState label="Loading students…" />
          ) : error ? (
            <div className="p-6 text-center text-red-500">{error}</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Roll No</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Program Data</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                      No students found.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => (
                    <tr key={getStudentId(student)}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{student.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{student.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{student.roll_no}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <p className="font-medium text-gray-700">{student.course || "-"}</p>
                        <p className="text-xs text-gray-500">
                          Batch: {student.batch || "-"} | Section: {student.section_name || "-"}
                          {student.semester ? ` | Semester: ${student.semester}` : ""}
                        </p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${student.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {student.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-4">
                          <Link href={`/admin/users/${getStudentId(student)}`} className="text-primary-600 hover:text-primary-800" title="View student details">
                            <Eye className="h-4 w-4" />
                          </Link>
                          {canEdit && (<><button onClick={() => handleOpenEditStudent(student)} className="text-indigo-600 hover:text-indigo-900" title="Edit student">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleResetPassword(student)}
                            disabled={resettingPasswordId === getStudentId(student)}
                            className="text-amber-700 hover:text-amber-900 disabled:opacity-50"
                            title="Reset password"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(student, student.is_active)}
                            className={student.is_active ? "text-red-600 hover:text-red-900" : "text-green-600 hover:text-green-900"}
                          >
                            {student.is_active ? "Deactivate" : "Activate"}
                          </button></>)}
                          {canDelete && <button onClick={() => handleDeleteStudent(student)} className="text-red-700 hover:text-red-900" title="Remove student">
                            <Trash2 className="h-4 w-4" />
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <TemporaryPasswordDialog result={passwordResetResult} onClose={() => setPasswordResetResult(null)} />

      <AddStudentDialog model={model} />
      <UploadStudentsDialog model={model} />
      <EditStudentDialog model={model} />
    </>
  );
}

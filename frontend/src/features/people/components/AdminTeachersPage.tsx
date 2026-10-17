"use client";

// Ported from frontend-legacy/src/pages/AdminTeachers.jsx
import Link from "next/link";
import { Eye, KeyRound, Pencil, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/ui";
import TemporaryPasswordDialog from "@/components/TemporaryPasswordDialog";
import { useAdminTeachers } from "./adminTeachers/useAdminTeachers";
import { assignmentSummary } from "./adminTeachers/shared";
import { AddTeacherDialog } from "./adminTeachers/AddTeacherDialog";
import { EditTeacherDialog } from "./adminTeachers/EditTeacherDialog";
import { UploadTeachersDialog } from "./adminTeachers/UploadTeachersDialog";

export default function AdminTeachersPage() {
  const model = useAdminTeachers();
  const {
    loading,
    error,
    passwordResetResult,
    setPasswordResetResult,
    resettingPasswordId,
    searchTeacher,
    setSearchTeacher,
    filterDesignation,
    setFilterDesignation,
    filterStatus,
    setFilterStatus,
    getTeacherId,
    handleToggleStatus,
    handleDeleteTeacher,
    handleResetPassword,
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
            <>
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

        <div className="ui-toolbar flex-wrap items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Teacher</label>
            <input type="text" value={searchTeacher} onChange={(e) => setSearchTeacher(e.target.value)} className="input-field" placeholder="By ID, name or email" />
          </div>
          <div className="w-56">
            <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
            <select value={filterDesignation} onChange={(e) => setFilterDesignation(e.target.value)} className="w-full border border-gray-300 rounded-md p-2">
              <option value="">All Designations</option>
              {designationOptions.map((designation) => (
                <option key={designation} value={designation}>
                  {designation}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full border border-gray-300 rounded-md p-2">
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="ui-data-card overflow-x-auto">
          {loading ? (
            <div className="p-6 text-center text-gray-500">Loading...</div>
          ) : error ? (
            <div className="p-6 text-center text-red-500">{error}</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teacher ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Designation</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assignments</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                      No teachers found.
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((teacher) => (
                    <tr key={getTeacherId(teacher)} className={teacher.evaluation_overdue ? "bg-red-50" : ""}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{teacher.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{teacher.teacher_id || "N/A"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{teacher.designation || "N/A"}</td>
                      <td className="max-w-xs px-6 py-4 text-sm text-gray-500">
                        {teacher.assignments?.length ? teacher.assignments.map(assignmentSummary).join(" | ") : "Unassigned"}
                        {teacher.evaluation_overdue && <span className="mt-1 block font-bold text-red-700">{teacher.overdue_evaluations} evaluation(s) overdue 24h</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${teacher.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {teacher.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center gap-4">
                          <Link href={`/admin/users/${getTeacherId(teacher)}`} className="text-primary-600 hover:text-primary-800" title="View teacher details">
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button onClick={() => handleOpenEditTeacher(teacher)} className="text-indigo-600 hover:text-indigo-900" title="Edit teacher">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleResetPassword(teacher)}
                            disabled={resettingPasswordId === getTeacherId(teacher)}
                            className="text-amber-700 hover:text-amber-900 disabled:opacity-50"
                            title="Reset password"
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(getTeacherId(teacher), teacher.is_active)}
                            className={teacher.is_active ? "text-red-600 hover:text-red-900" : "text-green-600 hover:text-green-900"}
                          >
                            {teacher.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button onClick={() => handleDeleteTeacher(teacher)} className="text-red-700 hover:text-red-900" title="Remove teacher">
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      <AddTeacherDialog model={model} />
      <UploadTeachersDialog model={model} />
      <EditTeacherDialog model={model} />
    </>
  );
}

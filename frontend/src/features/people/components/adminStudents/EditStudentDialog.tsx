"use client";

import { Dialog } from "@/components/ui";
import { buildCourseLabel, getBatchLabel, getSemesterOptions } from "./shared";
import type { AdminStudentsModel } from "./useAdminStudents";

export const EditStudentDialog = ({ model }: { model: AdminStudentsModel }) => {
  const {
    courses,
    showEditModal,
    handleCloseEditModal,
    handleEditSubmit,
    handleEditInputChange,
    applyCourseToEditForm,
    handleEditBatchChange,
    editFormData,
    editError,
    selectedEditCourseId,
    selectedEditBatchId,
    editCourseBatches,
    editCourseSections
  } = model;
  return (
<Dialog
        open={showEditModal}
        onClose={handleCloseEditModal}
        title="Edit student"
        description="Update identity, contact details, and academic placement."
        size="lg"
        footer={
          <>
            <button type="button" onClick={handleCloseEditModal} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="edit-student-form" className="btn btn-primary">
              Save changes
            </button>
          </>
        }
      >
        {editError && <div className="mb-4 text-red-600 bg-red-50 p-3 rounded">{editError}</div>}

        <form id="edit-student-form" onSubmit={handleEditSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input required name="name" type="text" value={editFormData.name} onChange={handleEditInputChange} className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input required name="email" type="email" value={editFormData.email} onChange={handleEditInputChange} className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Roll No</label>
              <input name="roll_no" type="text" value={editFormData.roll_no} onChange={handleEditInputChange} className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Program</label>
              <select required value={selectedEditCourseId} onChange={(event) => applyCourseToEditForm(event.target.value)} className="input-field mt-1">
                <option value="">Select program</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {buildCourseLabel(course)}
                  </option>
                ))}
              </select>
              {courses.length === 0 && <p className="mt-1 text-xs text-amber-600">No programs available. Add one in the Programs page first.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Year</label>
              <input readOnly name="year" type="text" value={editFormData.year} className="input-field mt-1" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Batch</label>
              <select required value={selectedEditBatchId} onChange={(event) => handleEditBatchChange(event.target.value)} className="input-field mt-1" disabled={!selectedEditCourseId}>
                <option value="">{selectedEditCourseId ? "Select batch" : "Select program first"}</option>
                {editCourseBatches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {getBatchLabel(batch)}
                  </option>
                ))}
              </select>
              {selectedEditCourseId && editCourseBatches.length === 0 && <p className="mt-1 text-xs text-amber-600">No batches found for this program. Add one in the Batches page.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Section</label>
              <select
                name="section_id"
                value={editFormData.section_id}
                onChange={handleEditInputChange}
                className="input-field mt-1"
                disabled={!selectedEditCourseId || !selectedEditBatchId || editCourseSections.length === 0}
              >
                <option value="">{selectedEditBatchId ? (editCourseSections.length > 0 ? "Select section" : "No section available") : "Select batch first"}</option>
                {editCourseSections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              {selectedEditBatchId && editCourseSections.length === 0 && <p className="mt-1 text-xs text-amber-600">No sections found for this batch. Add one in the Sections page.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Semester</label>
              <select name="semester" value={editFormData.semester} onChange={handleEditInputChange} className="input-field mt-1">
                <option value="">Not set</option>
                {getSemesterOptions(courses.find((course) => course.id === selectedEditCourseId)).map((semester) => (
                  <option key={semester} value={semester}>
                    Semester {semester}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Contact Number</label>
              <input name="contact_number" type="text" value={editFormData.contact_number} onChange={handleEditInputChange} className="input-field mt-1" />
            </div>
          </div>
        </form>
      </Dialog>
  );
};

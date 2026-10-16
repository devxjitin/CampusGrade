"use client";

import { Dialog } from "@/components/ui";
import { TeacherAssignmentsEditor } from "./TeacherAssignmentsEditor";
import type { AdminTeachersModel } from "./useAdminTeachers";

export const EditTeacherDialog = ({ model }: { model: AdminTeachersModel }) => {
  const {
    programs,
    batches,
    sections,
    subjects,
    showEditModal,
    setShowEditModal,
    setEditingTeacherId,
    editFormData,
    setEditFormData,
    editError,
    handleEditSubmit,
    handleEditInputChange
  } = model;
  return (
<Dialog
        open={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingTeacherId(null);
        }}
        title="Edit teacher"
        description="Update identity, contact details, and teaching allocations."
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setShowEditModal(false);
                setEditingTeacherId(null);
              }}
              className="btn btn-outline"
            >
              Cancel
            </button>
            <button type="submit" form="edit-teacher-form" className="btn btn-primary">
              Save changes
            </button>
          </>
        }
      >
        {editError && <div className="mb-4 text-red-600 bg-red-50 p-3 rounded">{editError}</div>}

        <form id="edit-teacher-form" onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input required name="name" type="text" value={editFormData.name} onChange={handleEditInputChange} className="input-field mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Teacher ID</label>
            <input required name="teacher_id" type="text" value={editFormData.teacher_id} onChange={handleEditInputChange} className="input-field mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input required name="email" type="email" value={editFormData.email} onChange={handleEditInputChange} className="input-field mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Designation</label>
            <input name="designation" type="text" value={editFormData.designation} onChange={handleEditInputChange} className="input-field mt-1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Contact Number</label>
            <input name="contact_number" type="text" value={editFormData.contact_number} onChange={handleEditInputChange} className="input-field mt-1" />
          </div>
          <TeacherAssignmentsEditor
            assignments={editFormData.assignments}
            onChange={(assignments) => setEditFormData((current) => ({ ...current, assignments }))}
            programs={programs}
            batches={batches}
            sections={sections}
            subjects={subjects}
          />
        </form>
      </Dialog>
  );
};

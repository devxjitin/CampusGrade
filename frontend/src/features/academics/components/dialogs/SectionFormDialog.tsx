"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Dialog } from "@/components/ui";
import type { AcademicRecord } from "@/features/academics/queries";

export interface SectionForm {
  course_id: string;
  batch_id: string;
  name: string;
}

export const SectionFormDialog = ({
  open,
  editing,
  onClose,
  onSubmit,
  submitting,
  form,
  setForm,
  courses,
  batches,
  onCourseChange,
  getBatchLabel,
}: {
  open: boolean;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
  form: SectionForm;
  setForm: Dispatch<SetStateAction<SectionForm>>;
  courses: AcademicRecord[];
  batches: AcademicRecord[];
  onCourseChange: (courseId: string) => void;
  getBatchLabel: (batch?: AcademicRecord) => string;
}) => (
<Dialog
        open={open}
        onClose={onClose}
        title={editing ? "Edit section" : "Add section"}
        description="Connect the section to the correct program and batch."
        size="sm"
        footer={
          <>
            <button type="button" onClick={onClose} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="section-form" disabled={submitting} className="btn btn-primary">
              {submitting ? "Saving..." : editing ? "Save changes" : "Add section"}
            </button>
          </>
        }
      >
        <form id="section-form" onSubmit={onSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Program</label>
              <select required value={form.course_id} onChange={(e) => onCourseChange(e.target.value)} className="input-field">
                <option value="">-- Select Program --</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id as string}>
                    {String(course.code || "").trim().toUpperCase() || (course.name as string)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Batch</label>
              <select
                required
                value={form.batch_id}
                onChange={(e) => setForm((current) => ({ ...current, batch_id: e.target.value }))}
                className="input-field"
              >
                <option value="">-- Select Batch --</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id as string}>
                    {getBatchLabel(batch)}
                  </option>
                ))}
              </select>
              {form.course_id && batches.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">No batches found for the selected program. Add a batch first.</p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Section Name</label>
              <input
                required
                autoFocus
                type="text"
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                className="input-field"
                placeholder="E.g., A"
              />
            </div>
          </div>
        </form>
      </Dialog>
);


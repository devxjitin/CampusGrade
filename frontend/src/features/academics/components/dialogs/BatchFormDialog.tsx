"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Dialog } from "@/components/ui";
import type { AcademicRecord } from "@/features/academics/queries";

export interface BatchForm {
  course_id: string;
  start_year: number;
  end_year: number;
  name: string;
}

export const BatchFormDialog = ({
  open,
  editing,
  onClose,
  onSubmit,
  submitting,
  form,
  setForm,
  courses,
  formatCourseLabel,
  getAutoEndYear,
  currentYear,
  onNameChange,
  previewLabel,
}: {
  open: boolean;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
  form: BatchForm;
  setForm: Dispatch<SetStateAction<BatchForm>>;
  courses: AcademicRecord[];
  formatCourseLabel: (course: AcademicRecord) => string;
  getAutoEndYear: (startYear: number, courseId: string) => number;
  currentYear: number;
  onNameChange: (value: string) => void;
  previewLabel: string;
}) => (
<Dialog
        open={open}
        onClose={onClose}
        title={editing ? "Edit batch" : "Add batch"}
        description="Create an intake period for the selected program. The end year is calculated from program duration."
        size="sm"
        footer={
          <>
            <button type="button" onClick={onClose} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="batch-form" disabled={submitting} className="btn btn-primary">
              {submitting ? "Saving..." : editing ? "Save changes" : "Add batch"}
            </button>
          </>
        }
      >
        <form id="batch-form" onSubmit={onSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
              <select
                required
                value={form.course_id}
                onChange={(e) => {
                  const selectedCourseId = e.target.value;
                  setForm((current) => ({ ...current, course_id: selectedCourseId, end_year: getAutoEndYear(current.start_year, selectedCourseId) }));
                }}
                className="input-field"
              >
                <option value="">-- Select Program --</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id as string}>
                    {formatCourseLabel(course)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Year</label>
                <input
                  required
                  type="number"
                  min="1900"
                  max="2500"
                  value={form.start_year}
                  onChange={(e) => {
                    const nextStartYear = Number(e.target.value) || currentYear;
                    setForm((current) => ({ ...current, start_year: nextStartYear, end_year: getAutoEndYear(nextStartYear, current.course_id) }));
                  }}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Year (Auto)</label>
                <input type="number" readOnly disabled value={form.end_year} className="input-field disabled:cursor-not-allowed disabled:opacity-70" />
                <p className="mt-1 text-xs text-gray-500">Auto-calculated using start year and program duration.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Custom Label (Optional)</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => onNameChange(e.target.value)}
                className="input-field"
                placeholder="Leave blank to auto-generate"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              Batch label preview: <span className="font-semibold">{previewLabel}</span>
            </div>
          </div>
        </form>
      </Dialog>
);


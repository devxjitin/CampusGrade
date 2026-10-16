"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Dialog } from "@/components/ui";
import type { AcademicRecord } from "@/features/academics/queries";

export interface SubjectForm {
  name: string;
  code: string;
  credits: number | "";
  course_id: string;
  batch_id: string;
  enrollment_type: string;
}

export const SubjectFormDialog = ({
  open,
  editing,
  onClose,
  onSubmit,
  submitting,
  form,
  setForm,
  programs,
  batches,
  onChange,
}: {
  open: boolean;
  editing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
  form: SubjectForm;
  setForm: Dispatch<SetStateAction<SubjectForm>>;
  programs: AcademicRecord[];
  batches: AcademicRecord[];
  onChange: <K extends keyof SubjectForm>(key: K, value: SubjectForm[K]) => void;
}) => (
<Dialog
        open={open}
        onClose={onClose}
        title={editing ? "Edit course" : "Add course"}
        description="Define the course, enrollment policy, program, batch, and credits."
        size="md"
        footer={
          <>
            <button type="button" onClick={onClose} className="btn btn-outline">
              Cancel
            </button>
            <button type="submit" form="course-form" disabled={submitting} className="btn btn-primary">
              {submitting ? "Saving..." : editing ? "Save changes" : "Add course"}
            </button>
          </>
        }
      >
        <form id="course-form" onSubmit={onSubmit}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Course Name</label>
              <input
                required
                autoFocus
                type="text"
                value={form.name}
                onChange={(e) => onChange("name", e.target.value)}
                className="input-field"
                placeholder="E.g., Operating Systems"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Course Code</label>
              <input
                required
                type="text"
                value={form.code}
                onChange={(e) => onChange("code", e.target.value.toUpperCase())}
                className="input-field"
                placeholder="E.g., CS301"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Program</label>
              <select
                value={form.course_id}
                onChange={(e) => setForm((current) => ({ ...current, course_id: e.target.value, batch_id: "" }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900"
              >
                <option value="">Select program</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id as string}>
                    {program.name as string}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Batch</label>
              <select
                value={form.batch_id}
                disabled={!form.course_id}
                onChange={(e) => onChange("batch_id", e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 disabled:opacity-50"
              >
                <option value="">All batches in program</option>
                {batches
                  .filter((batch) => batch.course_id === form.course_id)
                  .map((batch) => (
                    <option key={batch.id} value={batch.id as string}>
                      {(batch.label as string) || `${batch.start_year} - ${batch.end_year}`}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Enrollment</label>
              <select
                value={form.enrollment_type}
                onChange={(e) => onChange("enrollment_type", e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900"
              >
                <option value="compulsory">Compulsory (automatic enrollment)</option>
                <option value="optional">Optional (student self-enrolls)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Credit</label>
              <input
                required
                type="number"
                min="1"
                max="20"
                value={form.credits}
                onChange={(e) => {
                  const nextValue = parseInt(e.target.value, 10);
                  onChange("credits", Number.isNaN(nextValue) ? "" : nextValue);
                }}
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-2 text-gray-900 focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </form>
      </Dialog>
);


"use client";

import { batchLabel, emptyAssignment, type AcademicItem, type Assignment } from "./shared";

export const TeacherAssignmentsEditor = ({
  assignments,
  onChange,
  programs,
  batches,
  sections,
  subjects,
}: {
  assignments: Assignment[];
  onChange: (assignments: Assignment[]) => void;
  programs: AcademicItem[];
  batches: AcademicItem[];
  sections: AcademicItem[];
  subjects: AcademicItem[];
}) => {
  const updateAssignment = (index: number, changes: Partial<Assignment>) =>
    onChange(assignments.map((assignment, rowIndex) => (rowIndex === index ? { ...assignment, ...changes } : assignment)));
  const addAssignment = () => onChange([...assignments, emptyAssignment()]);
  const removeAssignment = (index: number) => onChange(assignments.filter((_, rowIndex) => rowIndex !== index));

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-800">Teaching assignments</h4>
          <p className="text-xs text-slate-500">Select the complete academic scope and one or more subjects for each assignment.</p>
        </div>
        <button type="button" onClick={addAssignment} className="btn btn-outline text-sm">
          Add assignment
        </button>
      </div>
      <div className="space-y-4">
        {assignments.map((assignment, index) => {
          const rowBatches = batches.filter((batch) => batch.course_id === assignment.program_id);
          const rowSections = sections.filter((section) => section.course_id === assignment.program_id && section.batch_id === assignment.batch_id);
          const rowSubjects = subjects.filter(
            (subject) =>
              (!subject.course_id || subject.course_id === assignment.program_id) &&
              (!subject.batch_id || subject.batch_id === assignment.batch_id),
          );
          return (
            <div key={index} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Assignment {index + 1}</span>
                {assignments.length > 1 && (
                  <button type="button" onClick={() => removeAssignment(index)} className="text-sm font-medium text-red-600 hover:text-red-700">
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  Program
                  <select
                    required
                    value={assignment.program_id}
                    onChange={(event) => {
                      updateAssignment(index, {
                        program_id: event.target.value,
                        batch_id: "",
                        section_id: "",
                        subject_ids: [],
                      });
                    }}
                    className="input-field mt-1 w-full"
                  >
                    <option value="">Select program</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.display_name || program.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Batch
                  <select
                    required
                    disabled={!assignment.program_id}
                    value={assignment.batch_id}
                    onChange={(event) => updateAssignment(index, { batch_id: event.target.value, section_id: "", subject_ids: [] })}
                    className="input-field mt-1 w-full disabled:opacity-60"
                  >
                    <option value="">{assignment.program_id ? "Select batch" : "Select program first"}</option>
                    {rowBatches.map((batch) => (
                      <option key={batch.id} value={batch.id}>
                        {batchLabel(batch)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Section
                  <select
                    required
                    disabled={!assignment.batch_id}
                    value={assignment.section_id}
                    onChange={(event) => updateAssignment(index, { section_id: event.target.value })}
                    className="input-field mt-1 w-full disabled:opacity-60"
                  >
                    <option value="">{assignment.batch_id ? "Select section" : "Select batch first"}</option>
                    {rowSections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700 md:col-span-2">
                  Subjects
                  <select
                    required
                    multiple
                    size={4}
                    disabled={!assignment.batch_id}
                    value={assignment.subject_ids}
                    onChange={(event) => updateAssignment(index, { subject_ids: Array.from(event.target.selectedOptions, (option) => option.value) })}
                    className="input-field mt-1 w-full disabled:opacity-60"
                  >
                    {rowSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.code ? `${subject.name} (${subject.code})` : subject.name}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-slate-500">Hold Ctrl/Cmd to select multiple subjects.</span>
                </label>
              </div>
              {assignment.program_id && rowSubjects.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">No subjects are available for this program scope.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};


"use client";

import type { CreateAssignmentModel } from "./useCreateAssignment";

export const ContextPanel = ({ model }: { model: CreateAssignmentModel }) => {
  const { tab, form, contextOptions, contextLoaded, contextReady, contextLabel, selectedProgram, selectedBatch, selectedSection, setContextLevel } = model;
  if (tab !== "context") return null;
  if (contextLoaded && contextOptions.length === 0) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <strong className="block">No classes allocated to you</strong>
        You can create assignments only for the program, batch, section and subject an administrator has allocated to you. Ask an administrator to add an allocation.
      </div>
    );
  }
  const fields: [string, "program" | "batch" | "section" | "subject", string, { id: string; name: string }[], boolean][] = [
    ["Program", "program", form.target_course_id, contextOptions, true],
    ["Batch", "batch", form.target_batch_id, selectedProgram?.batches ?? [], Boolean(selectedProgram)],
    ["Section", "section", form.target_section_id, selectedBatch?.sections ?? [], Boolean(selectedBatch)],
    ["Subject", "subject", form.subject_id, selectedSection?.subjects ?? [], Boolean(selectedSection)],
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h2 className="font-bold">Choose the class and subject</h2>
        <p className="mt-1 text-sm text-slate-500">Select these first. Everything else, including the AI assistant, unlocks after all four are chosen.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {fields.map(([label, level, value, options, enabled], index) => (
          <label key={level}>
            <span className="ui-field-label">
              {index + 1}. {label}
            </span>
            <select className="input-field mt-1.5" value={value} disabled={!enabled || !contextLoaded} onChange={(e) => void setContextLevel(level, e.target.value)}>
              <option value="">{contextLoaded ? `Select ${label.toLowerCase()}` : "Loading…"}</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {contextReady && (
        <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700" role="status">
          {contextLabel}
        </p>
      )}
    </div>
  );
};

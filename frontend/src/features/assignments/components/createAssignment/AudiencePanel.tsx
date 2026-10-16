"use client";

import type { CreateAssignmentModel } from "./useCreateAssignment";
import DateTimeFields from "@/components/DateTimeFields";

export const AudiencePanel = ({ model }: { model: CreateAssignmentModel }) => {
  const {
    form,
    setForm,
    tab,
    selectedKey,
    programs,
    subjects,
  } = model;
  return <>{tab === "audience" && (
          <div className="grid gap-5 md:grid-cols-2">
            <label>
              <span className="ui-field-label">Program, batch & section</span>
              <select
                className="input-field mt-1.5"
                value={selectedKey}
                onChange={(e) => {
                  const item = programs.find((x) => `${x.program_id || x.course_id}|${x.batch_id || ""}|${x.section_id || ""}` === e.target.value);
                  setForm({
                    ...form,
                    target_course_id: item?.program_id || item?.course_id || "",
                    target_batch_id: item?.batch_id || "",
                    target_section_id: item?.section_id || "",
                    subject: "",
                    subject_id: "",
                  });
                }}
              >
                <option value="||">Select audience</option>
                {programs.map((x) => {
                  const key = `${x.program_id || x.course_id}|${x.batch_id || ""}|${x.section_id || ""}`;
                  return (
                    <option key={key} value={key}>
                      {[x.program || x.course, x.batch, x.section].filter(Boolean).join(" · ")}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span className="ui-field-label">Course</span>
              <select
                className="input-field mt-1.5"
                value={form.subject_id}
                onChange={(e) => {
                  const selected = subjects.find((item) => item.id === e.target.value);
                  setForm({ ...form, subject_id: e.target.value, subject: selected?.name || "" });
                }}
              >
                <option value="">Select course</option>
                {subjects.map((x) => (
                  <option key={`${x.id}:${x.name}`} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <DateTimeFields label="Opening date and time" value={form.opens_at} onChange={(value) => setForm({ ...form, opens_at: value })} />
            <DateTimeFields label="Deadline date and time" value={form.due_at} required onChange={(value) => setForm({ ...form, due_at: value })} />
            <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <strong className="block">Hard submission deadline</strong>
              Student repository submissions and updates stop exactly at the deadline. Late work is not accepted.
            </div>
          </div>
        )}</>;
};

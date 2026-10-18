"use client";

import type { CreateAssignmentModel } from "./useCreateAssignment";
import DateTimeFields from "@/components/DateTimeFields";

export const AudiencePanel = ({ model }: { model: CreateAssignmentModel }) => {
  const { form, setForm, tab } = model;
  return <>{tab === "audience" && (
          <div className="grid gap-5 md:grid-cols-2">
            <DateTimeFields label="Opening date and time" value={form.opens_at} onChange={(value) => setForm({ ...form, opens_at: value })} />
            <DateTimeFields label="Deadline date and time" value={form.due_at} required onChange={(value) => setForm({ ...form, due_at: value })} />
            <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <strong className="block">Hard submission deadline</strong>
              Student repository submissions and updates stop exactly at the deadline. Late work is not accepted.
            </div>
          </div>
        )}</>;
};

"use client";

import WrapInput from "@/components/ui/WrapInput";
import type { CreateAssignmentModel } from "./useCreateAssignment";
import { InstructionsField } from "./InstructionsField";

export const BasicsPanel = ({ model }: { model: CreateAssignmentModel }) => {
  const {
    form,
    setForm,
    tab,
    tagsInput,
    setTagsInput,
    learningOutcomesInput,
    setLearningOutcomesInput,
  } = model;
  return <>{tab === "basics" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="lg:col-span-2">
              <span className="ui-field-label">Assignment title</span>
              <WrapInput rows={2} className="input-field mt-1.5" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Full-stack task tracker" />
            </label>
            <label className="lg:col-span-2">
              <span className="ui-field-label">Short description</span>
              <textarea className="input-field mt-1.5 resize-none" rows={3} maxLength={500} value={form.short_description} onChange={(e) => setForm({ ...form, short_description: e.target.value })} placeholder="A concise summary students can scan from their dashboard" />
            </label>
            <label>
              <span className="ui-field-label">Total marks</span>
              <input type="number" min="1" className="input-field mt-1.5" value={form.total_marks} onChange={(e) => setForm({ ...form, total_marks: Number(e.target.value) })} />
            </label>
            <label>
              <span className="ui-field-label">Difficulty</span>
              <select className="input-field mt-1.5" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              <span className="ui-field-label">Tags (comma separated)</span>
              <WrapInput rows={3} className="input-field mt-1.5" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="React, REST API, testing" />
            </label>
            <label>
              <span className="ui-field-label">Learning outcomes (comma separated)</span>
              <WrapInput rows={3} className="input-field mt-1.5" value={learningOutcomesInput} onChange={(e) => setLearningOutcomesInput(e.target.value)} placeholder="Design APIs, document decisions" />
            </label>
            <InstructionsField value={form.instructions} onChange={(value) => setForm({ ...form, instructions: value })} />
          </div>
        )}</>;
};

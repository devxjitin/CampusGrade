"use client";

import { Copy, Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui";
import type { CreateAssignmentModel } from "./useCreateAssignment";
import { toAssignmentDifficulty } from "./shared";

export const AIStudioDialog = ({ model }: { model: CreateAssignmentModel }) => {
  const {
    form,
    selectedKey,
    programs,
    subjects,
    selectedProgram,
    selectAiAudience,
    selectAiCourse,
    showAiStudio,
    setShowAiStudio,
    generatingAI,
    importingProposal,
    aiPrompt,
    setAiPrompt,
    aiInstructions,
    setAiInstructions,
    aiTotalMarks,
    setAiTotalMarks,
    aiRubricCount,
    setAiRubricCount,
    aiDifficulty,
    setAiDifficulty,
    aiRequireReadme,
    setAiRequireReadme,
    generateWithAI,
    externalPrompt,
    copyExternalPrompt,
    externalJson,
    setExternalJson,
    importExternalProposalJson,
    aiPreview,
    applyAIPreview,
  } = model;
  return <><Dialog open={showAiStudio} onClose={() => !generatingAI && !importingProposal && setShowAiStudio(false)} title="External AI assistant" size="xl">
        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <label className="block">
              <span className="ui-field-label">Assignment brief</span>
              <textarea className="input-field mt-1.5 min-h-32" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Describe the assignment objective, required technology, deliverables, and learning outcomes." />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="ui-field-label">Program, batch & section</span>
                <select className="input-field mt-1.5" value={selectedKey} onChange={(event) => selectAiAudience(event.target.value)}>
                  <option value="||">Select program</option>
                  {programs.map((item) => {
                    const key = `${item.program_id || item.course_id}|${item.batch_id || ""}|${item.section_id || ""}`;
                    return (
                      <option key={key} value={key}>
                        {[item.program || item.course, item.batch, item.section].filter(Boolean).join(" · ")}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block">
                <span className="ui-field-label">Course</span>
                <select className="input-field mt-1.5" value={form.subject_id} onChange={(event) => selectAiCourse(event.target.value)} disabled={!selectedProgram}>
                  <option value="">Select course</option>
                  {subjects.map((item) => (
                    <option key={`${item.id}:${item.name}`} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="ui-field-label">Total marks</span>
                <input type="number" min="1" max="10000" className="input-field mt-1.5" value={aiTotalMarks} onChange={(event) => setAiTotalMarks(Number(event.target.value))} />
              </label>
              <label className="block">
                <span className="ui-field-label">Rubric criteria</span>
                <input type="number" min="1" max="20" className="input-field mt-1.5" value={aiRubricCount} onChange={(event) => setAiRubricCount(Number(event.target.value))} />
              </label>
              <label className="block">
                <span className="ui-field-label">Difficulty</span>
                <select className="input-field mt-1.5" value={aiDifficulty} onChange={(event) => setAiDifficulty(toAssignmentDifficulty(event.target.value))}>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={aiRequireReadme} onChange={(event) => setAiRequireReadme(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
              Include a README requirement
            </label>
            <label className="block">
              <span className="ui-field-label">Generation guidance</span>
              <textarea className="input-field mt-1.5 min-h-24" value={aiInstructions} onChange={(event) => setAiInstructions(event.target.value)} placeholder="Specify delivery standards, technical requirements, or assessment constraints." />
            </label>
            <button type="button" className="btn btn-primary w-full" disabled={generatingAI || !aiPrompt.trim()} onClick={generateWithAI}>
              <Sparkles className="h-4 w-4" />
              {generatingAI ? "Preparing prompt…" : "Generate and copy prompt"}
            </button>
          </div>
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-sm font-bold text-slate-900">1. Use External AI</p>
            <button type="button" className="btn btn-outline w-full" disabled={!externalPrompt} onClick={copyExternalPrompt}>
              <Copy className="h-4 w-4" />
              Copy external-AI prompt
            </button>
            <div className="border-t border-slate-200 pt-4">
              <p className="text-sm font-bold text-slate-900">2. Paste External AI JSON</p>
              <textarea className="input-field mt-3 min-h-44 font-mono text-xs leading-5" value={externalJson} onChange={(event) => setExternalJson(event.target.value)} placeholder={'{"title":"Assignment title","rubric":[...]}'} />
              <button type="button" className="btn btn-primary mt-3 w-full" disabled={importingProposal || !externalJson.trim()} onClick={importExternalProposalJson}>
                {importingProposal ? "Validating JSON…" : "Validate pasted JSON"}
              </button>
            </div>
            {aiPreview && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Validated proposal</span>
                <p className="mt-2 font-bold text-slate-900">{aiPreview.title}</p>
                <p className="mt-1 text-sm text-slate-600">{aiPreview.short_description}</p>
                <button type="button" className="btn btn-primary mt-4 w-full" onClick={applyAIPreview}>
                  Apply proposal to assignment
                </button>
              </div>
            )}
          </div>
        </div>
      </Dialog></>;
};

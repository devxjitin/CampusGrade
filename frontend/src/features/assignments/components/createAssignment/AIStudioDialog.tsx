"use client";

import { Copy, Sparkles } from "lucide-react";
import { Dialog } from "@/components/ui";
import Stepper from "@/components/bulkExternalEvaluation/Stepper";
import ProblemList from "@/components/bulkExternalEvaluation/ProblemList";
import MarkdownPreview from "@/components/MarkdownPreview";
import type { CreateAssignmentModel } from "./useCreateAssignment";
import { toAssignmentDifficulty, type AnyRecord } from "./shared";

const AI_STEPS = ["Brief", "Copy prompt", "Paste JSON", "Review & apply"] as const;
const JSON_PLACEHOLDER = '{"title":"Assignment title","rubric":[...]}';

export const AIStudioDialog = ({ model }: { model: CreateAssignmentModel }) => {
  const {
    contextLabel,
    form,
    showAiStudio,
    setShowAiStudio,
    generatingAI,
    importingProposal,
    aiStep,
    setAiStep,
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
    aiProblems,
    aiWarnings,
    applyAIPreview,
  } = model;
  const existingDraft = Boolean(form.title?.trim() || form.instructions?.trim());
  const reachable = aiPreview ? 3 : externalPrompt ? 2 : 0;
  return (
    <Dialog open={showAiStudio} onClose={() => !generatingAI && !importingProposal && setShowAiStudio(false)} title="External AI assistant" size="xl">
      <div className="space-y-5">
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">{contextLabel}</p>
        <Stepper current={aiStep} onSelect={setAiStep} reachable={reachable} steps={AI_STEPS} label="AI assistant steps" />

        {aiStep === 0 && (
          <section aria-labelledby="ai-step-brief" className="space-y-5">
            <h3 id="ai-step-brief" className="text-lg font-bold">
              Describe the assignment
            </h3>
            <label className="block">
              <span className="ui-field-label">Assignment brief</span>
              <textarea className="input-field mt-1.5 min-h-32" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} placeholder="Describe the assignment objective, required technology, deliverables, and learning outcomes." />
            </label>
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
          </section>
        )}

        {aiStep === 1 && (
          <section aria-labelledby="ai-step-prompt" className="space-y-4">
            <h3 id="ai-step-prompt" className="text-lg font-bold">
              Copy the prompt into your AI tool
            </h3>
            <p className="text-sm text-slate-600">Paste it into the external AI service you use. It must reply with one JSON object only.</p>
            <textarea readOnly aria-label="Prompt for the external AI" className="input-field min-h-64 font-mono text-xs leading-5" value={externalPrompt} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setAiStep(0)}>
                Back to brief
              </button>
              <button type="button" className="btn btn-outline" onClick={copyExternalPrompt}>
                <Copy className="h-4 w-4" />
                Copy prompt
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setAiStep(2)}>
                I have the JSON reply
              </button>
            </div>
          </section>
        )}

        {aiStep === 2 && (
          <section aria-labelledby="ai-step-json" className="space-y-4">
            <h3 id="ai-step-json" className="text-lg font-bold">
              Paste the JSON reply
            </h3>
            <textarea aria-label="JSON reply from the external AI" className="input-field min-h-64 font-mono text-xs leading-5" value={externalJson} onChange={(event) => setExternalJson(event.target.value)} placeholder={JSON_PLACEHOLDER} />
            <ProblemList problems={aiProblems} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setAiStep(1)}>
                Back to prompt
              </button>
              <button type="button" className="btn btn-primary" disabled={importingProposal || !externalJson.trim()} onClick={importExternalProposalJson}>
                {importingProposal ? "Validating JSON…" : "Validate pasted JSON"}
              </button>
            </div>
          </section>
        )}

        {aiStep === 3 && aiPreview && (
          <section aria-labelledby="ai-step-review" className="space-y-4">
            <h3 id="ai-step-review" className="text-lg font-bold">
              Review the proposal
            </h3>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Validated proposal</span>
              <p className="mt-2 font-bold text-slate-900">{aiPreview.title}</p>
              <p className="mt-1 text-sm text-slate-600">{aiPreview.short_description}</p>
            </div>
            {aiWarnings.length > 0 && (
              <ul className="list-disc space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 pl-8 text-sm text-amber-900">
                {aiWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {existingDraft && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                Applying replaces your current title, description, instructions and rubric ({form.rubric.length} criteria, {form.total_marks} marks).
              </p>
            )}
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 text-sm">
              {(aiPreview.rubric as AnyRecord[]).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 p-3">
                  <span>
                    <strong className="block">{item.title}</strong>
                    <span className="text-slate-600">{item.description}</span>
                  </span>
                  <span className="shrink-0 font-bold">{item.max_marks}</span>
                </li>
              ))}
            </ul>
            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 p-4">
              <MarkdownPreview source={aiPreview.instructions} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setAiStep(2)}>
                Back to JSON
              </button>
              <button type="button" className="btn btn-primary" onClick={applyAIPreview}>
                Apply proposal to assignment
              </button>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
};

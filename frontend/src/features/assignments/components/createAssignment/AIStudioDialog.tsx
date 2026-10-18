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
    startWithOwnJson,
    draftToken,
    aiWarnings,
    applyAIPreview,
  } = model;
  const existingDraft = Boolean(form.title?.trim() || form.instructions?.trim());
  const reachable = aiPreview ? 3 : 2;
  return (
    <Dialog
      open={showAiStudio}
      onClose={() => !generatingAI && !importingProposal && setShowAiStudio(false)}
      title="External AI assistant"
      size="xl"
      footer={
        aiStep === 3 && aiPreview ? (
          <>
            <button type="button" className="btn btn-outline" onClick={() => setAiStep(2)}>
              Back to JSON
            </button>
            <button type="button" className="btn btn-primary" onClick={applyAIPreview}>
              Apply proposal to assignment
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">{contextLabel}</p>
        <Stepper current={aiStep} onSelect={(index) => (index === 1 && !externalPrompt ? undefined : index === 2 && !externalPrompt ? startWithOwnJson() : setAiStep(index))} reachable={reachable} steps={AI_STEPS} label="AI assistant steps" />

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
            <p className="text-center text-sm text-slate-600">
              Already have the assignment JSON?{" "}
              <button type="button" className="font-semibold text-primary-700 underline" onClick={startWithOwnJson}>
                Skip the brief and paste it
              </button>
            </p>
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
            <p className="text-sm text-slate-600">
              {draftToken
                ? "This reply must answer the prompt you copied: marks, number of criteria, difficulty and draft_ref have to match it."
                : "Using your own JSON: total marks, number of criteria, difficulty and README rule are taken from it. Criteria marks must add up to total_marks."}
            </p>
            <textarea aria-label="JSON reply from the external AI" className="input-field min-h-64 font-mono text-xs leading-5" value={externalJson} onChange={(event) => setExternalJson(event.target.value)} placeholder={JSON_PLACEHOLDER} />
            <ProblemList problems={aiProblems} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-outline" onClick={() => setAiStep(draftToken ? 1 : 0)}>
                {draftToken ? "Back to prompt" : "Back to brief"}
              </button>
              <button type="button" className="btn btn-primary" disabled={importingProposal || !externalJson.trim()} onClick={importExternalProposalJson}>
                {importingProposal ? "Validating JSON…" : "Validate pasted JSON"}
              </button>
            </div>
          </section>
        )}

        {aiStep === 3 && aiPreview && (
          <section aria-labelledby="ai-step-review" className="space-y-3">
            <h3 id="ai-step-review" className="sr-only">
              Review the proposal
            </h3>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="min-w-0">
                <p className="font-bold text-slate-900 [overflow-wrap:anywhere]">{aiPreview.title}</p>
                <p className="mt-0.5 text-sm text-slate-600 [overflow-wrap:anywhere]">{aiPreview.short_description}</p>
              </div>
              <span className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                Validated · {(aiPreview.rubric as AnyRecord[]).length} criteria · {aiPreview.total_marks} marks
              </span>
            </div>
            {(aiWarnings.length > 0 || existingDraft) && (
              <ul className="list-disc space-y-0.5 rounded-xl border border-amber-200 bg-amber-50 py-2 pl-8 pr-4 text-xs text-amber-900">
                {aiWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
                {existingDraft && (
                  <li>
                    Applying replaces your current title, description, instructions and rubric ({form.rubric.length} criteria, {form.total_marks} marks).
                  </li>
                )}
              </ul>
            )}
            <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
              <ul aria-label="Rubric" tabIndex={0} className="max-h-[42vh] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 text-sm">
                {(aiPreview.rubric as AnyRecord[]).map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <strong className="block [overflow-wrap:anywhere]">{item.title}</strong>
                      <span className="text-slate-600 [overflow-wrap:anywhere]">{item.description}</span>
                    </span>
                    <span className="shrink-0 font-bold">{item.max_marks}</span>
                  </li>
                ))}
              </ul>
              <div role="region" aria-label="Instructions preview" tabIndex={0} className="max-h-[42vh] overflow-y-auto rounded-xl border border-slate-200 p-4">
                <MarkdownPreview source={aiPreview.instructions} />
              </div>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
};

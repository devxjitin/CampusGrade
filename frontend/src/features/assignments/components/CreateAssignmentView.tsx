"use client";

// Ported from frontend-legacy/src/pages/CreateAssignment.jsx. Used by both
// /assignments/create (no id param -> editing=false) and
// /assignments/[id]/edit (id param present -> editing=true).
import { CheckCircle2, ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui";
import DateTimeFields from "@/components/DateTimeFields";
import MarkdownPreview from "@/components/MarkdownPreview";
import { TABS, toAssignmentDifficulty, type AnyRecord } from "./createAssignment/shared";
import { useCreateAssignment } from "./createAssignment/useCreateAssignment";
import { AIStudioDialog } from "./createAssignment/AIStudioDialog";
import { AudiencePanel } from "./createAssignment/AudiencePanel";
import { BasicsPanel } from "./createAssignment/BasicsPanel";
import { ResourcesPanel } from "./createAssignment/ResourcesPanel";

export default function CreateAssignmentView() {
  const model = useCreateAssignment();
  const {
    user,
    editing,
    form,
    setForm,
    tab,
    saving,
    attachments,
    pendingFiles,
    setAiTotalMarks,
    setAiRubricCount,
    setAiDifficulty,
    setAiRequireReadme,
    setShowAiStudio,
    router,
    rubricTotal,
    issues,
    goToTab,
    isScheduled,
    save,
    tabIndex
  } = model;

  if (!user) return null;

  return (
    <>
      <PageHeader
        eyebrow="Teacher workspace"
        title={editing ? "Edit assignment" : "Create assignment"}
        description="Define the audience, schedule, rubric, and resources without one long form."
        actions={
          !editing && (
            <button
              type="button"
              onClick={() => {
                setAiTotalMarks(Number(form.total_marks) || 20);
                setAiRubricCount(Math.max(1, form.rubric.length || 5));
                setAiDifficulty(toAssignmentDifficulty(form.difficulty));
                setAiRequireReadme(form.repository_requirements?.require_readme !== false);
                setShowAiStudio(true);
              }}
              className="btn btn-outline"
            >
              <Sparkles className="h-4 w-4" />
              AI assignment assistant
            </button>
          )
        }
      />
      <div className="mb-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-1">
          {TABS.map(([key, label, Icon], index) => (
            <button key={key} onClick={() => goToTab(key)} className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${tab === key ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" />
              <span>
                {index + 1}. {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <section className="card min-h-[430px] p-6">
        <BasicsPanel model={model} />
        <AudiencePanel model={model} />
        {tab === "rubric" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold">Grading rubric</h2>
                <p className={`text-sm ${rubricTotal === Number(form.total_marks) ? "text-emerald-700" : "text-rose-600"}`}>
                  {rubricTotal} of {form.total_marks} marks allocated
                </p>
              </div>
              <button onClick={() => setForm({ ...form, rubric: [...form.rubric, { id: crypto.randomUUID(), title: "", description: "", max_marks: 0 }] })} className="btn btn-outline">
                <Plus className="h-4 w-4" />
                Add criterion
              </button>
            </div>
            <div className="space-y-3">
              {form.rubric.map((item: AnyRecord, index: number) => (
                <div key={item.id} className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_2fr_130px_auto]">
                  <input
                    className="input-field"
                    value={item.title}
                    onChange={(e) => setForm({ ...form, rubric: form.rubric.map((x: AnyRecord, i: number) => (i === index ? { ...x, title: e.target.value } : x)) })}
                    placeholder="Criterion"
                  />
                  <input
                    className="input-field"
                    value={item.description}
                    onChange={(e) => setForm({ ...form, rubric: form.rubric.map((x: AnyRecord, i: number) => (i === index ? { ...x, description: e.target.value } : x)) })}
                    placeholder="What earns marks?"
                  />
                  <input
                    type="number"
                    min="0"
                    className="input-field"
                    value={item.max_marks}
                    onChange={(e) => setForm({ ...form, rubric: form.rubric.map((x: AnyRecord, i: number) => (i === index ? { ...x, max_marks: Number(e.target.value) } : x)) })}
                  />
                  <button onClick={() => setForm({ ...form, rubric: form.rubric.filter((_: AnyRecord, i: number) => i !== index) })} className="ui-icon-button text-rose-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "results" && (
          <div className="mx-auto max-w-3xl">
            <div className="mb-5">
              <h2 className="font-bold">Choose when students receive results</h2>
              <p className="mt-1 text-sm text-slate-500">Results can never be released before the assignment deadline.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ["manual", "Manual release", "Publish one student or the full class when grading is complete."],
                  ["scheduled", "Scheduled release", "Publish automatically at the selected time once every eligible student is graded or marked missing."],
                ] as [string, string, string][]
              ).map(([value, label, description]) => (
                <label key={value} className={`cursor-pointer rounded-xl border p-5 ${form.result_release_mode === value ? "border-primary-500 bg-primary-50" : "border-slate-200"}`}>
                  <input
                    className="sr-only"
                    type="radio"
                    name="result_release_mode"
                    value={value}
                    checked={form.result_release_mode === value}
                    onChange={(e) => setForm({ ...form, result_release_mode: e.target.value, result_release_at: e.target.value === "manual" ? "" : form.result_release_at })}
                  />
                  <strong className="block">{label}</strong>
                  <span className="mt-2 block text-sm text-slate-500">{description}</span>
                </label>
              ))}
            </div>
            {form.result_release_mode === "scheduled" && (
              <div className="mt-5">
                <DateTimeFields label="Scheduled result release" value={form.result_release_at} min={form.due_at || undefined} required onChange={(value) => setForm({ ...form, result_release_at: value })} />
                <span className="mt-1 block text-xs text-slate-500">If grading is incomplete at this time, release waits until every result is ready.</span>
              </div>
            )}
          </div>
        )}
        <ResourcesPanel model={model} />
        {tab === "review" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <div className="rounded-xl border border-slate-200 p-5">
              <h2 className="text-xl font-bold">{form.title || "Untitled assignment"}</h2>
              <p className="mt-2 text-sm text-slate-500">
                {form.subject || "No course selected"} · {form.total_marks} marks
              </p>
              <div className="mt-5">
                <MarkdownPreview source={form.instructions} />
              </div>
            </div>
            <aside className="space-y-4">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">Readiness</p>
                {issues.length ? (
                  <ul className="mt-3 space-y-2 text-sm text-rose-600">
                    {issues.map((x) => (
                      <li key={x}>• {x}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm font-semibold text-emerald-700">{isScheduled ? "Ready to schedule" : "Ready to publish live"}</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 p-4 text-sm">
                <p>{form.rubric.length} rubric criteria</p>
                <p className="mt-1">{form.links.length} reference links</p>
                <p className="mt-1">{attachments.length + pendingFiles.length} attachments</p>
                <p className="mt-1 capitalize">
                  Results: {form.result_release_mode}
                  {form.result_release_mode === "scheduled" && form.result_release_at ? ` · ${new Date(form.result_release_at).toLocaleString()}` : ""}
                </p>
              </div>
            </aside>
          </div>
        )}
      </section>
      <AIStudioDialog model={model} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <button onClick={() => router.push("/assignments")} className="btn btn-ghost">
          Cancel
        </button>
        <div className="flex gap-2">
          <button disabled={tabIndex === 0} onClick={() => goToTab(TABS[tabIndex - 1][0])} className="btn btn-outline">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          {tabIndex < TABS.length - 1 && (
            <button onClick={() => goToTab(TABS[tabIndex + 1][0])} className="btn btn-outline">
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          {tab === "review" && (
            <button disabled={saving || issues.length > 0} onClick={save} className="btn btn-primary">
              <CheckCircle2 className="h-4 w-4" />
              {editing ? "Save changes" : isScheduled ? "Schedule assignment" : "Publish live"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

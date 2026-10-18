"use client";

import WrapInput from "@/components/ui/WrapInput";
import { Plus, Trash2, Upload } from "lucide-react";
import { uploadAssignmentAttachment } from "@/features/assignments/api";
import type { CreateAssignmentModel } from "./useCreateAssignment";
import type { AnyRecord } from "./shared";

export const ResourcesPanel = ({ model }: { model: CreateAssignmentModel }) => {
  const {
    form,
    setForm,
    tab,
    requiredFilesInput,
    setRequiredFilesInput,
    attachments,
    setAttachments,
    pendingFiles,
    setPendingFiles,
    uploadProgress,
    setUploadProgress,
    editing,
    id,
    toast,
  } = model;
  return <>{tab === "resources" && (
          <div>
            <div className="mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="ui-field-label">Starter repository (optional)</span>
                <WrapInput rows={2} className="input-field mt-1.5" value={form.starter_repository_url || ""} onChange={(e) => setForm({ ...form, starter_repository_url: e.target.value })} placeholder="https://github.com/organisation/starter-project" />
              </label>
              <label>
                <span className="ui-field-label">Required files (comma separated)</span>
                <WrapInput rows={3} className="input-field mt-1.5" value={requiredFilesInput} onChange={(e) => setRequiredFilesInput(e.target.value)} placeholder="README.md, package.json, tests/" />
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <input
                  type="checkbox"
                  checked={Boolean(form.repository_requirements?.require_readme)}
                  onChange={(e) => setForm({ ...form, repository_requirements: { ...form.repository_requirements, require_readme: e.target.checked } })}
                />
                <span>
                  <strong className="block text-sm">README required</strong>
                  <span className="text-xs text-slate-500">Students must document setup and usage.</span>
                </span>
              </label>
            </div>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold">Links and attachments</h2>
                <p className="text-sm text-slate-500">Add starter repositories, references, briefs, or supporting files.</p>
              </div>
              <button onClick={() => setForm({ ...form, links: [...form.links, { label: "", url: "" }] })} className="btn btn-outline">
                <Plus className="h-4 w-4" />
                Add link
              </button>
            </div>
            <div className="space-y-3">
              {form.links.map((link: AnyRecord, index: number) => (
                <div key={index} className="grid items-start gap-3 md:grid-cols-[1fr_2fr_auto]">
                  <WrapInput rows={1} className="input-field" value={link.label} onChange={(e) => setForm({ ...form, links: form.links.map((x: AnyRecord, i: number) => (i === index ? { ...x, label: e.target.value } : x)) })} placeholder="Link label" />
                  <WrapInput rows={2} className="input-field" value={link.url} onChange={(e) => setForm({ ...form, links: form.links.map((x: AnyRecord, i: number) => (i === index ? { ...x, url: e.target.value } : x)) })} placeholder="https://…" />
                  <button onClick={() => setForm({ ...form, links: form.links.filter((_: AnyRecord, i: number) => i !== index) })} className="ui-icon-button text-rose-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Attachments</h3>
                  <p className="text-xs text-slate-500">Documents are uploaded when you publish the assignment.</p>
                </div>
                <label className="btn btn-outline cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Add documents
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp,.zip"
                    className="hidden"
                    onChange={async (e) => {
                      const files = [...(e.target.files || [])];
                      if (!files.length) return;
                      if (attachments.length + pendingFiles.length + files.length > 10) return toast.error("Maximum 10 attachments are allowed");
                      if (files.some((file) => file.size > 25 * 1024 * 1024)) return toast.error("Each attachment must be 25 MB or smaller");
                      if (!editing) {
                        setPendingFiles([...pendingFiles, ...files]);
                        e.target.value = "";
                        return;
                      }
                      try {
                        const uploaded = [];
                        for (const file of files) {
                          setUploadProgress({ name: file.name, percent: 0 });
                          uploaded.push((await uploadAssignmentAttachment(id!, file, (percent) => setUploadProgress({ name: file.name, percent }))).resource);
                        }
                        setAttachments([...attachments, ...uploaded]);
                        toast.success(`${uploaded.length} attachment(s) uploaded`);
                      } catch (error) {
                        const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
                        toast.error(message || "Upload failed");
                      } finally {
                        setUploadProgress(null);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
              </div>
              {uploadProgress && (
                <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress.percent} aria-label={`Uploading ${uploadProgress.name}`}>
                  <div className="mb-1 flex justify-between text-xs text-slate-600">
                    <span className="[overflow-wrap:anywhere]">{uploadProgress.name}</span>
                    <span>{uploadProgress.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full bg-primary-600 transition-[width]" style={{ width: `${uploadProgress.percent}%` }} />
                  </div>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="mt-4 space-y-2">
                  {attachments.map((x) => (
                    <div key={x.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      {x.filename} · {Math.ceil(x.size_bytes / 1024)} KB
                    </div>
                  ))}
                </div>
              )}
              {pendingFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {pendingFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      <span>{file.name} · queued for upload</span>
                      <button type="button" onClick={() => setPendingFiles(pendingFiles.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}</>;
};

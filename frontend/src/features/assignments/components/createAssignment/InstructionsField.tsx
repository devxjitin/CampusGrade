"use client";

import { useState } from "react";
import { Code2, Eye, Maximize2 } from "lucide-react";
import { Dialog } from "@/components/ui";
import MarkdownPreview from "@/components/MarkdownPreview";

type View = "code" | "preview";

const VIEWS = [
  ["code", "Code", Code2],
  ["preview", "Preview", Eye],
] as const;

const ViewToggle = ({ view, onChange }: { view: View; onChange: (view: View) => void }) => (
  <div role="group" aria-label="Instructions view" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
    {VIEWS.map(([value, label, Icon]) => (
      <button
        key={value}
        type="button"
        aria-pressed={view === value}
        onClick={() => onChange(value)}
        className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${view === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
    ))}
  </div>
);

const Body = ({ view, value, onChange, heightClass, labelId }: { view: View; value: string; onChange: (value: string) => void; heightClass: string; labelId: string }) =>
  view === "code" ? (
    <textarea
      aria-labelledby={labelId}
      className={`input-field mt-1.5 ${heightClass} font-mono text-sm`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={"# Objective\nBuild and document…"}
    />
  ) : (
    <div className={`mt-1.5 ${heightClass} overflow-y-auto rounded-xl border border-slate-200 p-4 pr-3`}>
      <MarkdownPreview source={value} />
    </div>
  );

// A compact editor/preview with a button that opens the same content in a large pop-up, so long instructions do not need page scrolling.
export const InstructionsField = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  const [view, setView] = useState<View>(value?.trim() ? "preview" : "code");
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="ui-field-label" id="instructions-label">
          Instructions (Markdown)
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className="ui-icon-button" onClick={() => setExpanded(true)} aria-label="Open instructions in a large window" title="Open in a large window">
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>
      <Body view={view} value={value} onChange={onChange} heightClass="h-64" labelId="instructions-label" />
      <Dialog
        open={expanded}
        onClose={() => setExpanded(false)}
        title="Instructions"
        size="xl"
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setExpanded(false)}>
            Done
          </button>
        }
      >
        <div className="flex items-center justify-between gap-3">
          <span className="ui-field-label" id="instructions-popup-label">
            Instructions (Markdown)
          </span>
          <ViewToggle view={view} onChange={setView} />
        </div>
        <Body view={view} value={value} onChange={onChange} heightClass="h-[62vh]" labelId="instructions-popup-label" />
      </Dialog>
    </div>
  );
};

"use client";

// Ported from frontend-legacy/src/components/MarkdownPreview.jsx
import { useEffect, useId, useState } from "react";

const inline = (text: unknown) => {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={index} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link)
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline">
          {link[1]}
        </a>
      );
    return part;
  });
};

const MermaidDiagram = ({ chart }: { chart: string }) => {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const diagramId = useId().replace(/:/g, "");

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSvg("");
     
    setError("");

    const renderDiagram = async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "inherit" });
        const result = await mermaid.render(`campusgrade-mermaid-${diagramId}`, chart);
        if (active) setSvg(result.svg);
      } catch {
        if (active) setError("This Mermaid diagram could not be rendered.");
      }
    };

    renderDiagram();
    return () => {
      active = false;
    };
  }, [chart, diagramId]);

  if (error) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{error}</p>;
  }
  if (!svg) {
    return <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">Rendering diagram…</p>;
  }
  return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 [&_svg]:mx-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
};

const codeBlock = (source: string, language: string, key: string) => {
  if (language === "mermaid") return <MermaidDiagram key={key} chart={source} />;
  return (
    <pre key={key} className="overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      <code>{source}</code>
    </pre>
  );
};

export default function MarkdownPreview({ source, emptyText = "Nothing to preview yet." }: { source?: string; emptyText?: string }) {
  const lines = String(source || "").split("\n");
  if (!source?.trim()) return <p className="text-sm text-slate-400">{emptyText}</p>;
  let inCode = false;
  let codeLanguage = "";
  const code: string[] = [];
  const nodes: React.ReactNode[] = [];
  lines.forEach((rawLine, index) => {
    // AI tools sometimes indent a fence or escape its backticks; treat those as a normal fence.
    const line = /^\s*(\\?`){3}/.test(rawLine) ? rawLine.trim().replace(/\\`/g, "`") : rawLine;
    if (line.startsWith("```")) {
      if (inCode) {
        nodes.push(codeBlock(code.join("\n"), codeLanguage, `code-${index}`));
        code.length = 0;
        codeLanguage = "";
      } else {
        codeLanguage = line.slice(3).trim().toLowerCase();
      }
      inCode = !inCode;
      return;
    }
    if (inCode) {
      code.push(rawLine);
      return;
    }
    if (line.startsWith("### "))
      nodes.push(
        <h3 key={index} className="mt-5 text-base font-bold">
          {inline(line.slice(4))}
        </h3>,
      );
    else if (line.startsWith("## "))
      nodes.push(
        <h2 key={index} className="mt-6 text-lg font-bold">
          {inline(line.slice(3))}
        </h2>,
      );
    else if (line.startsWith("# "))
      nodes.push(
        <h1 key={index} className="mt-6 text-xl font-bold">
          {inline(line.slice(2))}
        </h1>,
      );
    else if (/^[-*] /.test(line))
      nodes.push(
        <div key={index} className="flex gap-2">
          <span>•</span>
          <p>{inline(line.slice(2))}</p>
        </div>,
      );
    else if (line.trim())
      nodes.push(
        <p key={index} className="leading-7">
          {inline(line)}
        </p>,
      );
    else nodes.push(<div key={index} className="h-2" />);
  });
  if (code.length) nodes.push(codeBlock(code.join("\n"), codeLanguage, "code-final"));
  return <div className="space-y-2 text-sm text-slate-700">{nodes}</div>;
}

"use client";

// Ported from frontend-legacy/src/components/MarkdownPreview.jsx
import { useEffect, useId, useState } from "react";
import { fenceLanguage } from "@/lib/markdownFence";
import { texToText } from "@/lib/texToText";

// Inline tokens, leftmost wins: `code`, $math$ / $$math$$ / \(math\), **bold**, *italic*, [link](url).
// A `$` only opens math when not followed by a space and the closing `$` is not followed by a digit, so "$5 and $10" stays text.
const INLINE_TOKEN = /`[^`]+`|\$\$[^$]+\$\$|\$(?!\s)[^$\n]*?[^\s$]\$(?!\d)|\\\([^\n]+?\\\)|\*\*(?:[^*]|\*(?!\*))+?\*\*|\*[^*\s](?:[^*]*[^*\s])?\*|\[[^\]]+\]\(https?:\/\/[^)]+\)/g;

const inline = (text: unknown, keyPrefix = "i"): React.ReactNode[] => {
  const source = String(text || "");
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (match.index > last) nodes.push(source.slice(last, match.index));
    last = match.index + token.length;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("$$")) {
      nodes.push(<span key={key} className="italic">{texToText(token.slice(2, -2))}</span>);
    } else if (token.startsWith("$")) {
      nodes.push(<span key={key} className="italic">{texToText(token.slice(1, -1))}</span>);
    } else if (token.startsWith("\\(")) {
      nodes.push(<span key={key} className="italic">{texToText(token.slice(2, -2))}</span>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{inline(token.slice(1, -1), key)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (link)
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline">
            {link[1]}
          </a>,
        );
    }
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
};

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

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
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // AI tools sometimes indent a fence, escape its backticks or use too few of them; see fenceLanguage.
    const fence = fenceLanguage(line);
    if (fence !== null) {
      if (inCode) {
        nodes.push(codeBlock(code.join("\n"), codeLanguage, `code-${index}`));
        code.length = 0;
        codeLanguage = "";
      } else {
        codeLanguage = fence;
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    const key = `b-${index}`;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const className = level === 1 ? "mt-6 text-xl font-bold" : level === 2 ? "mt-6 text-lg font-bold" : level === 3 ? "mt-5 text-base font-bold" : "mt-4 text-sm font-bold";
      nodes.push(
        level === 1 ? (
          <h1 key={key} className={className}>{inline(heading[2], key)}</h1>
        ) : level === 2 ? (
          <h2 key={key} className={className}>{inline(heading[2], key)}</h2>
        ) : level === 3 ? (
          <h3 key={key} className={className}>{inline(heading[2], key)}</h3>
        ) : (
          <h4 key={key} className={className}>{inline(heading[2], key)}</h4>
        ),
      );
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      nodes.push(<hr key={key} className="my-3 border-slate-200" />);
    } else if (line.trim().startsWith("|") && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1])) {
      const header = tableCells(line);
      const rows: string[][] = [];
      let next = index + 2;
      while (next < lines.length && lines[next].trim().startsWith("|")) {
        rows.push(tableCells(lines[next]));
        next += 1;
      }
      nodes.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                {header.map((cell, column) => (
                  <th key={column} className="border border-slate-200 bg-slate-50 px-3 py-2 font-bold">{inline(cell, `${key}-h${column}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, column) => (
                    <td key={column} className="border border-slate-200 px-3 py-2">{inline(cell, `${key}-${rowIndex}-${column}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = next - 1;
    } else if (bullet) {
      nodes.push(
        <div key={key} className="flex gap-2" style={{ paddingLeft: `${Math.min(4, Math.floor(bullet[1].length / 2)) * 1.25}rem` }}>
          <span aria-hidden="true">•</span>
          <p className="leading-7">{inline(bullet[2], key)}</p>
        </div>,
      );
    } else if (ordered) {
      nodes.push(
        <div key={key} className="flex gap-2" style={{ paddingLeft: `${Math.min(4, Math.floor(ordered[1].length / 2)) * 1.25}rem` }}>
          <span className="shrink-0 font-semibold">{ordered[2]}.</span>
          <p className="leading-7">{inline(ordered[3], key)}</p>
        </div>,
      );
    } else if (quote) {
      nodes.push(
        <blockquote key={key} className="border-l-4 border-slate-300 pl-3 text-slate-600">
          {inline(quote[1], key)}
        </blockquote>,
      );
    } else if (line.trim()) {
      nodes.push(
        <p key={key} className="leading-7">
          {inline(line, key)}
        </p>,
      );
    } else nodes.push(<div key={key} className="h-2" />);
  }
  if (code.length) nodes.push(codeBlock(code.join("\n"), codeLanguage, "code-final"));
  return <div className="space-y-2 text-sm text-slate-700">{nodes}</div>;
}

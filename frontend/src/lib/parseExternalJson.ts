/**
 * Parses an external-AI JSON string that may be wrapped in a fenced code
 * block (```json ... ``` or plain ``` ... ```).
 *
 * External AI services (e.g. ChatGPT, Gemini) often wrap their JSON output
 * in a markdown fenced code block. This helper strips the fence before
 * calling JSON.parse so that users can paste either raw JSON or the full
 * fenced block and get the same result.
 *
 * AI tools also commonly emit text that is almost JSON: a backslash that is not
 * a valid escape (`\_`, a Windows path) or a raw line break inside a string. If
 * strict parsing fails, only those string-literal faults are repaired and the
 * parse is retried. Structure and values are never touched, and the server still
 * validates every field.
 *
 * Matches the behavior of the legacy BulkExternalEvaluationDialog.jsx.
 */
const VALID_ESCAPES = '"\\/bfnrtu';

export const repairJsonStrings = (text: string): string => {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      continue;
    }
    if (char === '"') {
      inString = false;
      out += char;
    } else if (char === "\\") {
      const next = text[i + 1];
      if (next !== undefined && VALID_ESCAPES.includes(next) && (next !== "u" || /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)))) {
        out += char + next;
        i += 1;
      } else {
        out += "\\\\";
      }
    } else if (char === "\n") {
      out += "\\n";
    } else if (char === "\r") {
      out += "\\r";
    } else if (char === "\t") {
      out += "\\t";
    } else {
      out += char;
    }
  }
  return out;
};

export const parseExternalJson = (value: string): unknown => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch (error) {
    try {
      return JSON.parse(repairJsonStrings(body));
    } catch {
      throw error;
    }
  }
};

/**
 * Parses an external-AI JSON string that may be wrapped in a fenced code
 * block (```json ... ``` or plain ``` ... ```).
 *
 * External AI services (e.g. ChatGPT, Gemini) often wrap their JSON output
 * in a markdown fenced code block. This helper strips the fence before
 * calling JSON.parse so that users can paste either raw JSON or the full
 * fenced block and get the same result.
 *
 * Matches the behavior of the legacy BulkExternalEvaluationDialog.jsx.
 */
export const parseExternalJson = (value: string): unknown => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
};

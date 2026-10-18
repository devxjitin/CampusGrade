/**
 * Recognises a Markdown code-fence line, tolerating what AI tools produce:
 * indentation, escaped backticks (\`\`\`) and fences with one or two backticks
 * instead of three. A line made only of backticks plus an optional language word
 * is a fence; anything else (including inline code such as `x`) is not.
 *
 * Returns the lower-cased language ("" when none) or null when the line is not a fence.
 */
export const fenceLanguage = (line: string): string | null => {
  const match = line.trim().replace(/\\`/g, "`").match(/^`{1,}\s*([A-Za-z][\w+-]*)?\s*$/);
  return match ? (match[1] ?? "").toLowerCase() : null;
};

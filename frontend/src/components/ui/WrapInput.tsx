"use client";

type WrapInputProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * A text field whose text wraps instead of scrolling sideways.
 *
 * The height is fixed (`rows` lines, 2 by default) so the layout never shifts while typing;
 * longer text scrolls vertically inside the field. Give fields that tend to hold more text
 * (descriptions, lists, URLs) 3 or 4 rows. Like an <input>, it never holds a line break:
 * Enter is ignored and pasted line breaks become spaces.
 */
export default function WrapInput({ className = "", rows = 2, onChange, onKeyDown, ...props }: WrapInputProps) {
  return (
    <textarea
      {...props}
      rows={rows}
      className={`input-field resize-none overflow-y-auto [overflow-wrap:anywhere] ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
        onKeyDown?.(event);
      }}
      onChange={(event) => {
        if (/[\r\n]/.test(event.target.value)) event.target.value = event.target.value.replace(/\s*[\r\n]+\s*/g, " ");
        onChange?.(event);
      }}
    />
  );
}

"use client";

// Ported from frontend-legacy/src/components/DateTimeFields.jsx
import { useEffect, useRef, useState } from "react";

const splitDateTime = (value?: string) => {
  const localValue = String(value || "").replace(" ", "T");
  if (!localValue.includes("T")) return { date: "", time: "" };

  const [date = "", rawTime = ""] = localValue.split("T");
  return { date: date.slice(0, 10), time: rawTime.slice(0, 5) };
};

/**
 * A paired date and time control that preserves the app's existing local
 * YYYY-MM-DDTHH:mm value for API requests.
 */
export default function DateTimeFields({
  value,
  onChange,
  label,
  min,
  required = false,
  disabled = false,
  className = "",
}: {
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  min?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const initial = splitDateTime(value);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const lastValue = useRef(value || "");
  const minimum = splitDateTime(min);

  useEffect(() => {
    const nextValue = value || "";
    if (lastValue.current === nextValue) return;

    const next = splitDateTime(nextValue);
    setDate(next.date);
    setTime(next.time);
    lastValue.current = nextValue;
  }, [value]);

  const updateValue = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    const nextValue = nextDate && nextTime ? `${nextDate}T${nextTime}` : "";
    lastValue.current = nextValue;
    onChange(nextValue);
  };

  return (
    <fieldset className={className}>
      {label && <legend className="ui-field-label">{label}</legend>}
      <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Date</span>
          <input type="date" className="input-field" value={date} min={minimum.date || undefined} required={required} disabled={disabled} onChange={(event) => updateValue(event.target.value, time)} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Time</span>
          <input type="time" className="input-field" value={time} min={date && date === minimum.date ? minimum.time || undefined : undefined} required={required} disabled={disabled} onChange={(event) => updateValue(date, event.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}

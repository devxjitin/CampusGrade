// Ported from frontend-legacy/src/utils/datetime.js
const DEFAULT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const HAS_TIMEZONE_SUFFIX = /([zZ]|[+-]\d{2}:\d{2})$/;

export const parseServerDateTime = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;

  const normalized = HAS_TIMEZONE_SUFFIX.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseLocalDateTimeInput = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateTime = (
  value?: string | Date | null,
  options: Intl.DateTimeFormatOptions = DEFAULT_FORMAT_OPTIONS,
): string => {
  const date = parseServerDateTime(value);
  if (!date) return "Unavailable";
  return date.toLocaleString([], options);
};

export const toLocalInputDateTime = (value?: string | Date | null): string => {
  const date = parseServerDateTime(value);
  if (!date) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

export const toServerDateTime = (value?: string | null): string => {
  const date = parseLocalDateTimeInput(value);
  if (!date) return "";
  return date.toISOString();
};

export const getTimezoneLabel = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "Local timezone";

/** "just now", "2 min ago", "3 h ago", "5 d ago"; falls back to a date for older values. */
export const formatRelativeTime = (value?: string | Date | null, now: Date = new Date()): string => {
  const date = parseServerDateTime(value);
  if (!date) return "never";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDateTime(date, { day: "2-digit", month: "short", year: "numeric" });
};

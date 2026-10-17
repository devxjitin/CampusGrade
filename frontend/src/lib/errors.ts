// Maps the backend's `code` field (core/errors.py, Sprint 1 of
// the original implementation plan) to a friendly, translatable message. This is
// additive — `error.response.data.message`, which every existing page
// already reads (see the interceptor in api.ts), keeps working exactly as
// before whether or not a code is present. New code should prefer
// `getErrorMessage(error)` over reading `.message` directly, since it can
// fall back sensibly when the backend hasn't classified an error yet.
//
// Grows sprint by sprint as core/errors.py adds AppError subclasses —
// each new `code` should get an entry here in the same PR.

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  FORBIDDEN: "You do not have access to do that.",
  NOT_FOUND: "We couldn't find that.",
  CONFLICT: "This changed while you were working on it. Please refresh and try again.",
  INVALID: "Some fields need attention.",
  RATE_LIMITED: "Too many requests — please slow down and try again shortly.",
  UNAVAILABLE: "This service is not ready yet. Please try again in a moment.",
  REQUEST_VALIDATION_FAILED: "Some fields need attention.",
};

export interface BackendErrorBody {
  code?: string;
  title?: string;
  detail?: unknown;
  message?: string;
  request_id?: string;
}

/**
 * Best-effort, human-readable message for an error thrown by `api.ts`.
 * Falls back through: known code -> backend-provided message -> generic text.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const body = (error as { response?: { data?: BackendErrorBody } })?.response?.data;
  if (!body) return fallback;
  if (body.code && ERROR_MESSAGES[body.code]) return ERROR_MESSAGES[body.code];
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.title === "string" && body.title) return body.title;
  return fallback;
}

/** The backend's stable error code, if present — for branching logic (e.g. "was this a 409?"), not display. */
export function getErrorCode(error: unknown): string | null {
  return (error as { response?: { data?: BackendErrorBody } })?.response?.data?.code ?? null;
}

/** The request id the backend attached to this error response — useful in bug reports / support requests. */
export function getErrorRequestId(error: unknown): string | null {
  return (error as { response?: { data?: BackendErrorBody } })?.response?.data?.request_id ?? null;
}

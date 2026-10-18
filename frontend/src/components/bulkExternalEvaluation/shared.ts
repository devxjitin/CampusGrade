// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export const errorMessage = (error: unknown, fallback: string) => {
  const response = (error as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallback;
};

export interface ValidationProblem {
  student: string;
  criterion: string | null;
  path: string;
  message: string;
}

/** The per-field problems the API returns with a 422 for a bad AI response (`errors`), or []. */
export const validationProblems = (error: unknown): ValidationProblem[] => {
  const errors = (error as { response?: { data?: { errors?: unknown } } })?.response?.data?.errors;
  return Array.isArray(errors) ? errors.filter((item): item is ValidationProblem => typeof item?.message === "string") : [];
};

export const downloadText = (text: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};



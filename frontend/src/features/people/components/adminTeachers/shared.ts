export interface Assignment {
  program_id: string;
  batch_id: string;
  section_id: string;
  subject_ids: string[];
}

export interface AcademicItem {
  id: string;
  name?: string;
  display_name?: string;
  course_id?: string;
  batch_id?: string;
  code?: string;
  label?: string;
  start_year?: number;
  end_year?: number;
}

export interface Teacher {
  _id?: string;
  id?: string;
  name: string;
  email: string;
  teacher_id?: string;
  designation?: string;
  contact_number?: string;
  is_active?: boolean;
  evaluation_overdue?: boolean;
  overdue_evaluations?: number;
  assignments?: { program_id?: string; batch_id?: string; section_id?: string; subject_ids?: string[]; program?: string; course?: string; batch?: string; section?: string; subjects?: string[] }[];
}

export interface TeacherForm {
  name: string;
  teacher_id: string;
  email: string;
  designation: string;
  contact_number: string;
  assignments: Assignment[];
}

export interface UploadSummary {
  total_rows: number;
  added: number;
  duplicates: number;
  invalid: number;
}

export interface UploadResult {
  dry_run?: boolean;
  summary?: UploadSummary;
  duplicate_rows?: { row_number: number; reasons?: string[] }[];
  invalid_rows?: { row_number: number; reasons?: string[] }[];
}

export const getApiErrorMessage = (err: unknown, fallbackMessage: string): string => {
  const response = (err as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallbackMessage;
};

export const isDuplicateMessage = (message: unknown) => /already exists|duplicate|unique/i.test(String(message || ""));
export const emptyAssignment = (): Assignment => ({ program_id: "", batch_id: "", section_id: "", subject_ids: [] });
const NAME_ALLOWED_PATTERN = /^[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z'.-]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PATTERN = /^\+?[0-9\s()-]{10,20}$/;
const TEACHER_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export const getTeacherAccountErrors = (formData: TeacherForm): Record<string, string> => {
  const errors: Record<string, string> = {};
  const name = String(formData.name || "").trim();
  const teacherId = String(formData.teacher_id || "").trim();
  const email = String(formData.email || "").trim();
  const contact = String(formData.contact_number || "").trim();
  const contactDigits = contact.replace(/\D/g, "");
  if (name.length < 2) errors.name = "Name must contain at least 2 characters.";
  else if (!NAME_ALLOWED_PATTERN.test(name)) errors.name = "Name contains unsupported characters.";
  if (!teacherId) errors.teacher_id = "Teacher ID is required.";
  else if (!TEACHER_ID_PATTERN.test(teacherId)) errors.teacher_id = "Use letters, numbers, and hyphens only.";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (!CONTACT_PATTERN.test(contact) || contactDigits.length < 10 || contactDigits.length > 15) errors.contact_number = "Contact number must contain 10 to 15 digits.";
  return errors;
};

export const batchLabel = (batch?: AcademicItem) => batch?.label || batch?.display_name || batch?.name || `${batch?.start_year || ""}${batch?.end_year ? ` - ${batch.end_year}` : ""}`;
export const isCompleteAssignment = (assignment: Assignment) =>
  Boolean(assignment.program_id && assignment.batch_id && assignment.section_id && assignment.subject_ids?.length);
export const assignmentSummary = (assignment: Teacher["assignments"] extends (infer T)[] | undefined ? T : never) => {
  if (!assignment) return "No assignment";
  const scope = [assignment.program || assignment.course, assignment.batch, assignment.section].filter(Boolean).join(" · ");
  const courses = Array.isArray(assignment.subjects) ? assignment.subjects.join(", ") : "";
  return [scope, courses].filter(Boolean).join(": ") || "No assignment";
};



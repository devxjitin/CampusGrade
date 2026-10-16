export interface Course {
  id: string;
  name?: string;
  code?: string;
  year?: number;
  duration_years?: number;
  display_name?: string;
}

export interface Batch {
  id: string;
  course_id?: string;
  start_year?: number;
  end_year?: number;
  label?: string;
}

export interface Section {
  id: string;
  name?: string;
  course_id?: string;
  batch_id?: string;
}

export interface Student {
  _id?: string;
  id?: string;
  name: string;
  email: string;
  roll_no?: string;
  course?: string;
  year?: string | number | null;
  semester?: string | number | null;
  batch?: string;
  section_name?: string;
  section_id?: string | null;
  contact_number?: string;
  is_active?: boolean;
}

export interface AddStudentForm {
  name: string;
  email: string;
  roll_no: string;
  course: string;
  batch: string;
  section_id: string;
  semester: string;
  contact_number: string;
}

export interface EditStudentForm {
  name: string;
  email: string;
  roll_no: string;
  course: string;
  year: string | number;
  batch: string;
  section_id: string;
  semester: string;
  contact_number: string;
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

export interface PasswordResetResult {
  temporary_password: string;
  user?: { name?: string };
}

export const buildCourseLabel = (course?: Course) =>
  course?.display_name || (course?.code ? `${course?.name || "Program"} (${course?.code})` : `${course?.name || "Program"}`);
export const getSemesterOptions = (course?: Course) => {
  const durationYears = Number(course?.duration_years) || 4;
  const totalSemesters = Math.max(1, durationYears * 2);
  return Array.from({ length: totalSemesters }, (_, index) => index + 1);
};

export const getApiErrorMessage = (err: unknown, fallbackMessage: string): string => {
  const response = (err as { response?: { data?: { detail?: string; message?: string } } })?.response;
  return response?.data?.detail || response?.data?.message || fallbackMessage;
};

export const isDuplicateMessage = (message: unknown) => /already exists|duplicate|unique/i.test(String(message || ""));
export const getStudentId = (student: Student) => student?._id || student?.id || "";
export const getBatchLabel = (batch?: Batch) => batch?.label || `${batch?.start_year} - ${batch?.end_year}`;
export const normalizeFilterValue = (value: unknown) => String(value || "").trim();
export const matchesExactFilter = (candidate: unknown, activeFilter: string) => !activeFilter || normalizeFilterValue(candidate) === activeFilter;
export const matchesNameFilter = (student: Student, nameFilter: string) => !nameFilter || normalizeFilterValue(student.name).toLowerCase().includes(nameFilter.toLowerCase());
export const uniqueSorted = (values: unknown[]) => Array.from(new Set(values.map((value) => normalizeFilterValue(value)).filter(Boolean))).sort((a, b) => a.localeCompare(b));

export const NAME_ALLOWED_PATTERN = /^[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z'.-]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PATTERN = /^\+?[0-9\s()-]{10,15}$/;

// Sentinel for "admit into a new intake year" — the app resolves (or
// creates) the matching batch server-side instead of the admin having to
// know which batch id is "this year's". See
// PLAN_ACADEMIC_SESSIONS_AND_BATCHES.md Part 3.
export const NEW_BATCH_SENTINEL = "__new_admission_year__";

export const getAddStudentFieldErrors = ({
  formData,
  selectedCourseId,
  selectedAddBatchId,
  addCourseSections,
  admissionYear,
}: {
  formData: AddStudentForm;
  selectedCourseId: string;
  selectedAddBatchId: string;
  addCourseSections: Section[];
  admissionYear: string;
}): Record<string, string> => {
  const errors: Record<string, string> = {};
  const normalizedName = String(formData.name || "").trim();
  const normalizedEmail = String(formData.email || "").trim();
  const normalizedRollNo = String(formData.roll_no || "").trim();
  const rollNoDigits = normalizedRollNo.replace(/\D/g, "");
  const normalizedContact = String(formData.contact_number || "").trim();

  if (!normalizedName) errors.name = "Name is required.";
  else if (normalizedName.length < 5) errors.name = "Name must be at least 5 characters.";
  else if (!NAME_ALLOWED_PATTERN.test(normalizedName)) errors.name = "Name can only use letters, spaces, apostrophe, period, and hyphen.";

  if (!normalizedEmail) errors.email = "Email is required.";
  else if (!EMAIL_PATTERN.test(normalizedEmail)) errors.email = "Please enter a valid email address.";

  if (!normalizedRollNo) errors.roll_no = "Roll number is required.";
  else if (normalizedRollNo.length < 4) errors.roll_no = "Roll number must be at least 4 characters.";
  else if (rollNoDigits.length < 2) errors.roll_no = "Roll number must contain at least 2 digits for auto password.";

  if (!selectedCourseId) errors.course = "Please select a program.";
  if (!selectedAddBatchId) errors.batch = "Please select a batch.";
  else if (selectedAddBatchId === NEW_BATCH_SENTINEL && !String(admissionYear || "").trim()) errors.batch = "Please enter an admission year.";
  if (selectedAddBatchId !== NEW_BATCH_SENTINEL && addCourseSections.length > 0 && !String(formData.section_id || "").trim())
    errors.section_id = "Please select a section.";
  if (normalizedContact && !CONTACT_PATTERN.test(normalizedContact)) errors.contact_number = "Contact number must be 10-15 digits (optional +, spaces, -, () allowed).";

  return errors;
};


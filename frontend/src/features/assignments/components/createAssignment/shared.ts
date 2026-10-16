import { BookOpen, CalendarClock, CheckCircle2, FileText, Link2 } from "lucide-react";
export type AssignmentDifficulty = "beginner" | "intermediate" | "advanced";

export const toAssignmentDifficulty = (value: unknown): AssignmentDifficulty =>
  value === "beginner" || value === "advanced" ? value : "intermediate";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export const TABS: [string, string, typeof FileText][] = [
  ["basics", "Basics", FileText],
  ["audience", "Audience & schedule", CalendarClock],
  ["rubric", "Rubric", BookOpen],
  ["results", "Result release", CheckCircle2],
  ["resources", "Resources", Link2],
  ["review", "Review & publish", CheckCircle2],
];

export const blank = (): AnyRecord => ({
  title: "",
  instructions: "",
  subject: "",
  subject_id: "",
  short_description: "",
  difficulty: "intermediate",
  learning_outcomes: [],
  tags: [],
  starter_repository_url: "",
  repository_requirements: { require_readme: true, required_files: [] },
  target_course_id: "",
  target_batch_id: "",
  target_section_id: "",
  total_marks: 20,
  opens_at: "",
  due_at: "",
  allow_late: false,
  late_until: "",
  status: "published",
  result_release_mode: "manual",
  result_release_at: "",
  rubric: [
    { id: crypto.randomUUID(), title: "Implementation", description: "Correctness and completeness", max_marks: 10 },
    { id: crypto.randomUUID(), title: "Code quality", description: "Structure, readability, and documentation", max_marks: 10 },
  ],
  links: [],
});

export const parseCommaSeparatedValues = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const textValue = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

export const normalizeTeachingAssignments = (rows: unknown): AnyRecord[] =>
  Array.isArray(rows)
    ? rows
        .filter((row) => row && typeof row === "object")
        .map((row: AnyRecord) => ({
          ...row,
          program_id: textValue(row.program_id || row.course_id),
          course_id: textValue(row.course_id || row.program_id),
          batch_id: textValue(row.batch_id),
          section_id: textValue(row.section_id),
          program: textValue(row.program || row.course),
          course: textValue(row.course || row.program),
          batch: textValue(row.batch),
          section: textValue(row.section),
          subject: textValue(row.subject),
          subject_ids: Array.isArray(row.subject_ids) ? row.subject_ids.map(textValue).filter(Boolean) : [],
          subjects: Array.isArray(row.subjects) ? row.subjects.map(textValue).filter(Boolean) : [],
        }))
    : [];

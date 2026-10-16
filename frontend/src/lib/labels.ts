// Ported from frontend-legacy/src/content/labels.js

export const ENTITY_LABELS = Object.freeze({
  department: "Department",
  program: "Program",
  batch: "Batch",
  section: "Section",
  subject: "Subject",
  assignment: "Assignment",
});

export const ACTION_LABELS = Object.freeze({
  createAssignment: "Create assignment",
  publishResults: "Publish results",
  unpublishResults: "Unpublish results",
  reviewAndGrade: "Review and grade",
  reviewAiScore: "Review AI score",
  assignReviewToMe: "Assign review to me",
  markAllRead: "Mark all as read",
});

export type Role = "super_admin" | "program_admin" | "teacher" | "student";

export const roleLabel = (role?: string | null): string =>
  (
    {
      super_admin: "Administrator",
      program_admin: "Program Admin",
      teacher: "Teacher",
      student: "Student",
    } as Record<string, string>
  )[role || ""] || "User";

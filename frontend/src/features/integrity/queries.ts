// TanStack Query layer for plagiarism/duplicate-submission review.
// Sprint 7 (IMPLEMENTATION_PLAN.md "Frontend shell rebuild"), item 5.
//
//
// Known gap (see SPRINT_STATUS.md): this feature has no read/write hooks
// wired yet — no backend-facing api.ts functions exist for it yet (see api.ts).

export const integrityKeys = {
  all: ["integrity"] as const,
};


// TanStack Query layer for plagiarism/duplicate-submission review.
// Sprint 7 (the original implementation plan "Frontend shell rebuild"), item 5.
//
//
// Known gap (see the original sprint status): this feature has no read/write hooks
// wired yet — no backend-facing api.ts functions exist for it yet (see api.ts).

export const integrityKeys = {
  all: ["integrity"] as const,
};


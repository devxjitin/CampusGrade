// TanStack Query layer for external-AI drafting + evaluation.
// Sprint 7 (IMPLEMENTATION_PLAN.md "Frontend shell rebuild"), item 5.
//
//
// Known gap (see SPRINT_STATUS.md): this feature has no read/write hooks
// wired yet — call sites still use ai/api.ts functions directly.

export const aiKeys = {
  all: ["ai"] as const,
};


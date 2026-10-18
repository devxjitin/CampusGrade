// External-AI-assisted assignment drafting + external evaluation workflow
// (human-in-the-loop only — see CLAUDE.md).
// Sprint 7: split out of src/lib/api.ts.
import { request, type ApiRequestBody } from "@/types/api-client";

export const generateExternalAIPrompt = async (body: ApiRequestBody<"/assignments/teacher-tools/external-ai-prompt", "post">) =>
  request.post<"/assignments/teacher-tools/external-ai-prompt">("/assignments/teacher-tools/external-ai-prompt", body, { timeout: 30000 });

export const validateExternalAIProposal = async (draftToken: string, proposal: Record<string, unknown>) =>
  request.post<"/assignments/teacher-tools/external-ai-proposal/validate">("/assignments/teacher-tools/external-ai-proposal/validate", { draft_token: draftToken, proposal });

export const exportAssignmentExternalEvaluation = async (assignmentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/export">(`/assignments/teacher/${assignmentId}/external-evaluation/export`);

export const validateAssignmentExternalEvaluation = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/validate", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/validate">(`/assignments/teacher/${assignmentId}/external-evaluation/validate`, payload);

export const saveAssignmentExternalEvaluations = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations">(`/assignments/teacher/${assignmentId}/external-evaluation/save-evaluations`, payload);

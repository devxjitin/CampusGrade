// External-AI-assisted assignment drafting + external evaluation workflow
// (human-in-the-loop only — see CLAUDE.md).
// Sprint 7: split out of src/lib/api.ts.
import { request, type ApiRequestBody } from "@/types/api-client";

export const generateExternalAIPrompt = async (body: ApiRequestBody<"/assignments/teacher-tools/external-ai-prompt", "post">) =>
  request.post<"/assignments/teacher-tools/external-ai-prompt">("/assignments/teacher-tools/external-ai-prompt", body, { timeout: 30000 });

// With a draft token the JSON must answer that prompt; without one (the teacher's own JSON) the class is sent as IDs.
export const validateExternalAIProposal = async (
  source: { draftToken: string } | { programId: string; batchId: string; sectionId: string; subjectId: string },
  proposal: Record<string, unknown>,
) =>
  request.post<"/assignments/teacher-tools/external-ai-proposal/validate">(
    "/assignments/teacher-tools/external-ai-proposal/validate",
    "draftToken" in source
      ? { draft_token: source.draftToken, proposal }
      : { program_id: source.programId, batch_id: source.batchId, section_id: source.sectionId, subject_id: source.subjectId, proposal },
  );

export const exportAssignmentExternalEvaluation = async (assignmentId: string, mode: "files" | "links" = "links") =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/export">(`/assignments/teacher/${assignmentId}/external-evaluation/export`, { mode });

export const validateAssignmentExternalEvaluation = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/validate", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/validate">(`/assignments/teacher/${assignmentId}/external-evaluation/validate`, payload);

export const saveAssignmentExternalEvaluations = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations">(`/assignments/teacher/${assignmentId}/external-evaluation/save-evaluations`, payload);

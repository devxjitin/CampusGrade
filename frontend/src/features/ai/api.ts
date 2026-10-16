// External-AI-assisted assignment drafting + external evaluation workflow
// (human-in-the-loop only — see CLAUDE.md).
// Sprint 7: split out of src/lib/api.ts.
import { request, type ApiRequestBody } from "@/types/api-client";

export interface ExternalAIPromptInput {
  sourcePrompt?: string;
  course?: string;
  program?: string;
  programYear?: string;
  batch?: string;
  section?: string;
  difficulty?: string;
  requireReadme?: boolean;
  customInstructions?: string;
  totalMarks?: number;
  rubricCount?: number;
}

export const generateExternalAIPrompt = async ({
  sourcePrompt,
  course,
  program,
  programYear,
  batch,
  section,
  difficulty,
  requireReadme,
  customInstructions,
  totalMarks,
  rubricCount,
}: ExternalAIPromptInput) => {
  const formData = new FormData();
  formData.append("source_prompt", sourcePrompt || "");
  formData.append("course", course || "");
  formData.append("program", program || "");
  formData.append("program_year", programYear || "");
  formData.append("batch", batch || "");
  formData.append("section", section || "");
  formData.append("difficulty", difficulty || "intermediate");
  formData.append("require_readme", String(requireReadme !== false));
  formData.append("custom_instructions", customInstructions || "");
  formData.append("total_marks", String(totalMarks || 20));
  formData.append("rubric_count", String(rubricCount || 5));
  return request.post<"/assignments/teacher-tools/external-ai-prompt">("/assignments/teacher-tools/external-ai-prompt", formData, { timeout: 30000 });
};

export const importExternalAIProposal = async (
  proposal: Record<string, unknown>,
  { totalMarks = 20, rubricCount = 5, difficulty = "intermediate", requireReadme = true }: {
    totalMarks?: number;
    rubricCount?: number;
    difficulty?: "beginner" | "intermediate" | "advanced";
    requireReadme?: boolean;
  } = {},
) =>
  request.post<"/assignments/teacher-tools/external-ai-proposal/import">("/assignments/teacher-tools/external-ai-proposal/import", {
      proposal,
      total_marks: totalMarks,
      rubric_count: rubricCount,
      difficulty,
      require_readme: requireReadme,
    });

export const exportAssignmentExternalEvaluation = async (assignmentId: string) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/export">(`/assignments/teacher/${assignmentId}/external-evaluation/export`);

export const validateAssignmentExternalEvaluation = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/validate", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/validate">(`/assignments/teacher/${assignmentId}/external-evaluation/validate`, payload);

export const saveAssignmentExternalEvaluations = async (assignmentId: string, payload: ApiRequestBody<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations", "post">) =>
  request.post<"/assignments/teacher/{assignment_id}/external-evaluation/save-evaluations">(`/assignments/teacher/${assignmentId}/external-evaluation/save-evaluations`, payload);

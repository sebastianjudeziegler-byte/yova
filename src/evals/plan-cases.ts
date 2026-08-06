import { PlanGenerationRequestSchema, type PlanGenerationRequest } from "@/lib/plan-generation/schema";

export type PlanTaskFamily = "conceptual" | "problem_solving" | "writing" | "coding" | "general";

export type PlanEvaluationCase = {
  id: string;
  label: string;
  taskFamily: PlanTaskFamily;
  request: PlanGenerationRequest;
};

export function buildPlanEvaluationCases(now = new Date()): PlanEvaluationCase[] {
  const deadline = new Date(now);
  deadline.setUTCDate(deadline.getUTCDate() + 7);
  deadline.setUTCHours(23, 0, 0, 0);

  return [
    evaluationCase({
      id: "biology_source_grounded",
      label: "Biology test with learner notes",
      taskFamily: "conceptual",
      goal: "Prepare for a biology test on cellular respiration and photosynthesis in seven days.",
      deadline: deadline.toISOString(),
      materialMode: "upload",
      materials: [{
        id: "9f758b2d-4768-47af-bd84-f48ce42fa6a1",
        name: "biology-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1_800,
        textContent: "Cellular respiration converts glucose and oxygen into ATP. Glycolysis occurs in the cytoplasm. The Krebs cycle and electron transport chain occur in the mitochondria. Photosynthesis stores light energy in glucose through light-dependent reactions and the Calvin cycle. Compare the inputs, outputs, locations, and energy transformations of both processes.",
        processingStatus: "ready",
      }],
      studyMode: "inside",
      diagnosticAnswer: "I recognize the stages but cannot explain how they connect without notes.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner wants clear structure, often delays starting when a task feels large, prefers examples before independent practice, and realistically completes 25-minute sessions.",
    }),
    evaluationCase({
      id: "calculus_problem_solving",
      label: "Calculus problem-solving plan",
      taskFamily: "problem_solving",
      goal: "Learn the product rule and quotient rule, then solve mixed derivative problems accurately.",
      deadline: deadline.toISOString(),
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I know the power rule but do not know when to use the product or quotient rule.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner prefers examples first, wants medium guidance, and is more consistent with 30-minute sessions than long study blocks.",
    }),
    evaluationCase({
      id: "history_writing_outside",
      label: "History essay using outside sources",
      taskFamily: "writing",
      goal: "Plan and draft a comparative history essay using evidence from my textbook and class notes.",
      deadline: deadline.toISOString(),
      materialMode: "none",
      materials: [],
      studyMode: "outside",
      diagnosticAnswer: "I understand the events but struggle to organize a thesis and evidence.",
      diagnosticEvaluation: "self_report",
      profileSummary: "The learner becomes overwhelmed by vague writing tasks, wants a visible first step, and prefers a checklist with 25-minute work blocks.",
    }),
    evaluationCase({
      id: "javascript_coding",
      label: "Beginner JavaScript practice",
      taskFamily: "coding",
      goal: "Understand JavaScript array methods and use map, filter, and reduce in small programs.",
      deadline: null,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I can read simple JavaScript but cannot write array-method solutions without help.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner wants concise explanations, benefits from seeing one complete example, and prefers support to fade before independent practice.",
    }),
    evaluationCase({
      id: "personal_finance_general",
      label: "General-learning finance pathway",
      taskFamily: "general",
      goal: "Learn personal finance fundamentals including budgeting, credit, debt, and index-fund investing.",
      deadline: null,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I know basic budgeting but have little knowledge of credit, interest, or investing.",
      diagnosticEvaluation: "self_report",
      profileSummary: "The learner wants practical examples, moderate structure, and three manageable sessions per week without a fixed deadline.",
    }),
  ];
}

function evaluationCase(input: {
  id: string;
  label: string;
  taskFamily: PlanTaskFamily;
  goal: string;
  deadline: string | null;
  materialMode: "upload" | "none";
  materials: PlanGenerationRequest["materials"];
  studyMode: "inside" | "outside";
  diagnosticAnswer: string;
  diagnosticEvaluation: "correct" | "incorrect" | "self_report";
  profileSummary: string;
}): PlanEvaluationCase {
  return {
    id: input.id,
    label: input.label,
    taskFamily: input.taskFamily,
    request: PlanGenerationRequestSchema.parse({
      intent: "plan",
      goal: input.goal,
      materialMode: input.materialMode,
      materials: input.materials,
      studyMode: input.studyMode,
      deadline: input.deadline,
      timeZone: "America/Los_Angeles",
      diagnosticResponses: [{
        question: "What can you currently do without help?",
        answer: input.diagnosticAnswer,
        evaluation: input.diagnosticEvaluation,
      }],
      availability: [
        { day: "Monday", window: "Evening", minutes: 25 },
        { day: "Wednesday", window: "Evening", minutes: 30 },
        { day: "Saturday", window: "Morning", minutes: 40 },
      ],
      profileSummary: input.profileSummary,
    }),
  };
}

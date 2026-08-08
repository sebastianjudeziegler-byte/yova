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
  const twoWeekDeadline = new Date(now);
  twoWeekDeadline.setUTCDate(twoWeekDeadline.getUTCDate() + 14);
  twoWeekDeadline.setUTCHours(23, 0, 0, 0);

  return [
    evaluationCase({
      id: "biology_source_grounded",
      label: "Biology test with learner notes",
      taskFamily: "conceptual",
      goal: "Prepare for a biology test on cellular respiration and photosynthesis in seven days.",
      learningIntent: "study",
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
      learningIntent: "learn",
      deadline: deadline.toISOString(),
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I know the power rule but do not know when to use the product or quotient rule.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner prefers examples first, wants medium guidance, and is more consistent with 30-minute sessions than long study blocks.",
    }),
    evaluationCase({
      id: "product_rule_narrow_15",
      label: "One product-rule skill in short sessions",
      taskFamily: "problem_solving",
      goal: "Learn the product rule from scratch and use it independently.",
      learningIntent: "learn",
      deadline: null,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I know the power rule, but I have not learned the product rule.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner wants one complete example before trying a similar problem, prefers one visible step at a time, and often studies in 15-minute windows.",
      availability: [
        { day: "Monday", window: "Evening", minutes: 15 },
        { day: "Wednesday", window: "Evening", minutes: 15 },
        { day: "Saturday", window: "Morning", minutes: 15 },
      ],
    }),
    evaluationCase({
      id: "world_war_one_guide_15",
      label: "World War I unit guide in short sessions",
      taskFamily: "conceptual",
      goal: "Prepare for my World War I unit test from the beginning using my teacher's study guide.",
      learningIntent: "learn",
      deadline: twoWeekDeadline.toISOString(),
      materialMode: "upload",
      materials: [{
        id: "9f758b2d-4768-47af-bd84-f48ce42fa6a2",
        name: "World War I unit study guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2_400,
        textContent: [
          "# Long-term causes",
          "Militarism, alliances, imperial competition, and nationalism increased tension among European powers.",
          "# The alliance systems",
          "The Triple Alliance and Triple Entente connected a local crisis to wider commitments.",
          "# The July Crisis",
          "Austria-Hungary's ultimatum to Serbia and the sequence of mobilizations widened the conflict.",
          "# The Western Front",
          "The Schlieffen Plan failed to produce a quick victory, and trench warfare developed.",
          "# The Eastern Front",
          "Fighting remained more mobile, while Russia faced severe military and political strain.",
          "# United States entry",
          "Unrestricted submarine warfare and the Zimmermann Telegram helped shift public and political support.",
          "# The armistice",
          "Military exhaustion and political crisis contributed to the end of fighting in November 1918.",
          "# Consequences of the war",
          "The peace settlement redrew borders and created political and economic tensions.",
        ].join("\n"),
        processingStatus: "ready",
      }],
      studyMode: "inside",
      diagnosticAnswer: "I am starting from the beginning and cannot yet explain the causes or sequence of the war.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner wants the big picture before details, prefers a small hint before an answer, forgets material after a few days, and realistically completes 15-minute sessions.",
      availability: [
        { day: "Monday", window: "Evening", minutes: 15 },
        { day: "Wednesday", window: "Evening", minutes: 15 },
        { day: "Saturday", window: "Morning", minutes: 15 },
      ],
    }),
    evaluationCase({
      id: "calculus_broad_pathway_30",
      label: "Full beginner calculus pathway",
      taskFamily: "problem_solving",
      goal: "Learn all of calculus from the beginning, including limits, derivatives, and integrals.",
      learningIntent: "learn",
      deadline: null,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I am starting from the beginning and only remember basic algebra and functions.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner wants the overall map before details, benefits from one worked example before guided practice, and prefers 30-minute sessions with moderate structure.",
      availability: [
        { day: "Monday", window: "Evening", minutes: 30 },
        { day: "Wednesday", window: "Evening", minutes: 30 },
        { day: "Saturday", window: "Morning", minutes: 30 },
      ],
    }),
    evaluationCase({
      id: "startup_funding_general_25",
      label: "General-learning startup funding pathway",
      taskFamily: "general",
      goal: "Learn startup funding stages, investors, instruments, dilution, valuation, and term sheets from the beginning.",
      learningIntent: "learn",
      deadline: null,
      materialMode: "none",
      materials: [],
      studyMode: "inside",
      diagnosticAnswer: "I know startups raise money, but I do not understand how the stages or deal terms connect.",
      diagnosticEvaluation: "incorrect",
      profileSummary: "The learner prefers practical examples, wants the big picture before details, and completes focused 25-minute sessions more consistently than long blocks.",
    }),
    evaluationCase({
      id: "history_writing_outside",
      label: "History essay using outside sources",
      taskFamily: "writing",
      goal: "Plan and draft a comparative history essay using evidence from my textbook and class notes.",
      learningIntent: "learn",
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
      learningIntent: "learn",
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
      learningIntent: "learn",
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
  learningIntent: "learn" | "study";
  deadline: string | null;
  materialMode: "upload" | "none";
  materials: PlanGenerationRequest["materials"];
  studyMode: "inside" | "outside";
  diagnosticAnswer: string;
  diagnosticEvaluation: "correct" | "incorrect" | "self_report";
  profileSummary: string;
  availability?: PlanGenerationRequest["availability"];
}): PlanEvaluationCase {
  return {
    id: input.id,
    label: input.label,
    taskFamily: input.taskFamily,
    request: PlanGenerationRequestSchema.parse({
      intent: "plan",
      learningIntent: input.learningIntent,
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
      availability: input.availability ?? [
        { day: "Monday", window: "Evening", minutes: 25 },
        { day: "Wednesday", window: "Evening", minutes: 30 },
        { day: "Saturday", window: "Morning", minutes: 40 },
      ],
      profileSummary: input.profileSummary,
    }),
  };
}

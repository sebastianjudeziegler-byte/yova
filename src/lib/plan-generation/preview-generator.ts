import type { LearningPlan } from "@/lib/domain";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

type PreviewSubject = {
  title: string;
  topic: string;
  kind: GeneratedPlanDraft["kind"];
  sessionTitles: [string, string, string, string, string];
};

const SUBJECTS: Array<{ matches: RegExp; subject: PreviewSubject }> = [
  {
    matches: /product rule/i,
    subject: {
      title: "Calculus: Product Rule",
      topic: "The product rule for derivatives",
      kind: "skill",
      sessionTitles: [
        "Recall the product-rule structure",
        "Study a worked product-rule example",
        "Solve with fading support",
        "Complete mixed product-rule practice",
        "Repair the last mistakes",
      ],
    },
  },
  {
    matches: /biology|photosynthesis|cellular respiration/i,
    subject: {
      title: "AP Biology Unit 3",
      topic: "Photosynthesis and cellular respiration",
      kind: "test",
      sessionTitles: [
        "Retrieve cellular respiration",
        "Build the comparison",
        "Apply and distinguish",
        "Practice test and repair",
        "Rapid recall",
      ],
    },
  },
  {
    matches: /calculus|derivative|product rule|quotient rule/i,
    subject: {
      title: "Calculus: Derivatives",
      topic: "Derivative rules and applied problem solving",
      kind: "test",
      sessionTitles: [
        "Recall the core rules",
        "Study worked examples",
        "Solve with fading support",
        "Complete mixed practice",
        "Repair the last mistakes",
      ],
    },
  },
  {
    matches: /finance|investing|budget|credit|interest/i,
    subject: {
      title: "Personal Finance Fundamentals",
      topic: "Budgeting, credit, interest, and investing basics",
      kind: "topic",
      sessionTitles: [
        "Map the fundamentals",
        "Work through real examples",
        "Retrieve the key decisions",
        "Apply concepts to scenarios",
        "Consolidate the framework",
      ],
    },
  },
];

const DEFAULT_SUBJECT: PreviewSubject = {
  title: "Personalized learning plan",
  topic: "The goal and concepts described by the learner",
  kind: "topic",
  sessionTitles: [
    "Build the mental model",
    "Retrieve the essentials",
    "Practice with guidance",
    "Apply independently",
    "Review and consolidate",
  ],
};

const METHODS = [
  "Closed-note retrieval",
  "Guided concept repair",
  "Mixed practice",
  "Assessment and error review",
  "Spaced final review",
] as const;

export function generatePreviewPlan(request: PlanGenerationRequest): LearningPlan {
  const subject = SUBJECTS.find(({ matches }) => matches.test(request.goal))?.subject ?? DEFAULT_SUBJECT;
  const deadline = request.deadline ? new Date(request.deadline) : inferDeadline(request.goal);
  const targetMinutes = request.availability[0]?.minutes ?? 25;
  const sessionBlueprints = request.intent === "study_now"
    ? [previewBlueprint(subject, request, 0, 0, 1, targetMinutes)]
    : subject.sessionTitles.flatMap((_, phaseIndex) => {
      const baseMinutes = [25, 30, 30, 35, 10][phaseIndex];
      const partCount = Math.max(1, Math.ceil(baseMinutes / targetMinutes));
      return Array.from({ length: partCount }, (_, partIndex) => (
        previewBlueprint(subject, request, phaseIndex, partIndex, partCount, Math.min(targetMinutes, baseMinutes))
      ));
    }).slice(0, 14);
  const draft = GeneratedPlanDraftSchema.parse({
    title: subject.title,
    topic: subject.topic,
    kind: subject.kind,
    deadline: request.intent === "study_now" ? null : deadline?.toISOString() ?? null,
    rationale: buildRationale(request),
    sessions: sessionBlueprints.map((blueprint, index) => {
      const availability = request.availability[index % request.availability.length];
      const minutes = Math.min(availability.minutes, blueprint.minutes);

      return {
        title: blueprint.title,
        objective: blueprint.objective,
        method: METHODS[blueprint.phaseIndex],
        methodReason: reasonFor(blueprint.phaseIndex, request),
        scheduledFor: scheduledDate(index, sessionBlueprints.length, availability.window, deadline).toISOString(),
        estimatedMinutes: minutes,
        amountLabel: `${blueprint.contentTargets.length} focused ${blueprint.contentTargets.length === 1 ? "target" : "targets"} + evidence check · about ${minutes} min`,
        learningMode: sessionLearningMode(request, blueprint.phaseIndex),
        contentTargets: blueprint.contentTargets,
        completionEvidence: blueprint.completionEvidence,
      };
    }),
  });

  return materializePlanDraft(draft, request);
}

function previewBlueprint(subject: PreviewSubject, request: PlanGenerationRequest, phaseIndex: number, partIndex: number, partCount: number, minutes: number) {
  const title = request.intent === "study_now" ? studyNowTitle(subject) : subject.sessionTitles[phaseIndex];
  const targets = contentTargetsFor(phaseIndex, subject.topic);
  const distributedTargets = targets.filter((_, index) => index % partCount === partIndex);
  const contentTargets = distributedTargets.length ? distributedTargets : [`The next bounded part of ${targets[Math.min(partIndex, targets.length - 1)]}`];
  const partLabel = partCount > 1 ? ` · Part ${partIndex + 1} of ${partCount}` : "";
  return {
    phaseIndex,
    minutes,
    title: `${title}${partLabel}`,
    objective: partCount > 1
      ? `${objectiveFor(phaseIndex, subject.topic)} This session covers only part ${partIndex + 1} of ${partCount}; the remaining content stays in later sessions.`
      : objectiveFor(phaseIndex, subject.topic),
    contentTargets,
    completionEvidence: completionEvidenceFor(phaseIndex, contentTargets),
  };
}

function contentTargetsFor(index: number, topic: string) {
  return [
    [`The core vocabulary and relationships in ${topic}`, `The current starting gaps revealed without notes`],
    [`A clear mental model of the weakest idea in ${topic}`, "One concrete example that shows how the idea works"],
    ["Choosing the correct idea in mixed situations", "Explaining why tempting alternatives do not fit"],
    ["Representative unsupported questions", "Errors repaired with a different follow-up prompt", "One independent transfer attempt"],
    ["The highest-priority ideas still due for retrieval"],
  ][index];
}

function completionEvidenceFor(index: number, targets: string[]) {
  const evidence = [
    "Attempt each target from memory and identify the unstable detail",
    "Explain the central relationship and complete one check without the model visible",
    "Choose and apply the correct idea in a new prompt",
    "Complete the assigned questions and correct each exposed error",
    "Retrieve the priority ideas once without notes",
  ][index];
  return [evidence, targets.length > 1 ? "Produce evidence for each listed content target" : "Produce evidence for the listed content target"];
}

function buildRationale(request: PlanGenerationRequest) {
  const sourcePhrase = request.materialMode === "upload"
    ? `${request.materials.length} learner-supplied ${request.materials.length === 1 ? "source" : "sources"}`
    : "a YOVA-created content sequence";
  const executionPhrase = request.studyMode === "outside"
    ? "clear instructions that can be completed outside the app"
    : "guided work inside YOVA";

  if (request.intent === "study_now") {
    const approach = request.learningIntent === "learn"
      ? "teaches a compact foundation before guided and independent attempts"
      : "starts with an attempt from memory, then repairs only the exposed gaps";
    return `This focused session ${approach}. It uses ${sourcePhrase} and ${executionPhrase}, fits the time available now, and keeps every step explicit.`;
  }

  const approach = request.learningIntent === "learn"
    ? "The plan builds an initial mental model, fades guidance, and then transitions into retrieval and application."
    : "The plan starts with retrieval to reveal exact gaps, then uses targeted explanation, retry, and later review.";
  return `${approach} It uses ${sourcePhrase} and ${executionPhrase}, while keeping activity blocks short and explicit to match the learner profile.`;
}

function studyNowTitle(subject: PreviewSubject) {
  return subject.sessionTitles[0].replace(/^Retrieve/, "Focused review:");
}

function sessionLearningMode(request: PlanGenerationRequest, index: number) {
  if (request.intent === "study_now") return request.learningIntent;
  if (request.learningIntent === "study") return "study" as const;
  return index < 2 ? "learn" as const : "study" as const;
}

function objectiveFor(index: number, topic: string) {
  const objectives = [
    `Recall the main ideas in ${topic} without notes and expose unstable details.`,
    "Repair the weakest ideas with a concise explanation and a clear comparison.",
    "Use the repaired knowledge in mixed questions that require choosing the right idea.",
    "Complete a realistic assessment, then study only the errors that remain.",
    "Retrieve the highest-priority ideas once more before the deadline.",
  ];
  return objectives[index];
}

function reasonFor(index: number, request: PlanGenerationRequest) {
  const answers = request.diagnosticResponses.map((response) => response.answer).join(" ").toLowerCase();
  const hasIncorrectAnswer = request.diagnosticResponses.some((response) => response.evaluation === "incorrect");
  const confidenceIsLimited = hasIncorrectAnswer || /not confident|somewhat confident|i do not know/.test(answers);
  const reasons = [
    confidenceIsLimited
      ? "The starting check suggests recognition is stronger than independent recall."
      : "Retrieval verifies that confident recognition also holds without notes.",
    "A compact explanation follows retrieval so the learner repairs only the gaps that were exposed.",
    "Mixed practice checks whether the learner can distinguish ideas instead of memorizing isolated answers.",
    "A realistic assessment converts remaining mistakes into a targeted final review.",
    "A short final retrieval protects recall without adding unnecessary work before the deadline.",
  ];
  return reasons[index];
}

function upcomingFridayAtNine() {
  const date = new Date();
  const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(9, 0, 0, 0);
  return date;
}

function inferDeadline(goal: string) {
  return /next friday|test|exam|quiz|deadline/i.test(goal) ? upcomingFridayAtNine() : null;
}

function scheduledDate(index: number, totalSessions: number, window: string, deadline: Date | null) {
  if (index === totalSessions - 1) {
    const finalReview = deadline ? new Date(deadline) : new Date();
    if (!deadline) finalReview.setDate(finalReview.getDate() + 4);
    finalReview.setHours(8, 0, 0, 0);
    return finalReview;
  }

  const date = new Date();
  const latestDayOffset = deadline
    ? Math.max(0, Math.floor((deadline.getTime() - date.getTime()) / (24 * 60 * 60 * 1_000)) - 1)
    : Math.max(0, totalSessions - 1);
  const dayOffset = totalSessions <= 1 ? 0 : Math.floor((index / (totalSessions - 1)) * latestDayOffset);
  date.setDate(date.getDate() + dayOffset);

  const hour = /morning/i.test(window) ? 8 : /evening/i.test(window) ? 18 : 15;
  date.setHours(hour, 30, 0, 0);
  return date;
}

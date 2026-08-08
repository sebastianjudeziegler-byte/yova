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
  focusedTargets?: string[];
};

const SUBJECTS: Array<{ matches: RegExp; subject: PreviewSubject }> = [
  {
    matches: /world war (?:i|1)|wwi|first world war/i,
    subject: {
      title: "World War I Study Plan",
      topic: "World War I causes, escalation, major turning points, and consequences",
      kind: "test",
      sessionTitles: [
        "Build the causes and escalation map",
        "Connect the alliances and major fronts",
        "Explain the turning points",
        "Practice historical cause and effect",
        "Complete a final retrieval review",
      ],
      focusedTargets: [
        "Long-term causes and the July Crisis",
        "How alliances and mobilization widened the war",
        "Major turning points and consequences",
      ],
    },
  },
  {
    matches: /startup.*fund|funding.*startup|term sheets?|dilution.*investor/i,
    subject: {
      title: "Startup Funding Foundations",
      topic: "Startup funding stages, investors, instruments, dilution, and term sheets",
      kind: "topic",
      sessionTitles: [
        "Build the startup funding map",
        "Compare funding instruments",
        "Reason about dilution",
        "Read a simple term sheet",
        "Connect the full funding decision",
      ],
      focusedTargets: [
        "How funding stages and investor types connect",
        "How common funding instruments change ownership or repayment",
        "How dilution and term-sheet terms affect founders and investors",
      ],
    },
  },
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

const LEARNING_METHODS = [
  "Guided explanation and self-explanation",
  "Worked example fading",
  "Guided retrieval and distinction practice",
  "Independent application and error repair",
  "Spaced retrieval",
] as const;

export function generatePreviewPlan(request: PlanGenerationRequest): LearningPlan {
  const subject = SUBJECTS.find(({ matches }) => matches.test(request.goal))?.subject ?? {
    ...DEFAULT_SUBJECT,
    topic: request.goal.trim(),
  };
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
        method: request.studyMode === "outside"
          ? outsideMethodFor(request.goal)
          : request.intent === "study_now" && request.learningIntent === "learn"
            ? "Self-explanation with worked example fading"
            : request.learningIntent === "learn"
              ? LEARNING_METHODS[blueprint.phaseIndex]
              : METHODS[blueprint.phaseIndex],
        methodReason: request.studyMode === "outside"
          ? outsideMethodReason(request.goal)
          : request.intent === "study_now" && request.learningIntent === "learn"
            ? "The learner has not built this foundation yet, so YOVA should explain the overall model, walk through one concrete example, and then reduce support for a short understanding check."
            : request.learningIntent === "learn"
              ? learningReasonFor(blueprint.phaseIndex)
              : reasonFor(blueprint.phaseIndex, request),
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
  if (request.studyMode === "outside") {
    const partLabel = partCount > 1 ? ` · Part ${partIndex + 1} of ${partCount}` : "";
    return {
      phaseIndex,
      minutes,
      title: `${request.intent === "study_now" ? "Work through your source" : subject.sessionTitles[phaseIndex]}${partLabel}`,
      objective: `Use your chosen source to make concrete progress on “${request.goal.trim()},” then return to YOVA with evidence of what you produced or understood.`,
      contentTargets: [subject.topic],
      completionEvidence: [
        "Complete the assigned action using the outside source",
        "Return to YOVA and explain the result, decision, or remaining gap without copying the source",
      ],
    };
  }

  if (request.intent === "study_now") {
    const contentTargets = subject.focusedTargets ?? [subject.topic];
    const learningFirst = request.learningIntent === "learn";
    return {
      phaseIndex: 0,
      minutes,
      title: studyNowTitle(subject),
      objective: learningFirst
        ? `Build a clear first mental model of ${subject.topic}, work through one concrete example, and then explain the central relationships without the model visible.`
        : `Retrieve and apply the main ideas in ${subject.topic} without notes, then repair only the gaps the attempt reveals.`,
      contentTargets,
      completionEvidence: learningFirst
        ? [
            "Explain the central relationships in plain language after the model is hidden",
            "Complete one short application or distinction check with reduced support",
          ]
        : [
            "Attempt each target without notes before viewing feedback",
            "Correct the exposed gap and complete one new check without support",
          ],
    };
  }

  const title = request.learningIntent === "learn"
    ? learningTitleFor(subject.sessionTitles[phaseIndex], phaseIndex)
    : subject.sessionTitles[phaseIndex];
  const targets = contentTargetsFor(phaseIndex, subject.topic);
  const distributedTargets = targets.filter((_, index) => index % partCount === partIndex);
  const contentTargets = distributedTargets.length ? distributedTargets : [`The next bounded part of ${targets[Math.min(partIndex, targets.length - 1)]}`];
  const partLabel = partCount > 1 ? ` · Part ${partIndex + 1} of ${partCount}` : "";
  return {
    phaseIndex,
    minutes,
    title: `${title}${partLabel}`,
    objective: partCount > 1
      ? `${request.learningIntent === "learn" ? learningObjectiveFor(phaseIndex, subject.topic) : objectiveFor(phaseIndex, subject.topic)} This session covers only part ${partIndex + 1} of ${partCount}; the remaining content stays in later sessions.`
      : request.learningIntent === "learn" ? learningObjectiveFor(phaseIndex, subject.topic) : objectiveFor(phaseIndex, subject.topic),
    contentTargets,
    completionEvidence: request.learningIntent === "learn"
      ? learningCompletionEvidenceFor(phaseIndex, contentTargets)
      : completionEvidenceFor(phaseIndex, contentTargets),
  };
}

function outsideMethodFor(goal: string) {
  if (/essay|thesis|argument|draft|writing|evidence/i.test(goal)) return "Retrieval-based outlining";
  if (/calculus|math|algebra|equation|problem|solve|physics|chemistry/i.test(goal)) return "Worked example fading";
  if (/read|chapter|article|textbook/i.test(goal)) return "Read, recall, and review";
  return "Active retrieval with a source check";
}

function outsideMethodReason(goal: string) {
  if (/essay|thesis|argument|draft|writing|evidence/i.test(goal)) {
    return "A source-grounded outline turns the outside reading into claims and evidence before drafting, while keeping the factual content in the learner’s own materials.";
  }
  if (/calculus|math|algebra|equation|problem|solve|physics|chemistry/i.test(goal)) {
    return "One worked example from the learner’s source provides a model, then support should fade before an independent problem.";
  }
  if (/read|chapter|article|textbook/i.test(goal)) {
    return "Short reading segments followed by closed-source recall produce evidence of understanding without asking YOVA to replace the source.";
  }
  return "The learner should attempt the target from the trusted source, close it, and then produce evidence of what remains available without support.";
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
  return subject.sessionTitles[0].replace(/^(Retrieve|Recall)/, "Focused review:");
}

function learningTitleFor(title: string, index: number) {
  if (index !== 0) return title;
  return title.replace(/^(Retrieve|Recall)/, "Build a first model of");
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

function learningObjectiveFor(index: number, topic: string) {
  return [
    `Build an accurate first mental model of ${topic} through a concise explanation and one concrete example.`,
    `Use a worked example to connect the main parts of ${topic}, then reconstruct the reasoning with less support.`,
    `Retrieve and distinguish the central ideas in ${topic} after the teaching model is hidden.`,
    `Apply the ideas in a new situation, diagnose any error, and retry without the original support.`,
    `Retrieve the highest-priority ideas in ${topic} after a delay and repair only what remains unstable.`,
  ][index];
}

function learningCompletionEvidenceFor(index: number, targets: string[]) {
  const evidence = [
    "Explain the central relationship in plain language after the model is hidden",
    "Complete one similar example with reduced support and explain the key decision",
    "Retrieve each central idea and distinguish it from a plausible alternative",
    "Complete one independent transfer attempt and correct any exposed error",
    "Retrieve the priority ideas once without notes after a delay",
  ][index];
  return [evidence, targets.length > 1 ? "Produce evidence for each listed content target" : "Produce evidence for the listed content target"];
}

function learningReasonFor(index: number) {
  return [
    "The learner is building this foundation, so YOVA should teach a coherent model before asking for unsupported recall.",
    "A complete example makes the reasoning visible before support is deliberately reduced.",
    "Retrieval now checks whether the taught model remains available without the explanation on screen.",
    "Independent application tests whether the learner can transfer the idea rather than repeat the example.",
    "A delayed return strengthens access to the idea while keeping review focused on what remains unstable.",
  ][index];
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

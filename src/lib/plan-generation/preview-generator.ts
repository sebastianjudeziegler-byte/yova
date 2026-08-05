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
  const sessionTitles = request.intent === "study_now"
    ? [studyNowTitle(subject)]
    : subject.sessionTitles;
  const draft = GeneratedPlanDraftSchema.parse({
    title: subject.title,
    topic: subject.topic,
    kind: subject.kind,
    deadline: request.intent === "study_now" ? null : deadline?.toISOString() ?? null,
    rationale: buildRationale(request),
    sessions: sessionTitles.map((title, index) => {
      const availability = request.availability[index % request.availability.length];
      const minutes = Math.min(availability.minutes, index === 4 ? 10 : 20 + index * 5);

      return {
        title,
        objective: objectiveFor(index, subject.topic),
        method: METHODS[index],
        methodReason: reasonFor(index, request),
        scheduledFor: scheduledDate(index, availability.window, deadline).toISOString(),
        estimatedMinutes: minutes,
        amountLabel: amountFor(index, minutes),
      };
    }),
  });

  return materializePlanDraft(draft, request);
}

function buildRationale(request: PlanGenerationRequest) {
  const sourcePhrase = request.materialMode === "upload"
    ? `${request.materials.length} learner-supplied ${request.materials.length === 1 ? "source" : "sources"}`
    : "a YOVA-created content sequence";
  const executionPhrase = request.studyMode === "outside"
    ? "clear instructions that can be completed outside the app"
    : "guided work inside YOVA";

  if (request.intent === "study_now") {
    return `This focused session uses ${sourcePhrase} and ${executionPhrase}. It starts from the learner's stated knowledge, fits the time available now, and keeps every step explicit.`;
  }

  return `The plan starts with retrieval to reveal exact gaps, then moves through explanation, practice, and review. It uses ${sourcePhrase} and ${executionPhrase}, while keeping activity blocks short and explicit to match the learner profile.`;
}

function studyNowTitle(subject: PreviewSubject) {
  return subject.sessionTitles[0].replace(/^Retrieve/, "Focused review:");
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

function amountFor(index: number, minutes: number) {
  const labels = ["10 recall prompts", "3 focused sections", "8 mixed questions", "15-question check", "5 priority prompts"];
  return `${labels[index]} · about ${minutes} min`;
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

function scheduledDate(index: number, window: string, deadline: Date | null) {
  if (index === 4) {
    const finalReview = deadline ? new Date(deadline) : new Date();
    if (!deadline) finalReview.setDate(finalReview.getDate() + 4);
    finalReview.setHours(8, 0, 0, 0);
    return finalReview;
  }

  const date = new Date();
  date.setDate(date.getDate() + index);

  const hour = /morning/i.test(window) ? 8 : /evening/i.test(window) ? 18 : 15;
  date.setHours(hour, 30, 0, 0);
  return date;
}

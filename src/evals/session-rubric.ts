import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { SessionTaskFamily } from "@/evals/session-cases";

export type SessionQualityCheck = {
  id: string;
  label: string;
  passed: boolean;
  points: number;
  earned: number;
  required: boolean;
  detail: string;
};

export type SessionQualityResult = {
  score: number;
  passed: boolean;
  checks: SessionQualityCheck[];
  requiredFailures: string[];
};

const TASK_PATTERNS: Record<SessionTaskFamily, RegExp> = {
  conceptual: /explain|connect|compare|concept|model|retriev|recall|apply|process/i,
  problem_solving: /worked|example|solve|problem|practice|calculate|step|equation/i,
  writing: /thesis|evidence|outline|draft|write|claim|revise|argument/i,
  coding: /code|implement|debug|trace|array|function|program|map|filter|reduce/i,
  general: /explain|example|scenario|apply|practice|review|compare|decision|calculate/i,
};

export function evaluateSessionDraft(
  draft: GeneratedSessionDraft,
  context: SessionGenerationContext,
  taskFamily: SessionTaskFamily,
  expectedSourceTerms: string[] = [],
): SessionQualityResult {
  const activityText = draft.activities.map((activity) => [
    activity.label,
    activity.title,
    activity.body,
    activity.correctAnswer,
    activity.feedback,
    ...activity.choices,
  ].filter(Boolean).join(" "));
  const combined = [draft.rationale, ...activityText].join(" ");
  const questions = draft.activities.filter((activity) => (
    activity.type === "multiple_choice" || activity.type === "free_response"
  ));
  const questionIndices = draft.activities
    .map((activity, index) => ({ activity, index }))
    .filter(({ activity }) => activity.type === "multiple_choice" || activity.type === "free_response")
    .map(({ index }) => index);
  const maximumActivities = Math.min(8, Math.max(3, Math.ceil(context.session.estimatedMinutes / 4)));
  const questionIntegrity = questions.every((activity) => {
    if (!activity.concept || !activity.correctAnswer || !activity.feedback || activity.feedback.length < 20) return false;
    if (activity.type === "free_response") return activity.correctAnswer.length >= 15 && activity.choices.length === 0;
    return new Set(activity.choices.map(normalize)).size === activity.choices.length
      && activity.choices.includes(activity.correctAnswer);
  });
  const alignedActivities = activityText.filter((text) => TASK_PATTERNS[taskFamily].test(text)).length;
  const progression = questionIndices.length >= 2
    && questionIndices.at(-1)! > questionIndices[0]
    && draft.activities.slice(0, questionIndices.at(-1)).some((activity) => activity.type === "instruction");
  const matchedSourceTerms = expectedSourceTerms.filter((term) => combined.toLowerCase().includes(term.toLowerCase()));
  const sourceGrounded = !context.materials.length
    || (expectedSourceTerms.length > 0 && matchedSourceTerms.length >= Math.min(2, expectedSourceTerms.length));
  const reviewConcepts = context.conceptSignals
    .filter((signal) => signal.status === "needs_review")
    .map((signal) => signal.concept);
  const priorityConceptsUsed = reviewConcepts.length === 0
    || reviewConcepts.every((concept) => combined.toLowerCase().includes(concept.toLowerCase()));
  const outsideGuidance = context.learningGoal.studyMode !== "outside_yova"
    || draft.activities.some((activity) => (
      activity.type === "instruction"
      && /your (textbook|notes|source|materials?)|open (the|your)|on paper|draft|write/i.test(activity.body)
    ));
  const noOverclaim = !/learns? best|learning style|brain type|visual learner|auditory learner|kinesthetic learner|because (you have|of your) adhd|diagnos/i.test(combined);

  const checks: SessionQualityCheck[] = [
    check("activity_pacing", "Activity count fits the session", draft.activities.length >= 3 && draft.activities.length <= maximumActivities, 10, true, `${draft.activities.length}/${maximumActivities} maximum activities for ${context.session.estimatedMinutes} minutes`),
    check("active_practice", "Session requires active learner effort", questions.length >= 2, 15, true, `${questions.length} retrieval or knowledge-check activities`),
    check("answer_integrity", "Questions include usable answers and feedback", questionIntegrity, 15, true, `${questions.length} question activities inspected`),
    check("task_alignment", "Activities fit the learning task", alignedActivities >= Math.ceil(draft.activities.length * 0.5), 15, true, `${alignedActivities} of ${draft.activities.length} activities align with ${taskFamily.replace("_", " ")}`),
    check("learning_progression", "Session moves from support into practice", progression, 10, true, "Checked instruction and question order"),
    check("source_grounding", "Learner materials remain the factual anchor", sourceGrounded, 10, true, context.materials.length ? `${matchedSourceTerms.length}/${expectedSourceTerms.length} expected source concepts used` : "No uploaded source"),
    check("weak_concept_priority", "Known review concepts are addressed", priorityConceptsUsed, 10, true, reviewConcepts.length ? `Review concepts: ${reviewConcepts.join(", ")}` : "No prior review signal"),
    check("outside_guidance", "Outside-app work receives concrete directions", outsideGuidance, 5, true, context.learningGoal.studyMode === "outside_yova" ? "Outside-work instruction inspected" : "Inside-YOVA session"),
    check("explainability", "The session explains why it is structured this way", draft.rationale.trim().length >= 40, 5, false, `${draft.rationale.trim().length} rationale characters`),
    check("no_personality_overclaim", "No fixed brain, diagnosis, or learning-style claim", noOverclaim, 5, true, "Checked learner-facing session text"),
  ];

  const score = checks.reduce((total, item) => total + item.earned, 0);
  const requiredFailures = checks.filter((item) => item.required && !item.passed).map((item) => item.label);
  return { score, passed: score >= 80 && requiredFailures.length === 0, checks, requiredFailures };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function check(id: string, label: string, passed: boolean, points: number, required: boolean, detail: string): SessionQualityCheck {
  return { id, label, passed, points, earned: passed ? points : 0, required, detail };
}

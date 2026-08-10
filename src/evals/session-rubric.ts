import type { SessionGenerationContext } from "@/lib/openai/session-generator";
import type {
  GeneratedSessionDraft,
  LessonBrief,
} from "@/lib/session-generation/schema";
import type { SessionTaskFamily } from "@/evals/session-cases";
import { buildLearningScienceRoutingBrief } from "@/lib/learning/method-router";
import {
  methodFidelityContractForPrompt,
  validateMethodFidelity,
} from "@/lib/learning/method-fidelity";
import { isScheduledRetrievalSession } from "@/lib/learning/scheduled-retrieval";
import { validateSessionCompletionContract } from "@/lib/session-generation/completion-contract";
import { validateSessionQuestionContext } from "@/lib/session-generation/question-context";
import { validateSessionContentSpecificity } from "@/lib/session-generation/content-specificity";
import {
  buildSessionDeliveryPolicy,
  type SessionDeliveryPolicy,
} from "@/lib/personalization/session-delivery-policy";
import { validateVisibleAdaptation } from "@/lib/personalization/visible-adaptation";

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
  problem_solving: /worked|example|solve|problem|practice|calculate|step|equation|derivativ|differentiat|rule|setup/i,
  reading: /passage|text|detail|evidence|interpret|imagery|setting|claim|annotat|quote|read/i,
  writing: /thesis|evidence|outline|draft|write|claim|revise|argument/i,
  coding: /code|implement|debug|trace|array|function|program|map|filter|reduce/i,
  language: /ask|answer|dialogue|exchange|speak|sentence|conversation|present tense|routine|question|respond|verb|grammar|spanish/i,
  general: /explain|example|scenario|apply|practice|review|compare|decision|calculate/i,
};

export function evaluateSessionDraft(
  draft: GeneratedSessionDraft,
  context: SessionGenerationContext,
  taskFamily: SessionTaskFamily,
  expectedSourceTerms: string[] = [],
  generatedDeliveryPolicy?: SessionDeliveryPolicy,
): SessionQualityResult {
  const activityText = draft.activities.map((activity) => [
    activity.label,
    activity.title,
    activity.body,
    activity.teaching?.keyIdea,
    activity.teaching?.explanation,
    activity.teaching?.example?.setup,
    ...(activity.teaching?.example?.steps ?? []),
    activity.teaching?.example?.takeaway,
    activity.teaching?.commonMistake?.mistake,
    activity.teaching?.commonMistake?.correction,
    activity.correctAnswer,
    activity.feedback,
    ...activity.choices,
  ].filter(Boolean).join(" "));
  const methodText = [
    draft.methodBriefing.name,
    draft.methodBriefing.what,
    draft.methodBriefing.why,
    ...draft.methodBriefing.how,
    draft.methodBriefing.completion,
    ...draft.methodBriefing.personalization,
  ].join(" ");
  const coverageText = [
    draft.coverage.focus,
    ...draft.coverage.essentialIdeas,
    ...draft.coverage.completionEvidence,
    ...draft.coverage.deferredContent,
  ].join(" ");
  const combined = [draft.rationale, coverageText, methodText, ...activityText].join(" ");
  const questions = draft.activities.filter((activity) => (
    activity.type === "multiple_choice" || activity.type === "free_response"
  ));
  // A scheduled-return marker is a lightweight future reminder, not another
  // focused learning activity the learner must complete in this session.
  const focusedActivities = draft.activities.filter((activity) => activity.methodPhase !== "schedule_return");
  const scheduledRetrieval = isScheduledRetrievalSession(context.session);
  const questionIndices = draft.activities
    .map((activity, index) => ({ activity, index }))
    .filter(({ activity }) => activity.type === "multiple_choice" || activity.type === "free_response")
    .map(({ index }) => index);
  // Keep this in lockstep with the product's real time-budget validator.
  const maximumActivities = context.session.estimatedMinutes <= 15
    ? 4
    : context.session.estimatedMinutes <= 30
      ? 5
      : 8;
  const questionIntegrity = questions.every((activity) => {
    if (!activity.concept || !activity.correctAnswer || !activity.feedback || activity.feedback.length < 20) return false;
    if (activity.type === "free_response") return activity.correctAnswer.length >= 15 && activity.choices.length === 0;
    return new Set(activity.choices.map(normalize)).size === activity.choices.length
      && activity.choices.includes(activity.correctAnswer);
  });
  const alignedActivities = activityText.filter((text) => TASK_PATTERNS[taskFamily].test(text)).length;
  const progression = scheduledRetrieval
    ? draft.activities.length === 3 && draft.activities.every((activity) => activity.type === "multiple_choice")
    : questionIndices.length >= 2
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
  const noOverclaim = !/learns? best|learning style|brain type|visual learner|auditory learner|kinesthetic learner|because (you have|of your) adhd|diagnos(?:is|ed|e)\b/i.test(combined);
  const visiblePersonalization = draft.methodBriefing.personalization.length >= 1
    && draft.methodBriefing.personalization.every((reason) => reason.trim().length >= 20)
    && draft.methodBriefing.personalization.every((reason) => /you|your|session|support|example|step|practice|review|question|check|retrieval|scheduled return|attempt|miss|misconception|model|result|performance|pacing/i.test(reason));
  const routing = buildLearningScienceRoutingBrief({
    learningIntent: context.learningGoal.learningIntent,
    sessionLearningMode: context.session.learningMode,
    goalTitle: context.learningGoal.title,
    goalTopic: context.learningGoal.topic,
    goalKind: context.learningGoal.kind,
    sessionTitle: context.session.title,
    sessionObjective: context.session.objective,
    plannedMethod: context.session.method,
    plannedMethodReason: context.session.methodReason,
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    interruptionCount: context.recentInterruptions.length,
  });
  const methodInstructionComplete = draft.methodBriefing.learningMode === routing.sessionLearningMode
    && draft.methodBriefing.taskType === routing.taskType
    && (scheduledRetrieval
      ? draft.methodBriefing.methodId === "retrieval_practice"
      : routing.allowedMethodIds.includes(draft.methodBriefing.methodId))
    && draft.methodBriefing.how.length >= 2
    && draft.methodBriefing.what.length >= 15
    && draft.methodBriefing.why.length >= 20
    && draft.methodBriefing.completion.length >= 15;
  const expectedOpeningPhase = methodFidelityContractForPrompt(
    draft.methodBriefing.methodId,
    draft.methodBriefing.learningMode,
  ).orderedPhases[0];
  const firstActivityMatchesApproach = draft.activities[0]?.methodPhase === expectedOpeningPhase;
  const methodFidelityIssue = scheduledRetrieval
    ? null
    : validateMethodFidelity({
      methodId: draft.methodBriefing.methodId,
      learningMode: draft.methodBriefing.learningMode,
      activities: draft.activities,
    });
  const requiredActivities = draft.activities.filter((activity) => activity.requiredForCompletion);
  const requiredMinutes = requiredActivities.reduce((total, activity) => total + activity.estimatedMinutes, 0);
  const totalMinutes = draft.activities.reduce((total, activity) => total + activity.estimatedMinutes, 0);
  const timeBudgetHonest = requiredMinutes <= context.session.estimatedMinutes
    && totalMinutes <= context.session.estimatedMinutes + 2;
  const requiredQuestionCount = requiredActivities.filter((activity) => (
    activity.type === "multiple_choice" || activity.type === "free_response"
  )).length;
  const completionContractIssue = validateSessionCompletionContract({
    essentialIdeas: draft.coverage.essentialIdeas,
    evidenceMap: draft.coverage.evidenceMap,
    activities: draft.activities,
  });
  const completionIsEvidenceBased = draft.coverage.completionEvidence.length > 0
    && requiredQuestionCount > 0
    && completionContractIssue === null;
  const teachingActivities = draft.activities.filter((activity) => (
    activity.type === "instruction"
    && Boolean(activity.teaching || ("lessonBrief" in activity && activity.lessonBrief))
  ));
  const teachingIsSubstantive = draft.methodBriefing.learningMode !== "learn"
    || teachingActivities.some((activity) => {
      if (activity.teaching
        && activity.teaching.explanation.length >= 80
        && Boolean(activity.teaching.example || activity.teaching.commonMistake)) {
        return true;
      }
      const lessonBrief = "lessonBrief" in activity
        ? (activity as { lessonBrief?: LessonBrief | null }).lessonBrief
        : null;
      return Boolean(
        lessonBrief
        && lessonBrief.essentialIdeas.length > 0
        && lessonBrief.contentRequirements.teachEveryEssentialIdea
        && lessonBrief.contentRequirements.includeCommonMixup,
      );
    });
  const questionContextIssue = validateSessionQuestionContext(draft);
  const contentSpecificityIssue = validateSessionContentSpecificity({
    draft,
    goalTopic: context.learningGoal.topic,
    sessionObjective: context.session.objective,
  });
  const deliveryPolicy = generatedDeliveryPolicy ?? buildSessionDeliveryPolicy({
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    recentInterruptions: context.recentInterruptions,
    learningMode: context.session.learningMode,
    estimatedMinutes: context.session.estimatedMinutes,
  });
  const visibleAdaptationIssue = validateVisibleAdaptation(
    draft.methodBriefing.personalization,
    deliveryPolicy,
  );

  const checks: SessionQualityCheck[] = [
    check("activity_pacing", "Activity count fits the session", focusedActivities.length >= 3 && focusedActivities.length <= maximumActivities, 10, true, `${focusedActivities.length}/${maximumActivities} maximum focused activities for ${context.session.estimatedMinutes} minutes`),
    check("active_practice", "Session requires active learner effort", questions.length >= 2, 15, true, `${questions.length} retrieval or knowledge-check activities`),
    check("answer_integrity", "Questions include usable answers and feedback", questionIntegrity, 15, true, `${questions.length} question activities inspected`),
    check("task_alignment", "Activities fit the learning task", scheduledRetrieval || alignedActivities >= Math.ceil(draft.activities.length * 0.5), 15, true, scheduledRetrieval ? "Scheduled reviews use the bounded retrieval format" : `${alignedActivities} of ${draft.activities.length} activities align with ${taskFamily.replace("_", " ")}`),
    check("learning_progression", "Session moves from support into practice", progression, 10, true, "Checked instruction and question order"),
    check("source_grounding", "Learner materials remain the factual anchor", sourceGrounded, 10, true, context.materials.length ? `${matchedSourceTerms.length}/${expectedSourceTerms.length} expected source concepts used` : "No uploaded source"),
    check("weak_concept_priority", "Known review concepts are addressed", priorityConceptsUsed, 10, true, reviewConcepts.length ? `Review concepts: ${reviewConcepts.join(", ")}` : "No prior review signal"),
    check("outside_guidance", "Outside-app work receives concrete directions", outsideGuidance, 5, true, context.learningGoal.studyMode === "outside_yova" ? "Outside-work instruction inspected" : "Inside-YOVA session"),
    check("method_instruction", "Method briefing explains what, why, how, and done", methodInstructionComplete, 0, true, `${draft.methodBriefing.methodId} for ${draft.methodBriefing.taskType}`),
    check("method_fidelity", "Activities actually execute the named learning method", methodFidelityIssue === null, 0, true, methodFidelityIssue ?? `Required ${draft.methodBriefing.methodId} phases appear in order`),
    check("learning_approach", "The session starts with the method's correct first action", firstActivityMatchesApproach, 0, true, `${draft.methodBriefing.methodId} starts with ${draft.activities[0]?.methodPhase ?? "nothing"}`),
    check("honest_time_budget", "Required content fits the stated time window", timeBudgetHonest, 0, true, `${requiredMinutes} required and ${totalMinutes} total minutes inside a ${context.session.estimatedMinutes}-minute window`),
    check("content_completion", "Every target idea has required learning evidence", completionIsEvidenceBased, 0, true, completionContractIssue ?? `${draft.coverage.essentialIdeas.length} essential ideas mapped to ${requiredQuestionCount} required checks`),
    check("question_context", "Every question includes the context needed to answer", questionContextIssue === null, 0, true, questionContextIssue ?? `${questions.length} self-contained questions inspected`),
    check("content_specificity", "The lesson names and teaches the actual subject content", contentSpecificityIssue === null, 0, true, contentSpecificityIssue ?? "Topic language and teaching coverage inspected"),
    check("substantive_teaching", "Learning sessions teach before they test", teachingIsSubstantive, 0, true, `${teachingActivities.length} modeled or streamed teaching activities inspected`),
    check("visible_personalization", "The learner can see a concrete evidence-linked delivery adjustment", visiblePersonalization && visibleAdaptationIssue === null, 0, true, visibleAdaptationIssue ?? `${draft.methodBriefing.personalization.length} learner-facing adjustment explanations inspected`),
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

import type { CoreMethodId, LearningTaskType } from "@/lib/learning/method-catalog";
import type { MethodRoutingInput } from "@/lib/learning/method-router";
import type { MethodOutcomeSignal } from "@/lib/personalization/method-outcomes";

/**
 * Fixture learners used to prove personalization is actually running.
 *
 * These exist so the same goal and material can be routed for several different
 * learners and compared. Without them, "personalization works" is an assertion
 * nobody can check; with them it is a test that fails the moment routing stops
 * responding to learner state.
 *
 * Each persona describes operational study tendencies the learner reported, and
 * optionally the results YOVA has observed. None of them describe a learning
 * style, a diagnosis, or a fixed learner type.
 */

export type LearnerPersona = {
  id: string;
  name: string;
  /** What this persona is meant to demonstrate about routing. */
  summary: string;
  declaredProfile: MethodRoutingInput["learnerProfile"];
  observedMethodSignals: MethodOutcomeSignal[];
};

function emptyProfile(): NonNullable<MethodRoutingInput["learnerProfile"]> {
  return {
    commonBlocker: null,
    guidancePreference: null,
    explanationPreference: null,
    focusFrequency: null,
    startingPattern: null,
    primaryImprovementGoal: null,
    processingPreference: null,
    memoryChallenge: null,
    supportPreference: null,
    workspacePreference: null,
    freeformContext: null,
    observationCorrection: null,
  };
}

function observed(
  methodId: CoreMethodId,
  status: MethodOutcomeSignal["status"],
  sessions: number,
  scope: { taskType: LearningTaskType; knowledgeStage: MethodOutcomeSignal["knowledgeStage"] },
): MethodOutcomeSignal {
  return {
    methodId,
    methodName: methodId.replaceAll("_", " "),
    taskType: scope.taskType,
    knowledgeStage: scope.knowledgeStage,
    comparisonLabel: `${scope.taskType.replaceAll("_", " ")} · ${scope.knowledgeStage.replaceAll("_", " ")}`,
    sessions,
    checkedAnswers: sessions * 4,
    accuracyPercent: status === "promising" ? 86 : 48,
    difficultRatings: status === "needs_more_support" ? sessions : 0,
    status,
    evidence: `${sessions} comparable sessions`,
    deliveryGuidance: "fixture",
  };
}

export const LEARNER_PERSONAS: LearnerPersona[] = [
  {
    id: "blank_slate",
    name: "No profile yet",
    summary: "Told YOVA nothing. Should receive the default method for the task and stage.",
    declaredProfile: null,
    observedMethodSignals: [],
  },
  {
    id: "example_led",
    name: "Needs a concrete example first",
    summary: "Should be moved toward worked examples wherever they are already valid.",
    declaredProfile: {
      ...emptyProfile(),
      explanationPreference: "A concrete example first",
      guidancePreference: "Clear structure",
    },
    observedMethodSignals: [],
  },
  {
    id: "forgets_quickly",
    name: "Loses material after a few days",
    summary: "Should be moved toward retrieval and spaced review wherever they are valid.",
    declaredProfile: {
      ...emptyProfile(),
      memoryChallenge: "I forget after a few days",
    },
    observedMethodSignals: [],
  },
  {
    id: "confuses_similar",
    name: "Mixes up similar ideas",
    summary: "Should be moved toward discrimination and interleaving.",
    declaredProfile: {
      ...emptyProfile(),
      primaryImprovementGoal: "I confuse similar ideas constantly",
    },
    observedMethodSignals: [],
  },
  {
    id: "wants_challenge",
    name: "Finds guided work too easy",
    summary: "Should be moved toward independent testing and error repair.",
    declaredProfile: {
      ...emptyProfile(),
      guidancePreference: "Least guidance",
      supportPreference: "It is usually too easy and I get bored",
    },
    observedMethodSignals: [],
  },
  {
    id: "examples_not_working",
    name: "Says examples help, but they have not",
    summary:
      "Declared preference points at worked examples while repeated results say otherwise. "
      + "Observed evidence should win once it has repeated.",
    declaredProfile: {
      ...emptyProfile(),
      explanationPreference: "A concrete example first",
    },
    observedMethodSignals: [
      observed("worked_example_fading", "needs_more_support", 6, {
        taskType: "problem_solving",
        knowledgeStage: "developing",
      }),
    ],
  },
];

/**
 * A routing input with everything except the learner held constant, so any
 * difference in the resulting route is attributable to learner state alone.
 */
export function personaRoutingInput(
  persona: LearnerPersona,
  overrides: Partial<MethodRoutingInput> = {},
): MethodRoutingInput {
  return {
    learningIntent: "study",
    sessionLearningMode: "study",
    goalTitle: "Cell energy exam",
    goalTopic: "Cellular respiration and the electron transport chain",
    goalKind: "test",
    sessionTitle: "Work through cellular respiration",
    sessionObjective: "Explain and apply how cells release usable energy",
    // Deliberately blank so no previously planned method pins the route.
    plannedMethod: "",
    plannedMethodReason: "",
    learnerProfile: persona.declaredProfile,
    recentResults: [],
    interruptionCount: 0,
    observedMethodSignals: persona.observedMethodSignals,
    ...overrides,
  };
}

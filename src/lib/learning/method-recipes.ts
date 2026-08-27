import type { SessionLearningMode } from "@/lib/domain";
import type {
  CoreMethodId,
  LearningTaskType,
} from "@/lib/learning/method-catalog";
import type { MethodPhase } from "@/lib/learning/method-fidelity";
import type { KnowledgeStage } from "@/lib/learning/method-eligibility";

export const METHOD_RECIPE_POLICY_VERSION = "method_recipe_v1" as const;
export const BLURTING_SUPPORTING_TECHNIQUE_ID = "blurting_v1" as const;
export const BLURTING_VISIBLE_METHOD_NAME = "Blurting" as const;
export const BLURTING_RUNTIME_FORMAT = "broad_recall_v1" as const;
export const BLURTING_MAX_ACTIVE_MINUTES = 60 as const;
export const BLURTING_ORDERED_PHASES = Object.freeze([
  "retrieve",
  "repair",
  "transfer",
] as const satisfies readonly MethodPhase[]);

const BLURTING_TASK_TYPES: readonly LearningTaskType[] = [
  "conceptual_learning",
  "reading_to_quiz",
];
const BLURTING_KNOWLEDGE_STAGES: readonly KnowledgeStage[] = [
  "developing",
  "retrieval_ready",
];

export type MethodRecipePolicyInput = Readonly<{
  /** A server-owned rollout decision. Omission deliberately means disabled. */
  blurtingEnabled?: boolean;
  learningMode: SessionLearningMode;
  primaryMethodId: CoreMethodId;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  isReview: boolean;
  activeMinutes: number;
  activeTargetCount: number;
  comparisonSourceAvailable: boolean;
}>;

export type BaselineMethodRecipeDecision = Readonly<{
  kind: "baseline";
  policyVersion: typeof METHOD_RECIPE_POLICY_VERSION;
  primaryMethodId: CoreMethodId;
  recipeId: null;
  /** Safe to copy into a StudyRoute rule-trace entry. */
  reason: string;
}>;

export type BlurtingMethodRecipeDecision = Readonly<{
  kind: "recipe";
  policyVersion: typeof METHOD_RECIPE_POLICY_VERSION;
  recipeId: typeof BLURTING_SUPPORTING_TECHNIQUE_ID;
  primaryMethodId: "retrieval_practice";
  visibleMethodName: typeof BLURTING_VISIBLE_METHOD_NAME;
  visibleSupportingTechniqueId: typeof BLURTING_SUPPORTING_TECHNIQUE_ID;
  orderedPhases: typeof BLURTING_ORDERED_PHASES;
  runtimeFormat: typeof BLURTING_RUNTIME_FORMAT;
  /** Safe to copy into a StudyRoute rule-trace entry. */
  reason: string;
}>;

export type MethodRecipeDecision =
  | BaselineMethodRecipeDecision
  | BlurtingMethodRecipeDecision;

/**
 * Selects only the recipe variant layered over an already-selected core
 * method. It never changes the primary method and performs no environment or
 * persistence reads, so rollout authority remains with its server caller.
 */
export function selectMethodRecipe(
  input: MethodRecipePolicyInput,
): MethodRecipeDecision {
  const baselineReason = ineligibleBlurtingReason(input);
  if (baselineReason) {
    return Object.freeze({
      kind: "baseline",
      policyVersion: METHOD_RECIPE_POLICY_VERSION,
      primaryMethodId: input.primaryMethodId,
      recipeId: null,
      reason: baselineReason,
    });
  }

  return Object.freeze({
    kind: "recipe",
    policyVersion: METHOD_RECIPE_POLICY_VERSION,
    recipeId: BLURTING_SUPPORTING_TECHNIQUE_ID,
    primaryMethodId: "retrieval_practice",
    visibleMethodName: BLURTING_VISIBLE_METHOD_NAME,
    visibleSupportingTechniqueId: BLURTING_SUPPORTING_TECHNIQUE_ID,
    orderedPhases: BLURTING_ORDERED_PHASES,
    runtimeFormat: BLURTING_RUNTIME_FORMAT,
    reason: `Blurting selected under ${METHOD_RECIPE_POLICY_VERSION}: ordinary Practice retrieval for ${input.taskType}/${input.knowledgeStage}, ${input.activeMinutes} active minutes, ${input.activeTargetCount} active target${input.activeTargetCount === 1 ? "" : "s"}, and a comparison source satisfy the recipe boundary.`,
  });
}

function ineligibleBlurtingReason(input: MethodRecipePolicyInput) {
  if (input.blurtingEnabled !== true) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: its server-owned rollout is disabled.`;
  }
  if (input.learningMode !== "study") {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: it is available only in Practice mode.`;
  }
  if (input.primaryMethodId !== "retrieval_practice") {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: it is a retrieval_practice variant and cannot replace ${input.primaryMethodId}.`;
  }
  if (!BLURTING_TASK_TYPES.includes(input.taskType)) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: ${input.taskType} is outside its conceptual-learning and reading boundary.`;
  }
  if (!BLURTING_KNOWLEDGE_STAGES.includes(input.knowledgeStage)) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: ${input.knowledgeStage} is not a non-novice stage.`;
  }
  if (input.isReview) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: scheduled reviews retain their separate recipe.`;
  }
  if (input.activeMinutes < 10) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: ${input.activeMinutes} active minutes cannot hold retrieve, repair, and transfer.`;
  }
  if (input.activeMinutes > BLURTING_MAX_ACTIVE_MINUTES) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: ${input.activeMinutes} active minutes exceed its ${BLURTING_MAX_ACTIVE_MINUTES}-minute representable boundary.`;
  }
  if (input.activeTargetCount < 1 || input.activeTargetCount > 3) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: ${input.activeTargetCount} active targets are outside its one-to-three-target boundary.`;
  }
  if (!input.comparisonSourceAvailable) {
    return `Blurting was not selected under ${METHOD_RECIPE_POLICY_VERSION}: repair requires a comparison source.`;
  }
  return null;
}

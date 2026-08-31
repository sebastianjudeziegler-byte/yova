import type { SessionLearningMode, StudyMode } from "@/lib/domain";
import type {
  CoreMethodId,
  LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  isMethodEligibleFor,
  type KnowledgeStage,
} from "@/lib/learning/method-eligibility";
import {
  methodRuntimeKindFor,
  type MethodRuntimeKind,
} from "@/lib/session-generation/method-runtime";

export const METHOD_RUNTIME_CAPABILITY_POLICY_VERSION =
  "method_runtime_capability_v1" as const;

export const STREAMED_TEACHING_ROUTE_METHOD_IDS = [
  "self_explanation",
  "worked_example_fading",
  "retrieval_practice",
] as const satisfies readonly CoreMethodId[];

export const RELIABLE_SESSION_METHOD_KEYS = [
  "learn:self_explanation",
  "learn:worked_example_fading",
  "study:practice_problems",
  "study:retrieval_practice",
  "study:worked_example_fading",
] as const satisfies readonly `${SessionLearningMode}:${CoreMethodId}`[];

export const BOUNDED_STUDY_RECOVERY_METHOD_IDS = [
  "retrieval_practice",
  "spaced_retrieval",
  "worked_example_fading",
] as const satisfies readonly CoreMethodId[];

export const BOUNDED_LEARN_RECOVERY_METHOD_IDS = [
  "retrieval_practice",
  "self_explanation",
  "worked_example_fading",
] as const satisfies readonly CoreMethodId[];

export type StreamedTeachingRouteMethod =
  (typeof STREAMED_TEACHING_ROUTE_METHOD_IDS)[number];
export type BoundedStudyRecoveryMethod =
  (typeof BOUNDED_STUDY_RECOVERY_METHOD_IDS)[number];
export type BoundedLearnRecoveryMethod =
  (typeof BOUNDED_LEARN_RECOVERY_METHOD_IDS)[number];

export type MethodPrimaryGenerationPath =
  | "streamed"
  | "reliable_or_full"
  | "full";

export type MethodDeliveryContract =
  | { kind: "dedicated_runtime"; runtimeKind: MethodRuntimeKind }
  | { kind: "validated_phase_contract"; runtimeKind: null };

export type MethodRuntimeCapability = DeepReadonly<{
  policyVersion: typeof METHOD_RUNTIME_CAPABILITY_POLICY_VERSION;
  status: "supported" | "ineligible";
  methodId: CoreMethodId;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
  executionEnvironment: StudyMode;
  primaryGenerationPath: MethodPrimaryGenerationPath | "none";
  delivery: MethodDeliveryContract;
  boundedRecovery: "candidate" | "none";
  /** A built-in outage lesson must prove the exact committed phase recipe. */
  builtInFallback: "exact_recipe_validation_required";
  reason: string;
}>;

/**
 * Describes what YOVA can actually render and validate for one eligible
 * method. This is an engineering capability registry, not another pedagogy
 * router: it may reject an ineligible method, but it never changes the
 * task/stage/mode eligibility set or chooses a replacement.
 */
export function methodRuntimeCapabilityFor({
  methodId,
  taskType,
  knowledgeStage,
  learningMode,
  executionEnvironment,
}: {
  methodId: CoreMethodId;
  taskType: LearningTaskType;
  knowledgeStage: KnowledgeStage;
  learningMode: SessionLearningMode;
  executionEnvironment: StudyMode;
}): MethodRuntimeCapability {
  const runtimeKind = methodRuntimeKindFor(methodId);
  const delivery: MethodDeliveryContract = runtimeKind
    ? { kind: "dedicated_runtime", runtimeKind }
    : { kind: "validated_phase_contract", runtimeKind: null };
  const eligible = isMethodEligibleFor({
    methodId,
    taskType,
    knowledgeStage,
    learningMode,
  });
  if (!eligible) {
    return deepFreeze({
      policyVersion: METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
      status: "ineligible",
      methodId,
      taskType,
      knowledgeStage,
      learningMode,
      executionEnvironment,
      primaryGenerationPath: "none",
      delivery,
      boundedRecovery: "none",
      builtInFallback: "exact_recipe_validation_required",
      reason: "The method is outside the task, knowledge-stage, and Learn/Practice eligibility boundary, so no runtime may execute it for this route.",
    });
  }

  const primaryGenerationPath = executionEnvironment === "inside_yova"
    && learningMode === "learn"
    && supportsStreamedTeachingRouteMethod(methodId)
    ? "streamed"
    : executionEnvironment === "inside_yova"
      && supportsReliableSessionMethod(learningMode, methodId)
      ? "reliable_or_full"
      : "full";
  const boundedRecovery = learningMode === "learn"
    ? supportsBoundedLearnRecoveryMethod(methodId)
    : executionEnvironment === "inside_yova"
      && supportsBoundedStudyRecoveryMethod(methodId)
      ? true
      : false;
  const deliveryDescription = delivery.kind === "dedicated_runtime"
    ? `the dedicated ${delivery.runtimeKind.replaceAll("_", " ")} interaction`
    : "the generic activity renderer under the method's validated phase contract";
  const recoveryDescription = boundedRecovery
    ? "A bounded model recovery is possible only when its additional source, target, pacing, and evidence checks also pass."
    : "If primary generation fails, YOVA must retry or show recovery instead of relabeling a generic fallback as this method.";

  return deepFreeze({
    policyVersion: METHOD_RUNTIME_CAPABILITY_POLICY_VERSION,
    status: "supported",
    methodId,
    taskType,
    knowledgeStage,
    learningMode,
    executionEnvironment,
    primaryGenerationPath,
    delivery,
    boundedRecovery: boundedRecovery ? "candidate" : "none",
    builtInFallback: "exact_recipe_validation_required",
    reason: `YOVA can deliver this route through ${primaryGenerationPath.replaceAll("_", " ")} generation and ${deliveryDescription}. ${recoveryDescription}`,
  });
}

export function supportsStreamedTeachingRouteMethod(
  methodId: CoreMethodId,
): methodId is StreamedTeachingRouteMethod {
  return includes(STREAMED_TEACHING_ROUTE_METHOD_IDS, methodId);
}

export function supportsReliableSessionMethod(
  learningMode: SessionLearningMode,
  methodId: CoreMethodId,
) {
  return includes(RELIABLE_SESSION_METHOD_KEYS, `${learningMode}:${methodId}`);
}

export function supportsBoundedStudyRecoveryMethod(
  methodId: CoreMethodId,
): methodId is BoundedStudyRecoveryMethod {
  return includes(BOUNDED_STUDY_RECOVERY_METHOD_IDS, methodId);
}

export function supportsBoundedLearnRecoveryMethod(
  methodId: CoreMethodId,
): methodId is BoundedLearnRecoveryMethod {
  return includes(BOUNDED_LEARN_RECOVERY_METHOD_IDS, methodId);
}

function includes<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): candidate is Values[number] {
  return (values as readonly string[]).includes(candidate);
}

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type DeepReadonly<T> = T extends Primitive | ((...args: never[]) => unknown)
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

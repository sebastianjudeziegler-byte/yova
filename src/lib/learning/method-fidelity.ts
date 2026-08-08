import type { SessionLearningMode } from "@/lib/domain";
import type { CoreMethodId } from "@/lib/learning/method-catalog";

export const METHOD_PHASES = [
  "orient",
  "model",
  "read_source",
  "retrieve",
  "explain",
  "guided_practice",
  "independent_practice",
  "discriminate",
  "repair",
  "evidence_match",
  "code_trace",
  "transfer",
  "schedule_return",
  "reflect",
] as const;

export type MethodPhase = (typeof METHOD_PHASES)[number];

type MethodActivity = {
  methodPhase: MethodPhase;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
};

type MethodFidelityContract = {
  purpose: string;
  requiredPhases: MethodPhase[];
  orderedPhases: MethodPhase[];
  minimumDistinctQuestionConcepts?: number;
  minimumQuestionsBeforeRepair?: number;
};

const CONTRACTS: Record<CoreMethodId, MethodFidelityContract> = {
  retrieval_practice: {
    purpose: "Attempt from memory before reviewing, repair the exposed gap, and preserve a later independent check.",
    requiredPhases: ["retrieve", "repair"],
    orderedPhases: ["retrieve", "repair"],
  },
  spaced_retrieval: {
    purpose: "Retrieve now and create an explicit delayed return instead of repeating the item immediately.",
    requiredPhases: ["retrieve", "schedule_return"],
    orderedPhases: ["retrieve", "schedule_return"],
  },
  self_explanation: {
    purpose: "Study an accurate model, explain the causal relationship from memory, and compare the explanation with the model.",
    requiredPhases: ["model", "explain"],
    orderedPhases: ["model", "explain"],
  },
  worked_example_fading: {
    purpose: "Move from a complete worked model to reduced guidance and then a comparable independent attempt.",
    requiredPhases: ["model", "guided_practice", "independent_practice"],
    orderedPhases: ["model", "guided_practice", "independent_practice"],
  },
  interleaved_practice: {
    purpose: "Mix related categories so the learner must identify the type and select the method before applying it.",
    requiredPhases: ["discriminate", "independent_practice"],
    orderedPhases: ["discriminate", "independent_practice"],
    minimumDistinctQuestionConcepts: 2,
  },
  read_recall_review: {
    purpose: "Use a guiding prompt, read a bounded source section, recall it closed-source, and repair the comparison.",
    requiredPhases: ["read_source", "retrieve", "repair"],
    orderedPhases: ["read_source", "retrieve", "repair"],
  },
  retrieval_based_outlining: {
    purpose: "Generate the claim and structure first, then return to the source to match evidence before drafting.",
    requiredPhases: ["retrieve", "evidence_match", "independent_practice"],
    orderedPhases: ["retrieve", "evidence_match", "independent_practice"],
  },
  scaffolded_coding: {
    purpose: "Trace a working example, complete a partially scaffolded version, and produce or debug a comparable solution independently.",
    requiredPhases: ["code_trace", "guided_practice", "independent_practice"],
    orderedPhases: ["code_trace", "guided_practice", "independent_practice"],
  },
  practice_test_error_repair: {
    purpose: "Complete a representative unsupported set before feedback, repair each error, and apply the correction to a different item.",
    requiredPhases: ["retrieve", "repair", "transfer"],
    orderedPhases: ["retrieve", "repair", "transfer"],
    minimumQuestionsBeforeRepair: 2,
  },
};

export function methodFidelityContractsForPrompt(ids: CoreMethodId[], learningMode: SessionLearningMode) {
  return ids.map((id) => methodFidelityContractForPrompt(id, learningMode));
}

export function methodFidelityContractForPrompt(id: CoreMethodId, learningMode: SessionLearningMode) {
  return { id, ...contractForMode(id, learningMode) };
}

export function validateMethodFidelity({
  methodId,
  learningMode,
  activities,
}: {
  methodId: CoreMethodId;
  learningMode: SessionLearningMode;
  activities: MethodActivity[];
}): string | null {
  const contract = contractForMode(methodId, learningMode);
  const phases = activities.map((activity) => activity.methodPhase);
  const invalidPhaseActivity = activities.find((activity) => !phaseMatchesActivity(activity));
  if (invalidPhaseActivity) {
    return `${invalidPhaseActivity.methodPhase} is attached to an activity type that cannot perform that learning phase.`;
  }
  const missing = contract.requiredPhases.filter((phase) => !phases.includes(phase));
  if (missing.length > 0) {
    return `${methodId} is missing required learning phase${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`;
  }

  let priorIndex = -1;
  for (const phase of contract.orderedPhases) {
    const index = phases.findIndex((candidate, candidateIndex) => candidateIndex > priorIndex && candidate === phase);
    if (index < 0) return `${methodId} does not follow its required phase order: ${contract.orderedPhases.join(" → ")}.`;
    priorIndex = index;
  }

  const questionActivities = activities.filter((activity) => activity.type === "multiple_choice" || activity.type === "free_response");
  if (contract.minimumDistinctQuestionConcepts) {
    const concepts = new Set(questionActivities.map((activity) => activity.concept?.trim().toLowerCase()).filter(Boolean));
    if (concepts.size < contract.minimumDistinctQuestionConcepts) {
      return `${methodId} needs at least ${contract.minimumDistinctQuestionConcepts} distinct question categories so the learner must discriminate between approaches.`;
    }
  }

  if (contract.minimumQuestionsBeforeRepair) {
    const repairIndex = phases.indexOf("repair");
    const attemptsBeforeRepair = activities.slice(0, repairIndex).filter((activity) => (
      activity.type === "multiple_choice" || activity.type === "free_response"
    )).length;
    if (attemptsBeforeRepair < contract.minimumQuestionsBeforeRepair) {
      return `${methodId} needs at least ${contract.minimumQuestionsBeforeRepair} unsupported questions before answer review begins.`;
    }
  }

  return null;
}

function contractForMode(methodId: CoreMethodId, learningMode: SessionLearningMode): MethodFidelityContract {
  const base = CONTRACTS[methodId];
  if (methodId === "read_recall_review" && learningMode === "study") {
    return {
      ...base,
      requiredPhases: ["retrieve", "read_source", "transfer"],
      orderedPhases: ["retrieve", "read_source", "transfer"],
      purpose: "Attempt recall first, reread only the exposed gap, then verify the correction with a different prompt.",
    };
  }
  if (learningMode !== "learn" || base.requiredPhases.includes("model")) return base;

  return {
    ...base,
    purpose: `Build an accurate subject model first. Then ${base.purpose.charAt(0).toLowerCase()}${base.purpose.slice(1)}`,
    requiredPhases: ["model", ...base.requiredPhases],
    orderedPhases: ["model", ...base.orderedPhases],
  };
}

function phaseMatchesActivity(activity: MethodActivity) {
  const activeQuestion = activity.type === "multiple_choice" || activity.type === "free_response";
  if (["retrieve", "explain", "guided_practice", "independent_practice", "discriminate", "transfer"].includes(activity.methodPhase)) {
    return activeQuestion;
  }
  if (activity.methodPhase === "model" || activity.methodPhase === "read_source") {
    return activity.type === "instruction";
  }
  if (activity.methodPhase === "reflect") return activity.type === "reflection";
  if (activity.methodPhase === "schedule_return") return activity.type === "instruction" || activity.type === "reflection";
  return true;
}

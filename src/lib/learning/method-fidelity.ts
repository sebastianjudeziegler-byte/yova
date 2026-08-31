import type { SessionLearningMode } from "@/lib/domain";
import type { CoreMethodId } from "@/lib/learning/method-catalog";

export const METHOD_FIDELITY_POLICY_VERSION = "method_fidelity_v2" as const;

export const METHOD_PHASES = [
  "orient",
  "survey",
  "question",
  "pretest",
  "model",
  "read_source",
  "retrieve",
  "explain",
  "reexplain",
  "guided_practice",
  "independent_practice",
  "discriminate",
  "connect",
  "repair",
  "evidence_match",
  "code_trace",
  "transfer",
  "schedule_return",
  "reflect",
  "review",
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
    purpose: "Study an accurate model, explain it in plain language, repair the comparison, and explain it again without copying.",
    requiredPhases: ["model", "explain", "repair", "reexplain"],
    orderedPhases: ["model", "explain", "repair", "reexplain"],
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
    purpose: "Survey a bounded source, form a guiding question, read for it, recall the answer closed-source, and review the comparison.",
    requiredPhases: ["survey", "question", "read_source", "retrieve", "review"],
    orderedPhases: ["survey", "question", "read_source", "retrieve", "review"],
  },
  pretesting: {
    purpose: "Make a brief ungraded prediction before instruction, study an accurate model, and answer a different follow-up. Only an observed follow-up miss may create a repair at runtime.",
    requiredPhases: ["pretest", "model", "transfer"],
    orderedPhases: ["pretest", "model", "transfer"],
  },
  concept_mapping: {
    purpose: "Retrieve the important concepts, connect them with explicit relationship phrases, verify the links, and repair the map.",
    requiredPhases: ["retrieve", "connect", "evidence_match", "repair"],
    orderedPhases: ["retrieve", "connect", "evidence_match", "repair"],
  },
  practice_problems: {
    purpose: "Attempt a representative problem independently and solve a changed-context transfer problem. Only an observed learner miss may create a repair at runtime.",
    requiredPhases: ["independent_practice", "transfer"],
    orderedPhases: ["independent_practice", "transfer"],
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

/**
 * What each phase's activity must actually do, and which activity types can do
 * it.
 *
 * The contract handed to the model previously listed phase names alone, which
 * left the model to infer what, say, a repair activity contains. It reliably
 * did not: a memorization session failed four consecutive generations for a
 * missing repair phase, each attempt having been told the phase was missing by
 * name. Naming the requirement is what the name alone could not carry.
 */
const PHASE_REQUIREMENTS: Record<MethodPhase, string> = {
  orient: "An instruction activity stating today's target and what finishing looks like. No teaching content.",
  survey: "An instruction activity bounding the source and directing attention to its headings, summary, structure, or other high-level organization before close reading.",
  question: "A free-response activity asking the learner to form the question the bounded source should answer before reading it closely.",
  pretest: "A low-stakes multiple-choice or free-response attempt made before instruction. It must be labeled diagnostic and cannot be treated as prior mastery evidence.",
  model: "An instruction activity carrying a teaching block that presents the accurate model: the key idea, how it works, and one concrete example or common mistake.",
  read_source: "An instruction activity directing the learner to a bounded part of their own source, naming what to look for.",
  retrieve: "A multiple-choice or free-response question the learner answers from memory, with the source closed and no hint shown first.",
  explain: "A free-response activity asking the learner to state the relationship or reasoning in their own words, then compare it with the model.",
  reexplain: "A second free-response explanation after repair, phrased in plain language and produced without copying the model.",
  guided_practice: "A question activity that removes some of the support shown in the model while leaving the rest in place.",
  independent_practice: "A question activity that withholds the solution entirely and asks for a complete attempt.",
  discriminate: "A question activity presenting at least two similar cases and asking which applies and why.",
  connect: "A free-response activity requiring named concepts to be joined with explicit relationship phrases rather than decorative lines or proximity.",
  repair: "An activity that names the specific error or gap the previous attempt exposed, states the correct rule beside it, and asks for one corrected attempt. Feedback written inside an earlier question does not satisfy this; repair is its own activity.",
  evidence_match: "A question activity checking a claim against the stated completion evidence.",
  code_trace: "A question activity walking through what the code does, step by step, before changing it.",
  transfer: "A question activity using a different prompt, example, or context from the one already practiced.",
  schedule_return: "An instruction or reflection activity naming what returns later and roughly when.",
  reflect: "A reflection activity asking what is now clear and what is still shaky.",
  review: "A reflection or instruction activity reopening the bounded source, comparing it with closed-source recall, and naming the exact repair.",
};

export function methodFidelityContractForPrompt(id: CoreMethodId, learningMode: SessionLearningMode) {
  const contract = contractForMode(id, learningMode);

  return {
    id,
    ...contract,
    phaseRequirements: contract.requiredPhases.map((phase) => ({
      phase,
      mustContain: PHASE_REQUIREMENTS[phase],
    })),
  };
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

  if (
    (methodId === "pretesting" || methodId === "practice_problems")
    && activities.some((activity) => activity.methodPhase === "repair")
  ) {
    return `${methodId} must create repair only after an observed learner miss at runtime, not pre-author a specific error.`;
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
  if (["explain", "reexplain", "question", "connect"].includes(activity.methodPhase)) {
    return activity.type === "free_response";
  }
  if (["pretest", "retrieve", "guided_practice", "independent_practice", "discriminate", "transfer"].includes(activity.methodPhase)) {
    return activeQuestion;
  }
  if (["model", "read_source", "survey"].includes(activity.methodPhase)) {
    return activity.type === "instruction";
  }
  if (activity.methodPhase === "reflect") return activity.type === "reflection";
  if (activity.methodPhase === "review") return activity.type === "reflection" || activity.type === "instruction";
  if (activity.methodPhase === "schedule_return") return activity.type === "instruction" || activity.type === "reflection";
  return true;
}

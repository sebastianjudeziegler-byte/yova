import {
  resolveRuntimeRepairMode,
  runtimeRepairModeLabel,
  runtimeRepairReason,
} from "@/lib/session-repair/policy";
import type {
  ConcreteRepairMode,
  RuntimeRepairRequest,
  RuntimeRepairSupport,
} from "@/lib/session-repair/schema";

export function buildFallbackRuntimeRepair(request: RuntimeRepairRequest): RuntimeRepairSupport {
  const missingIdeas = request.evaluation?.missingIdeas ?? [];
  const mode = resolveRuntimeRepairMode({
    policy: request.deliveryPolicy,
    confidence: request.confidence,
    learnerAnswer: request.learnerAnswer,
    missingIdeas,
  });
  const draft = fallbackDraft(request, mode, missingIdeas);

  return {
    ...draft,
    mode,
    modeLabel: runtimeRepairModeLabel(mode),
    personalizationReason: runtimeRepairReason(request, mode),
  };
}

function fallbackDraft(
  request: RuntimeRepairRequest,
  mode: ConcreteRepairMode,
  missingIdeas: string[],
) {
  const concept = request.activity.concept;
  const shortConcept = concept.slice(0, 72);
  const reference = request.activity.referenceAnswer;
  const repairModel = reference.length < 40
    ? `${reference}. ${request.activity.rubric}`
    : reference;
  const boundedRepairModel = repairModel.slice(0, 430);
  const firstGap = missingIdeas[0]
    ?? `Focus on the relationship involving ${concept} in the original prompt. Name what changes, what stays fixed, and how the parts connect.`;
  const smallerSteps = missingIdeas.length
    ? missingIdeas.slice(0, 3)
    : splitIntoSteps(boundedRepairModel);

  if (mode === "hint_first") {
    return {
      title: `Use one clue, then retry ${shortConcept}`,
      supportHeading: "One bounded clue",
      explanation: firstGap,
      steps: [],
      retryPrompt: `Answer the original ${shortConcept} prompt again using the clue, without copying the reference answer.`,
      targetReminder: `The target has not changed: explain or apply ${shortConcept} accurately without visible support.`,
    };
  }
  if (mode === "alternate_example") {
    return {
      title: `See ${shortConcept} from another angle`,
      supportHeading: "A different frame for the same idea",
      explanation: `Use this model as a fresh way to organize the idea: ${boundedRepairModel}`,
      steps: smallerSteps,
      retryPrompt: `Now return to the original prompt and explain ${shortConcept} without copying this model.`,
      targetReminder: `The example changes, but the underlying ${shortConcept} relationship and completion target stay the same.`,
    };
  }
  if (mode === "direct_correction") {
    return {
      title: `Replace the mistaken ${shortConcept} relationship`,
      supportHeading: "Direct correction",
      explanation: `The accurate relationship or answer is: ${boundedRepairModel}`,
      steps: missingIdeas.slice(0, 2),
      retryPrompt: `State the corrected ${shortConcept} relationship in your own words and explain what changed from your first answer.`,
      targetReminder: `YOVA is correcting the specific mismatch, not lowering the original ${shortConcept} target.`,
    };
  }
  if (mode === "smaller_steps") {
    return {
      title: `Rebuild ${shortConcept} in smaller steps`,
      supportHeading: "Restore the missing links",
      explanation: "Work through only these pieces, then reconnect them in one complete response.",
      steps: smallerSteps.length ? smallerSteps : [boundedRepairModel],
      retryPrompt: `Use the restored pieces to explain or apply ${shortConcept} as one complete answer.`,
      targetReminder: `The steps add temporary structure. You still finish by producing the complete ${shortConcept} answer.`,
    };
  }
  return {
    title: `Try ${shortConcept} again independently`,
    supportHeading: "Fresh unsupported attempt",
    explanation: "YOVA is preserving another attempt before adding more guidance.",
    steps: [],
    retryPrompt: `Answer the ${shortConcept} prompt again from memory. If the second attempt still misses, YOVA will add a more explicit repair.`,
    targetReminder: `The same ${shortConcept} target remains in place, with no extra model visible yet.`,
  };
}

function splitIntoSteps(value: string) {
  const clauses = value
    .split(/(?<=[.!?;])\s+|,\s+(?:then|while|and)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 5)
    .slice(0, 3);
  return (clauses.length ? clauses : [value]).map((part) => part.slice(0, 220));
}

import type { ConfidenceLevel } from "@/lib/domain";
import type { SessionDeliveryPolicy } from "@/lib/personalization/session-delivery-policy";
import type { ConcreteRepairMode, RuntimeRepairRequest } from "@/lib/session-repair/schema";

const MODE_LABELS: Record<ConcreteRepairMode, string> = {
  hint_first: "One clue first",
  alternate_example: "A different example",
  direct_correction: "Name and replace the error",
  smaller_steps: "Restore one step at a time",
  retry_independently: "Try again without added support",
};

export function resolveRuntimeRepairMode({
  policy,
  confidence,
  learnerAnswer,
  missingIdeas,
}: {
  policy: SessionDeliveryPolicy;
  confidence: ConfidenceLevel | null;
  learnerAnswer: string | null;
  missingIdeas: string[];
}): ConcreteRepairMode {
  if (policy.repair.mode !== "task_aligned") return policy.repair.mode;

  const normalizedAnswer = learnerAnswer?.toLocaleLowerCase() ?? "";
  if (confidence === "very_sure") return "direct_correction";
  if (
    confidence === "guessing"
    || normalizedAnswer.includes("do not know")
    || normalizedAnswer.includes("don't know")
    || normalizedAnswer.includes("dont know")
    || missingIdeas.length >= 2
  ) return "smaller_steps";
  return "hint_first";
}

export function runtimeRepairModeLabel(mode: ConcreteRepairMode) {
  return MODE_LABELS[mode];
}

export function runtimeRepairReason(
  request: RuntimeRepairRequest,
  mode: ConcreteRepairMode,
) {
  if (request.deliveryPolicy.repair.mode !== "task_aligned") {
    const explicitReasons: Record<ConcreteRepairMode, string> = {
      hint_first: "You asked for a small hint when stuck, so YOVA is preserving another attempt before revealing the complete answer.",
      alternate_example: "You asked for another example when stuck, so YOVA is changing the surface case while keeping the same concept.",
      direct_correction: "You asked for direct error explanations, so YOVA is naming the exact mismatch before the retry.",
      smaller_steps: "You asked for smaller steps when stuck, so YOVA is restoring only the missing links before the complete retry.",
      retry_independently: "You asked to retry without help, so YOVA is preserving a fresh unsupported attempt before adding guidance.",
    };
    return explicitReasons[mode];
  }
  if (request.confidence === "very_sure") {
    return "You were very sure about this answer, so YOVA is naming the exact mismatch before asking you to explain it again.";
  }
  if (mode === "smaller_steps") {
    const normalizedAnswer = request.learnerAnswer?.toLocaleLowerCase() ?? "";
    if (
      request.confidence === "guessing"
      || normalizedAnswer.includes("do not know")
      || normalizedAnswer.includes("don't know")
      || normalizedAnswer.includes("dont know")
    ) {
      return "You marked this answer as uncertain, so YOVA is restoring a small amount of structure before asking for the complete response.";
    }
    return "This response showed more than one missing link, so YOVA is restoring the minimum useful structure before another attempt.";
  }
  return "YOVA is giving one bounded cue first so you can repair the gap without turning the retry into copying.";
}

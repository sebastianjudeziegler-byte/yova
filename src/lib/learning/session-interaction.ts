import type { MethodPhase } from "@/lib/learning/method-fidelity";

const CALIBRATION_PHASES = new Set<MethodPhase>([
  "retrieve",
  "explain",
  "independent_practice",
  "discriminate",
  "transfer",
]);

export function shouldRequestConfidence({
  isQuestion,
  isImmediateRepair,
  methodPhase,
}: {
  isQuestion: boolean;
  isImmediateRepair: boolean;
  methodPhase?: MethodPhase;
}) {
  return Boolean(
    isQuestion
      && !isImmediateRepair
      && methodPhase
      && CALIBRATION_PHASES.has(methodPhase),
  );
}

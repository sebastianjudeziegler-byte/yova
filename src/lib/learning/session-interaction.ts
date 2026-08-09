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
  priorConfidenceCaptured = false,
  taughtEarlierInSession = false,
}: {
  isQuestion: boolean;
  isImmediateRepair: boolean;
  methodPhase?: MethodPhase;
  priorConfidenceCaptured?: boolean;
  taughtEarlierInSession?: boolean;
}) {
  const preservesCalibrationGate = methodPhase === "retrieve" || methodPhase === "independent_practice";
  return Boolean(
    isQuestion
      && !isImmediateRepair
      && !priorConfidenceCaptured
      && methodPhase
      && CALIBRATION_PHASES.has(methodPhase)
      && (preservesCalibrationGate || !taughtEarlierInSession),
  );
}

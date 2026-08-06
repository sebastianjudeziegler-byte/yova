import type { SessionInterruption } from "@/lib/domain";

export function resumableSessionProgress(
  planSessionId: string,
  interruptions: SessionInterruption[],
) {
  return interruptions
    .filter((interruption) => (
      interruption.planSessionId === planSessionId
      && interruption.completedSteps >= 1
      && interruption.completedSteps < interruption.totalSteps
    ))
    .sort((left, right) => right.interruptedAt.localeCompare(left.interruptedAt))[0] ?? null;
}

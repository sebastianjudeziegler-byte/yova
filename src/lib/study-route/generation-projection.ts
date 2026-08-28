import type { StudyRoute } from "@/lib/study-route/schema";
import { activeStudyRouteTargetIds } from "@/lib/study-route/targets";

export type LegacySessionGenerationProjection = {
  objective: string;
  method: string;
  methodReason: string;
  activeMinutes: number;
  learningMode: "learn" | "study";
  executionEnvironment: "inside_yova" | "outside_yova";
  topicIds: string[];
  completionEvidence: string[];
};

/** Route-first projection used at the authenticated generation boundary. */
export function studyRouteGenerationProjection({
  route,
  legacy,
}: {
  route: StudyRoute | null | undefined;
  legacy: LegacySessionGenerationProjection;
}): LegacySessionGenerationProjection {
  if (!route) return legacy;
  return {
    objective: route.target.desiredOutcome,
    method: route.approach.visibleMethodName,
    methodReason: route.explanation.shortReason,
    activeMinutes: route.timing.activeMinutes,
    learningMode: route.approach.mode === "learn" ? "learn" : "study",
    executionEnvironment: route.approach.executionEnvironment,
    topicIds: activeStudyRouteTargetIds(route),
    completionEvidence: route.execution.completionEvidence.map((evidence) => evidence.description),
  };
}

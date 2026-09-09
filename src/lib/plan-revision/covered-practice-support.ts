import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

type Profile = { signals: readonly Readonly<{ signalId: string; value: string }>[] };

/** An unchecked report changes the entry activity, not demonstrated mastery.
 * Only already-authorized canonical signals can change support and amount. */
export function applyCoveredPracticeSupport({ route, map, profile }: {
  route: StudyRoute;
  map: PlanKnowledgeMap;
  profile: Profile | null | undefined;
}): StudyRoute {
  const reported = new Set(map.topics.filter(topic => topic.initialEvidence?.source === "learner_report").map(topic => topic.id));
  if (route.approach.mode !== "practice" || !profile || !route.target.targetStates.some(target => reported.has(target.targetId))) return route;
  const signals = new Map(profile.signals.map(signal => [signal.signalId, signal.value]));
  const shortFocus = ["shorter_blocks", "short_blocks_with_changes"].includes(signals.get("focus_pacing") ?? "");
  const supported = shortFocus || signals.get("unfamiliar_entry") === "concrete_example" || signals.get("first_repair") === "hint_first";
  const independent = signals.get("successful_approach") === "explain_from_memory" || signals.get("first_repair") === "direct_correction" || signals.get("focus_pacing") === "steady_block";
  if (!supported && !independent) return route;
  const requiredActivities = route.execution.orderedPhases.length;
  const activityLimit = supported ? requiredActivities : Math.min(20, Math.max(route.execution.activityLimit, requiredActivities + 2));
  const trace = {
    ruleId: "covered_practice_profile_v1", result: supported ? "short_supported_practice" : "independent_practice",
    reason: supported ? "Use a smaller practice block with support available, as requested in the saved profile. The report itself is unverified." : "Use a longer independent practice block before direct correction, as requested in the saved profile. The report itself is unverified.",
    evidenceRefs: [],
  };
  return StudyRouteSchema.parse({
    ...route,
    execution: { ...route.execution, initialSupport: supported ? "supported_start" : "independent_start", activityLimit },
    provenance: { ...route.provenance, ruleTrace: [...route.provenance.ruleTrace.filter(item => item.ruleId !== trace.ruleId), trace] },
  });
}

export function coveredPracticeAmountLabel(route: StudyRoute) {
  return `Up to ${route.execution.activityLimit} activities · ${route.execution.initialSupport === "supported_start" ? "hints available" : "try independently first"} · about ${route.timing.activeMinutes} min`;
}

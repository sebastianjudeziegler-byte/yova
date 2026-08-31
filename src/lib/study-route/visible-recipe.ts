import {
  agencyModeForStudyRouteControlMode,
  explainStudyRouteChange,
  type StudyRouteChangeExplanation,
} from "@/lib/study-route/agency-mode-controller";
import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

export const VISIBLE_STUDY_ROUTE_RECIPE_VERSION =
  "visible_study_route_recipe_v1" as const;

export type VisibleStudyRouteRecipe = DeepReadonly<{
  version: typeof VISIBLE_STUDY_ROUTE_RECIPE_VERSION;
  routeRevisionId: string;
  routeLineageId: string;
  lifecycleStatus: StudyRoute["identity"]["lifecycleStatus"];
  collapsed: {
    sessionType: "Learn" | "Practice";
    primaryMethod: string;
    totalMinutes: number;
    shortReason: string;
  };
  expanded: {
    phases: {
      phaseId: string;
      name: string;
      activeMinutes: number;
    }[];
    activeMinutes: number;
    elapsedMinutes: number;
    timedBreak: {
      minutes: number;
      afterPhaseId: string;
    } | null;
    taskRequirements: string[];
    learnerDeclarations: string[];
    observations: string[];
    uncertainties: string[];
    alternatives: {
      alternativeId: string;
      methodId: StudyRoute["approach"]["primaryMethodId"];
      methodName: string;
      tradeoff: string;
    }[];
    agency: ReturnType<typeof agencyModeForStudyRouteControlMode>;
    changedSincePrevious: StudyRouteChangeExplanation | null;
  };
}>;

/**
 * The serializable domain projection for Home/Agenda's collapsed card and the
 * progressively disclosed setup recipe. It reads no profile state and writes
 * nothing; every claim comes from the exact route revision.
 */
export function visibleStudyRouteRecipe({
  route: routeInput,
  previousRoute: previousInput,
}: {
  route: StudyRoute;
  previousRoute?: StudyRoute | null;
}): VisibleStudyRouteRecipe {
  const route = StudyRouteSchema.parse(routeInput);
  const previous = previousInput ? StudyRouteSchema.parse(previousInput) : null;
  const changedSincePrevious = previous
    ? explainStudyRouteChange(previous, route)
    : null;

  return deepFreeze({
    version: VISIBLE_STUDY_ROUTE_RECIPE_VERSION,
    routeRevisionId: route.identity.routeRevisionId,
    routeLineageId: route.identity.routeLineageId,
    lifecycleStatus: route.identity.lifecycleStatus,
    collapsed: {
      sessionType: route.approach.mode === "learn" ? "Learn" : "Practice",
      primaryMethod: route.approach.visibleMethodName,
      totalMinutes: route.timing.elapsedMinutes,
      shortReason: route.explanation.shortReason,
    },
    expanded: {
      phases: route.execution.orderedPhases.map((phase) => ({
        phaseId: phase.phaseId,
        name: visiblePhaseName(phase.methodPhase),
        activeMinutes: phase.activeMinutes,
      })),
      activeMinutes: route.timing.activeMinutes,
      elapsedMinutes: route.timing.elapsedMinutes,
      timedBreak: route.timing.optionalTimedBreak
        ? {
            minutes: route.timing.optionalTimedBreak.minutes,
            afterPhaseId: route.timing.optionalTimedBreak.afterPhaseId,
          }
        : null,
      taskRequirements: [...route.explanation.taskRequirements],
      learnerDeclarations: [...route.explanation.learnerDeclarations],
      observations: [...route.explanation.observations],
      uncertainties: [...route.explanation.uncertainties],
      alternatives: route.agency.alternatives.slice(0, 2).map((alternative) => ({
        alternativeId: alternative.alternativeId,
        methodId: alternative.primaryMethodId,
        methodName: alternative.visibleMethodName,
        tradeoff: alternative.tradeoff,
      })),
      agency: agencyModeForStudyRouteControlMode(route.agency.controlMode),
      changedSincePrevious,
    },
  });
}

function visiblePhaseName(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
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

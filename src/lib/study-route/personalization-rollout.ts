import { StudyRouteProvenanceSchema } from "@/lib/study-route/schema";

export const PERSONALIZATION_ROLLOUT_POLICY_VERSION =
  "personalization_rollout_v1" as const;
export const PERSONALIZATION_BASELINE_ROUTE_VERSION =
  "task_mastery_v1" as const;
export const PERSONALIZATION_ROUTE_VERSION =
  "personalized_v1" as const;

export const PERSONALIZATION_ROUTE_VERSIONS = [
  PERSONALIZATION_BASELINE_ROUTE_VERSION,
  PERSONALIZATION_ROUTE_VERSION,
] as const;

export type PersonalizationRouteVersion =
  (typeof PERSONALIZATION_ROUTE_VERSIONS)[number];

export type PersonalizationRolloutDecision = Readonly<{
  policyVersion: typeof PERSONALIZATION_ROLLOUT_POLICY_VERSION;
  routeVersion: PersonalizationRouteVersion;
  personalizationEnabled: boolean;
  assignment: "existing_route" | "cohort" | "missing_subject_baseline";
  rolloutPercent: number;
  cohortBucket: number | null;
}>;

/**
 * Parses one server-only percentage flag. Missing configuration fails closed
 * to the task-and-mastery baseline; callers must opt into staged issuance.
 */
export function parsePersonalizationRolloutPercent(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return 0;
  if (!/^\d{1,3}$/.test(normalized)) {
    throw new Error("The personalization rollout flag must be an integer from 0 to 100.");
  }
  const percent = Number(normalized);
  if (percent < 0 || percent > 100) {
    throw new Error("The personalization rollout flag must be an integer from 0 to 100.");
  }
  return percent;
}

/**
 * Assigns only which route policy new work receives. It never alternates
 * methods, consumes learner outcomes, or creates evidence for a method claim.
 * A versioned existing route always keeps its original assignment so a kill
 * switch rolls back new issuance without mutating accepted sessions.
 */
export function resolvePersonalizationRollout({
  rolloutPercent,
  subjectKey,
  currentRouterVersion,
}: {
  rolloutPercent: number;
  subjectKey: string | null;
  currentRouterVersion?: string | null;
}): PersonalizationRolloutDecision {
  assertRolloutPercent(rolloutPercent);
  const currentVersion = currentRouterVersion
    ? personalizationRouteVersionFromRouterVersion(currentRouterVersion)
    : null;
  if (currentVersion) {
    return Object.freeze({
      policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      routeVersion: currentVersion,
      personalizationEnabled: currentVersion === PERSONALIZATION_ROUTE_VERSION,
      assignment: "existing_route",
      rolloutPercent,
      cohortBucket: null,
    });
  }

  const normalizedSubject = normalizeSubjectKey(subjectKey);
  if (!normalizedSubject) {
    return Object.freeze({
      policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
      routeVersion: PERSONALIZATION_BASELINE_ROUTE_VERSION,
      personalizationEnabled: false,
      assignment: "missing_subject_baseline",
      rolloutPercent,
      cohortBucket: null,
    });
  }
  const cohortBucket = stableCohortBucket(normalizedSubject);
  const personalizationEnabled = cohortBucket < rolloutPercent;
  return Object.freeze({
    policyVersion: PERSONALIZATION_ROLLOUT_POLICY_VERSION,
    routeVersion: personalizationEnabled
      ? PERSONALIZATION_ROUTE_VERSION
      : PERSONALIZATION_BASELINE_ROUTE_VERSION,
    personalizationEnabled,
    assignment: "cohort",
    rolloutPercent,
    cohortBucket,
  });
}

export function personalizationRouteVersionFromRouterVersion(
  routerVersion: string,
): PersonalizationRouteVersion | null {
  const parsed = StudyRouteProvenanceSchema.shape.routerVersion.parse(routerVersion);
  const versions = parsed.split("+").filter((component): component is PersonalizationRouteVersion => (
    PERSONALIZATION_ROUTE_VERSIONS.includes(component as PersonalizationRouteVersion)
  ));
  if (versions.length > 1) {
    throw new Error("A StudyRoute cannot contain conflicting personalization rollout versions.");
  }
  return versions[0] ?? null;
}

export function appendPersonalizationRolloutVersion(
  routerVersion: string,
  decision: PersonalizationRolloutDecision,
) {
  if (decision.policyVersion !== PERSONALIZATION_ROLLOUT_POLICY_VERSION) {
    throw new Error("The StudyRoute received an unsupported personalization rollout decision.");
  }
  const existing = personalizationRouteVersionFromRouterVersion(routerVersion);
  if (existing && existing !== decision.routeVersion) {
    throw new Error("A versioned StudyRoute cannot change personalization cohorts in place.");
  }
  return StudyRouteProvenanceSchema.shape.routerVersion.parse([
    ...routerVersion.split("+").filter(Boolean),
    decision.policyVersion,
    decision.routeVersion,
  ].filter((component, index, values) => values.indexOf(component) === index).join("+"));
}

export function personalizationInputsForRollout<Personalization, Evidence>({
  decision,
  personalization,
  observedEvidence,
}: {
  decision: PersonalizationRolloutDecision;
  personalization: Personalization;
  observedEvidence: readonly Evidence[];
}) {
  return decision.personalizationEnabled
    ? { personalization, observedEvidence }
    : { personalization: null, observedEvidence: [] as readonly Evidence[] };
}

function assertRolloutPercent(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("The personalization rollout percentage must be an integer from 0 to 100.");
  }
}

function normalizeSubjectKey(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) return null;
  return normalized;
}

function stableCohortBucket(subjectKey: string) {
  let hash = 0x811c9dc5;
  const scoped = `${PERSONALIZATION_ROLLOUT_POLICY_VERSION}:${subjectKey}`;
  for (let index = 0; index < scoped.length; index += 1) {
    hash ^= scoped.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

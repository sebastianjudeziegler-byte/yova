import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION } from "@/lib/study-route/normal-plan-envelope-integration";

type RouteProvenanceCarrier = Readonly<{
  provenance: Readonly<{
    routerVersion: string;
  }>;
}>;

export type NormalPlanGenerationCopy = Readonly<{
  learningGoalTitle: string;
  learningGoalTopic: string;
  planRationale: string;
  sessionTitle: string;
}>;

export const NORMAL_PLAN_GENERATION_RATIONALE =
  "YOVA fixed this session's learning targets, sequence, timing, mode, and method from the accepted plan before generating its guided activities.";

const LEARNING_GOAL_TITLE_MAX_LENGTH = 160;
const LEARNING_GOAL_TOPIC_MAX_LENGTH = 500;
const SESSION_TITLE_MAX_LENGTH = 160;
const JOURNEY_OBJECTIVE_MAX_LENGTH = 800;

/**
 * The marker is one exact component of a composite router version. Substring
 * matches are deliberately rejected so an unrelated or future router cannot
 * accidentally inherit this authority boundary.
 */
export function isNormalPlanEnvelopeGenerationRoute(
  route: RouteProvenanceCarrier | null | undefined,
) {
  return route?.provenance.routerVersion.split("+").includes(
    NORMAL_PLAN_ENVELOPE_ROUTE_INTEGRATION_VERSION,
  ) ?? false;
}

/**
 * Returns prompt-facing copy only for a route produced by the deterministic
 * normal-plan envelope pipeline. Provider display prose is intentionally not
 * accepted as input to this boundary.
 */
export function resolveNormalPlanGenerationCopy({
  route,
  selectedTopics,
  contentTargets,
}: {
  route: RouteProvenanceCarrier | null | undefined;
  selectedTopics: readonly Pick<KnowledgeMapTopic, "title" | "description">[];
  contentTargets: readonly string[];
}): NormalPlanGenerationCopy | null {
  if (!isNormalPlanEnvelopeGenerationRoute(route)) return null;

  const targetLabels = uniqueBoundedValues(contentTargets, 6, 180);
  const topicTitles = uniqueBoundedValues(selectedTopics.map((topic) => topic.title), 6, 140);
  const topicDescriptions = uniqueBoundedValues(
    selectedTopics.map((topic) => topic.description),
    6,
    400,
  );
  const focus = boundedCopy(
    (targetLabels.length > 0 ? targetLabels : topicTitles).join("; "),
    LEARNING_GOAL_TITLE_MAX_LENGTH,
    "Assigned learning targets",
  );
  const acceptedScope = boundedCopy(
    [focus, ...topicDescriptions].join(". "),
    LEARNING_GOAL_TOPIC_MAX_LENGTH,
    "The accepted learning targets for this session.",
  );

  return Object.freeze({
    learningGoalTitle: focus,
    learningGoalTopic: acceptedScope,
    planRationale: NORMAL_PLAN_GENERATION_RATIONALE,
    sessionTitle: boundedCopy(
      `Focus: ${focus}`,
      SESSION_TITLE_MAX_LENGTH,
      "Focus: assigned learning targets",
    ),
  });
}

/**
 * Normal-plan journey copy is reconstructed from code-owned content targets,
 * never from provider-authored plan/session display fields.
 */
export function buildNormalPlanJourneyGenerationCopy({
  sequence,
  contentTargets,
}: {
  sequence: number;
  contentTargets: readonly string[];
}) {
  const targets = uniqueBoundedValues(contentTargets, 6, 180);
  const focus = boundedCopy(
    targets.join("; "),
    140,
    "assigned learning targets",
  );
  const hasTargets = targets.length > 0;

  return Object.freeze({
    title: boundedCopy(
      `Session ${sequence}: ${focus}`,
      SESSION_TITLE_MAX_LENGTH,
      `Session ${sequence}: assigned learning targets`,
    ),
    objective: boundedCopy(
      hasTargets
        ? `Work through ${focus} and produce the required evidence for this session.`
        : "Complete the assigned learning targets and the required evidence check for this session.",
      JOURNEY_OBJECTIVE_MAX_LENGTH,
      "Complete the assigned learning targets and required evidence.",
    ),
  });
}

function uniqueBoundedValues(
  values: readonly string[],
  maximumValues: number,
  maximumLength: number,
) {
  const unique: string[] = [];
  for (const value of values) {
    const bounded = boundedCopy(value, maximumLength, "");
    if (!bounded || unique.includes(bounded)) continue;
    unique.push(bounded);
    if (unique.length === maximumValues) break;
  }
  return unique;
}

function boundedCopy(value: string, maximumLength: number, fallback: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const safe = normalized || fallback;
  if (safe.length <= maximumLength) return safe;
  return safe.slice(0, maximumLength).trimEnd();
}

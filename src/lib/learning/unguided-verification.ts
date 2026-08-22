import {
  type LearningPlanSession,
} from "@/lib/domain";
import { contentBudgetForMinutes } from "@/lib/plan-generation/content-budget";
import { MAX_RUNTIME_PLAN_SESSIONS } from "@/lib/plan-generation/schema";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";

const VERIFICATION_MINUTES = 10;
const VERIFICATION_CONTENT_BUDGET = contentBudgetForMinutes(VERIFICATION_MINUTES);
const VERIFICATION_TOPIC_COUNT = 1;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

/**
 * Ungraded method work may advance plan progress, but it cannot establish
 * knowledge. Insert a real, guided check immediately after that work so the
 * original targets stay pending verification without being relabelled as
 * evidence.
 */
export function buildUnguidedVerificationSession({
  completedSession,
  completedAt,
  verificationId,
  planSessionCount,
}: {
  completedSession: LearningPlanSession;
  completedAt: string;
  /** Reuse the completion attempt UUID so a replay cannot create a new row. */
  verificationId: string;
  planSessionCount: number;
}): LearningPlanSession | null {
  if (!canScheduleUnguidedVerification(completedSession, planSessionCount)) return null;
  const target = verificationTarget(completedSession);
  const scheduledFor = new Date(new Date(completedAt).getTime() + DAY_IN_MILLISECONDS).toISOString();
  const explanation = `The method work counted as practice, not proof. YOVA scheduled a guided check of ${target} so these exact targets are verified before the plan moves on.`;

  return {
    id: verificationId,
    sequence: completedSession.sequence + 1,
    title: `Verify ${target}`.slice(0, 180),
    objective: verificationObjective(completedSession, target),
    method: "Independent retrieval verification",
    methodReason: explanation.slice(0, 900),
    scheduledFor,
    estimatedMinutes: VERIFICATION_MINUTES,
    amountLabel: "Required guided verification · about 10 min",
    learningMode: "study",
    topicIds: [...(completedSession.topicIds ?? [])],
    contentTargets: [...(completedSession.contentTargets ?? [])],
    completionEvidence: [...(completedSession.completionEvidence ?? [])],
    status: "ready",
    adaptationNote: createSessionAdaptationNote(explanation, completedAt),
    reviewConcept: target,
    reviewType: "verify",
  };
}

export function canScheduleUnguidedVerification(
  session: Pick<
    LearningPlanSession,
    "reviewType" | "topicIds" | "contentTargets" | "completionEvidence"
  >,
  planSessionCount: number,
) {
  return !session.reviewType
    && isUnguidedVerificationWithinCapacity(session)
    && Number.isInteger(planSessionCount)
    && planSessionCount >= 1
    && planSessionCount < MAX_RUNTIME_PLAN_SESSIONS;
}

/**
 * The required verification is a fixed ten-minute scheduled review. Keep its
 * upstream eligibility in lockstep with the generator's content budget so an
 * unguided completion can never create a follow-up that is too large to run.
 */
export function isUnguidedVerificationWithinCapacity(
  session: Pick<LearningPlanSession, "topicIds" | "contentTargets" | "completionEvidence">,
) {
  const validTopicIds = validItems(
    session.topicIds,
    VERIFICATION_TOPIC_COUNT,
    VERIFICATION_TOPIC_COUNT,
    36,
    UUID_PATTERN,
  );
  const validContentTargets = validItems(
    session.contentTargets,
    1,
    VERIFICATION_CONTENT_BUDGET.maximumContentTargets,
    180,
    null,
    5,
  );
  const validCompletionEvidence = validItems(
    session.completionEvidence,
    1,
    VERIFICATION_CONTENT_BUDGET.maximumCompletionChecks,
    220,
    null,
    8,
  );

  return validTopicIds
    && validContentTargets
    && validCompletionEvidence
    && new Set(session.topicIds!.map((topicId) => topicId.trim())).size === session.topicIds!.length
    && session.topicIds!.length <= session.contentTargets!.length;
}

export function canLoadBuiltInFallbackWithCompletion({
  fallbackKind,
  session,
  planSessionCount,
}: {
  fallbackKind: "subject_specific" | "generic_inside" | "outside_source" | null;
  session: Pick<
    LearningPlanSession,
    "reviewType" | "topicIds" | "contentTargets" | "completionEvidence"
  >;
  planSessionCount: number;
}) {
  return fallbackKind !== "generic_inside" && fallbackKind !== "outside_source"
    ? true
    : canScheduleUnguidedVerification(session, planSessionCount);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validItems(
  items: string[] | undefined,
  minimum: number,
  maximum: number,
  maximumLength: number,
  pattern: RegExp | null,
  minimumLength = 1,
) {
  return Boolean(
    items
    && items.length >= minimum
    && items.length <= maximum
    && items.every((item) => {
      const value = item.trim();
      return value.length >= minimumLength
        && value.length <= maximumLength
        && (!pattern || (item === value && pattern.test(value)));
    }),
  );
}

function verificationTarget(session: LearningPlanSession) {
  const targets = session.contentTargets?.map((target) => target.trim()).filter(Boolean) ?? [];
  const candidate = targets.length === 1
    ? targets[0]!
    : targets.length > 1
      ? `${targets[0]} and related session targets`
      : session.title.trim() || session.objective.trim() || "the session target";
  return candidate.slice(0, 120);
}

function verificationObjective(session: LearningPlanSession, target: string) {
  const targets = session.contentTargets?.map((item) => item.trim()).filter(Boolean) ?? [];
  const scope = targets.length > 0 ? targets.join("; ") : target;
  return `Complete an independent guided retrieval or application check for every original target: ${scope}. Record topic evidence only from those checked answers.`.slice(0, 900);
}

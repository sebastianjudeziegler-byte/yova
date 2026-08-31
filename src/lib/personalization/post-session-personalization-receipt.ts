import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import type { PostSessionDecision } from "@/lib/personalization/post-session-decision";
import type { StudyRouteAgencyMode } from "@/lib/study-route/agency-mode-controller";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export type PersonalizationReceiptEntry = Readonly<{
  text: string;
  evidenceRef: string;
}>;

export type PostSessionPersonalizationReceipt = Readonly<{
  routeRevisionId: string | null;
  routeBasis: "matched" | "legacy" | "mismatch";
  youSaid: readonly PersonalizationReceiptEntry[];
  yovaSaw: readonly PersonalizationReceiptEntry[];
  nextChange: readonly PersonalizationReceiptEntry[];
  notSureYet: readonly PersonalizationReceiptEntry[];
}>;

/**
 * Builds the completion receipt exclusively from persisted route fields,
 * recorded completion evidence, and the deterministic post-session rule.
 * Keeping the evidence reference beside every line prevents this surface from
 * drifting into plausible-sounding personalization copy.
 */
export function buildPostSessionPersonalizationReceipt({
  session,
  completion,
  decision,
  adaptationAgencyMode = null,
}: {
  session: LearningPlanSession | null;
  completion: SessionCompletion;
  decision: PostSessionDecision | null;
  adaptationAgencyMode?: StudyRouteAgencyMode | null;
}): PostSessionPersonalizationReceipt {
  const parsedRoute = StudyRouteSchema.safeParse(session?.studyRoute);
  const route = parsedRoute.success ? parsedRoute.data : null;
  const executedRouteRevisionId = completion.routeRevisionId
    ?? session?.resource?.routeRevisionId
    ?? (route?.identity.lifecycleStatus === "committed"
      ? route.identity.routeRevisionId
      : null);
  const matchedRoute = (
    route
    && executedRouteRevisionId
    && route.identity.routeRevisionId === executedRouteRevisionId
  ) ? route : null;
  const routeBasis = matchedRoute
    ? "matched"
    : executedRouteRevisionId && route
      ? "mismatch"
      : "legacy";

  const youSaid: PersonalizationReceiptEntry[] = [];
  if (matchedRoute) {
    matchedRoute.explanation.learnerDeclarations.forEach((declaration, index) => {
      youSaid.push(entry(
        declaration,
        `route:${matchedRoute.identity.routeRevisionId}:learner_declaration:${index}`,
      ));
    });
  }
  youSaid.push(entry(
    `Challenge felt: ${challengeLabel(completion.feedback)}.`,
    `completion:${completion.id}:feedback`,
  ));

  const yovaSaw = observedEvidenceEntries(completion);
  const nextChange = decisionEntries(decision, completion, adaptationAgencyMode);
  const notSureYet: PersonalizationReceiptEntry[] = [];

  if (routeBasis === "mismatch") {
    notSureYet.push(entry(
      "The executed route revision does not match the current saved recipe.",
      `completion:${completion.id}:route_revision_mismatch`,
    ));
  } else if (matchedRoute) {
    matchedRoute.explanation.uncertainties.slice(0, 2).forEach((uncertainty, index) => {
      notSureYet.push(entry(
        uncertainty,
        `route:${matchedRoute.identity.routeRevisionId}:uncertainty:${index}`,
      ));
    });
  }

  if (completion.completionMode === "unguided_practice") {
    notSureYet.push(entry(
      "Knowledge after this ungraded practice remains unverified.",
      `completion:${completion.id}:unguided_boundary`,
    ));
  } else {
    notSureYet.push(entry(
      "Whether today’s result holds after a delay is not known yet.",
      `completion:${completion.id}:delayed_retention_unobserved`,
    ));
  }
  notSureYet.push(entry(
    "This completion alone cannot show that this method works better than another.",
    `completion:${completion.id}:single_session_method_limit`,
  ));

  return deepFreeze({
    routeRevisionId: executedRouteRevisionId,
    routeBasis,
    youSaid: uniqueEntries(youSaid).slice(0, 4),
    yovaSaw: uniqueEntries(yovaSaw).slice(0, 4),
    nextChange: uniqueEntries(nextChange).slice(0, 4),
    notSureYet: uniqueEntries(notSureYet).slice(0, 4),
  });
}

function observedEvidenceEntries(completion: SessionCompletion) {
  if (completion.completionMode === "unguided_practice") {
    return [entry(
      "This session was self-reviewed, so YOVA recorded no checked knowledge evidence.",
      `completion:${completion.id}:unguided_boundary`,
    )];
  }

  const entries: PersonalizationReceiptEntry[] = [];
  if (completion.totalAnswers > 0) {
    entries.push(entry(
      `Recorded checks: ${completion.correctAnswers} of ${completion.totalAnswers} correct.`,
      `completion:${completion.id}:check_counts`,
    ));
  }

  const secureConcepts = uniqueConcepts(completion, "secure");
  if (secureConcepts.length > 0) {
    entries.push(entry(
      `Showing strength in this session: ${secureConcepts.join(", ")}.`,
      `completion:${completion.id}:concept_evidence:secure`,
    ));
  }

  const reviewConcepts = uniqueConcepts(completion, "needs_review");
  if (reviewConcepts.length > 0) {
    entries.push(entry(
      `Needs another check: ${reviewConcepts.join(", ")}.`,
      `completion:${completion.id}:concept_evidence:needs_review`,
    ));
  }

  if (entries.length === 0) {
    entries.push(entry(
      "No scorable knowledge check was recorded, so YOVA added no knowledge evidence.",
      `completion:${completion.id}:no_scorable_evidence`,
    ));
  }
  return entries;
}

function decisionEntries(
  decision: PostSessionDecision | null,
  completion: SessionCompletion,
  adaptationAgencyMode: StudyRouteAgencyMode | null,
) {
  if (completion.completionMode === "unguided_practice") {
    return [entry(
      "No knowledge-based personalization change is made from ungraded practice.",
      `completion:${completion.id}:unguided_change_boundary`,
    )];
  }
  if (!decision) {
    return [entry(
      "No post-session personalization change is proposed here.",
      `completion:${completion.id}:no_post_session_decision`,
    )];
  }

  if (decision.kind === "keep_current_plan") {
    return [entry(
      `Rule result: ${decision.title}.`,
      `completion:${completion.id}:decision:${decision.kind}`,
    )];
  }

  if (decision.kind === "adapt_next_session") {
    if (adaptationAgencyMode === "yova_decides") {
      return [
        entry(
          `Applies when you finish: ${decision.title}.`,
          `completion:${completion.id}:decision:${decision.kind}:agency:yova_decides`,
        ),
        ...decision.changes.map((change, index) => entry(
          change,
          `completion:${completion.id}:decision:${decision.kind}:change:${index}`,
        )),
      ];
    }
    if (adaptationAgencyMode === "help_me_choose") {
      return [
        entry(
          `Proposed, awaiting your confirmation: ${decision.title}.`,
          `completion:${completion.id}:decision:${decision.kind}:agency:help_me_choose`,
        ),
        ...decision.changes.map((change, index) => entry(
          change,
          `completion:${completion.id}:decision:${decision.kind}:change:${index}`,
        )),
      ];
    }
    if (adaptationAgencyMode === "ill_customize") {
      return [
        entry(
          `Recommendation only: ${decision.title}. Your selected route stays in place unless you choose this change.`,
          `completion:${completion.id}:decision:${decision.kind}:agency:ill_customize`,
        ),
        ...decision.changes.map((change, index) => entry(
          change,
          `completion:${completion.id}:decision:${decision.kind}:change:${index}`,
        )),
      ];
    }
  }

  return [
    entry(
      `Proposed, awaiting approval: ${decision.title}.`,
      `completion:${completion.id}:decision:${decision.kind}`,
    ),
    ...decision.changes.map((change, index) => entry(
      change,
      `completion:${completion.id}:decision:${decision.kind}:change:${index}`,
    )),
  ];
}

function uniqueConcepts(
  completion: SessionCompletion,
  outcome: SessionCompletion["conceptEvidence"][number]["outcome"],
) {
  return [...new Set(completion.conceptEvidence
    .filter((evidence) => evidence.outcome === outcome)
    .map((evidence) => evidence.concept.trim())
    .filter(Boolean))]
    .slice(0, 3);
}

function challengeLabel(feedback: SessionCompletion["feedback"]) {
  if (feedback === "too_easy") return "Too easy";
  if (feedback === "too_difficult") return "Too difficult";
  return "About right";
}

function entry(text: string, evidenceRef: string): PersonalizationReceiptEntry {
  return { text: text.trim(), evidenceRef };
}

function uniqueEntries(entries: readonly PersonalizationReceiptEntry[]) {
  return entries.filter((candidate, index) => (
    entries.findIndex((entry) => entry.text === candidate.text) === index
  ));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

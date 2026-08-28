import { z } from "zod";
import { deriveLearningTitle } from "@/lib/intake/interpret";
import { LEARNING_TITLE_CHARACTER_LIMIT } from "@/lib/learning/title-limits";
import {
  CORE_METHOD_IDS,
  recognizedCoreMethodNames,
} from "@/lib/learning/method-catalog";
import {
  describesLearnerAsAType,
  isActiveCompletionEvidence,
} from "@/lib/plan-generation/quality-gate";
import {
  NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION,
  type NormalPlanEnvelopeComposition,
  type NormalPlanSessionEnvelope,
} from "@/lib/plan-generation/normal-plan-envelopes";
import {
  GeneratedPlanDraftSchema,
  MAX_GENERATED_PLAN_SESSIONS,
  PlanGenerationRequestSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";

export const NORMAL_PLAN_PROVIDER_FILL_VERSION =
  "normal_plan_provider_fill_v1" as const;

export const NORMAL_PLAN_PROVIDER_FILL_ERROR_CODES = [
  "invalid_request",
  "not_normal_plan",
  "missing_knowledge_map",
  "invalid_composition",
  "invalid_fill",
] as const;

export type NormalPlanProviderFillErrorCode =
  (typeof NORMAL_PLAN_PROVIDER_FILL_ERROR_CODES)[number];

export class NormalPlanProviderFillError extends Error {
  constructor(
    readonly code: NormalPlanProviderFillErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NormalPlanProviderFillError";
  }
}

export type NormalPlanProviderSessionFill = {
  title: string;
  /** Compatibility-only fill slot; code owns the operational objective. */
  objective: string;
  /** Compatibility-only fill slots; code owns each target-bound check. */
  evidence: Record<string, string>;
};

export type NormalPlanProviderFill = {
  plan: {
    title: string;
    topic: string;
    rationale: string;
  };
  /**
   * Keys are exact code-owned envelope ids. A provider fills the required
   * property values; it never returns an id, position, count, or target list.
   */
  sessions: Record<string, NormalPlanProviderSessionFill>;
};

export type NormalPlanProviderFillContract = Readonly<{
  request: PlanGenerationRequest;
  composition: NormalPlanEnvelopeComposition;
}>;

export const NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD = Object.freeze({
  method: "Pending code-owned method",
  methodReason: "YOVA has not committed a study method for this fixed session slot yet.",
});

const RAW_INTERFACE_FORMATTING_PATTERN =
  /[\u2013\u2014]|\*\*|__|(^|\s)#{1,6}\s/m;
const PROVIDER_EVIDENCE_MAX_LENGTH = 220;
const EVIDENCE_SLOT_PREFIX = "evidence-";
const ENVELOPE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const STRUCTURAL_AUTHORITY_PATTERN = new RegExp([
  "\\b(?:feynman|blurting|pomodoro|leitner|cornell notes?|sq3r|body doubling|flashcards?)\\b",
  "\\b\\d{1,3}\\s*(?:minutes?|mins?|hours?|hrs?)\\b",
  "\\b\\d{1,2}:\\d{2}\\b",
  "\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b",
  "\\b(?:ignore|override|switch to|replace (?:the|this)|regardless of|instead of|do .* instead)\\b",
  "\\b(?:learn|practice|study) mode\\b",
].join("|"), "iu");
const GENERIC_ANCHOR_WORDS = new Set([
  "about", "accepted", "accurate", "apply", "assigned", "before", "build",
  "check", "complete", "current", "evidence", "explain", "fixed", "focused",
  "independent", "learn", "learning", "material", "next", "plan", "practice",
  "produce", "review", "session", "solve", "study", "target", "targets", "this",
  "through", "using", "with", "without", "write", "your", "yova",
]);
const METHOD_AUTHORITY_PHRASES = CORE_METHOD_IDS.flatMap((methodId) => (
  recognizedCoreMethodNames(methodId).map(normalizedSearchText)
));

const PlanCopySchema = z.object({
  title: z.string().trim().min(3).max(LEARNING_TITLE_CHARACTER_LIMIT).describe(
    "Learner-facing plan title only. Do not return plan kind, timing, targets, methods, or metadata.",
  ),
  topic: z.string().trim().min(3).max(180).describe(
    "Learner-facing summary of the accepted mapped topic scope.",
  ),
  rationale: z.string().trim().min(20).max(900).describe(
    "Plain-language explanation of the fixed sequence. Do not claim a learning style, brain type, diagnosis, or fixed learner identity.",
  ),
}).strict();

const SessionTitleSchema = z.string().trim().min(3).max(
  LEARNING_TITLE_CHARACTER_LIMIT,
).describe(
  "Learner-facing title for this already-fixed session slot.",
);

const SessionObjectiveSchema = z.string().trim().min(10).max(280).describe(
  "Compatibility prose slot. YOVA replaces this with its deterministic target-bound objective before materialization.",
);

const EvidenceCopySchema = z.string().trim().min(8).max(
  PROVIDER_EVIDENCE_MAX_LENGTH,
).describe(
  "Compatibility prose slot. YOVA replaces it with one deterministic observable action for the corresponding target.",
);

/**
 * Builds the exact structured-output boundary for one accepted composition.
 * Every envelope and evidence slot is a required object property. There is no
 * provider-authored session array and no structural field in the schema.
 */
export function buildNormalPlanProviderFillSchema(
  contract: NormalPlanProviderFillContract,
) {
  return buildSchemaFromValidatedBoundary(validateContract(contract));
}

/** Exact evidence property names the provider must fill for one envelope. */
export function normalPlanEvidenceSlotIds(
  envelope: Pick<NormalPlanSessionEnvelope, "topicIds" | "contentBudget">,
) {
  const count = Math.max(1, envelope.topicIds.length);
  return Object.freeze(Array.from(
    { length: count },
    (_, index) => `${EVIDENCE_SLOT_PREFIX}${String(index + 1).padStart(3, "0")}`,
  ));
}

/**
 * Creates safe copy for the same fixed slots used by live generation. This is
 * a prose fallback, not a second planner: it cannot regroup, reschedule, or
 * relabel any target state.
 */
export function buildNormalPlanFallbackFill(
  contract: NormalPlanProviderFillContract,
): NormalPlanProviderFill {
  return buildFallbackFromValidatedBoundary(validateContract(contract));
}

/**
 * Binds safe provider prose to the existing generated-draft compatibility
 * shape. Every non-prose field is reconstructed from request, map, or envelope
 * authority; provider objects containing any extra structural field reject at
 * the strict schema boundary.
 */
export function bindNormalPlanProviderFill({
  request,
  composition,
  fill,
}: NormalPlanProviderFillContract & { readonly fill: unknown }): GeneratedPlanDraft {
  const boundary = validateContract({ request, composition });
  const schema = buildSchemaFromValidatedBoundary(boundary);
  const parsed = schema.safeParse(fill);
  if (!parsed.success) {
    throw new NormalPlanProviderFillError(
      "invalid_fill",
      `The provider fill did not match the fixed prose slots: ${formatZodIssues(parsed.error)}.`,
    );
  }

  const providerFill = parsed.data as NormalPlanProviderFill;
  const fallback = buildFallbackFromValidatedBoundary(boundary);
  const safeFill = sanitizeProviderFill(providerFill, fallback, boundary);
  const topicsById = boundary.topicsById;
  const draft = GeneratedPlanDraftSchema.parse({
    title: safeFill.plan.title,
    topic: safeFill.plan.topic,
    kind: resolveNormalPlanKindFromParsedRequest(boundary.request),
    deadline: boundary.request.deadline,
    rationale: safeFill.plan.rationale,
    deferredTopics: boundary.composition.deferrals.map((deferral) => ({
      topicId: deferral.topicId,
      reason: safeFallbackText(
        deferral.reason,
        "This accepted target is deferred because it does not fit within the current plan boundary.",
        8,
        300,
      ),
    })),
    sessions: boundary.composition.envelopes.map((envelope) => {
      const displayCopy = safeFill.sessions[envelope.envelopeId]!;
      const operationalCopy = fallback.sessions[envelope.envelopeId]!;
      const completionEvidence = normalPlanEvidenceSlotIds(envelope).map((slotId) => (
        operationalCopy.evidence[slotId]!
      ));
      return {
        title: displayCopy.title,
        objective: operationalCopy.objective,
        ...NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD,
        scheduledFor: envelope.scheduledFor,
        estimatedMinutes: envelope.timing.activeMinutes,
        amountLabel: amountLabel(envelope.topicIds.length, completionEvidence.length, envelope.timing.activeMinutes),
        learningMode: envelope.learningMode,
        topicIds: [...envelope.topicIds],
        contentTargets: envelope.topicIds.map((topicId, targetIndex) => (
          mapAuthoritativeContentTarget(topicsById.get(topicId)!, targetIndex + 1)
        )),
        completionEvidence,
      };
    }),
  });

  return deepFreeze(draft);
}

/** True only for the private placeholder between prose binding and routing. */
export function hasNormalPlanInternalMethodScaffold(
  draft: Pick<GeneratedPlanDraft, "sessions">,
) {
  return draft.sessions.some((session) => (
    session.method === NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.method
    && session.methodReason === NORMAL_PLAN_INTERNAL_METHOD_SCAFFOLD.methodReason
  ));
}

/**
 * Final generation boundaries call this after deterministic method routing.
 * The placeholder is intentionally unclassifiable, but this assertion also
 * prevents learner-facing leakage if a future caller skips materialization.
 */
export function assertNormalPlanMethodScaffoldReplaced(
  draft: Pick<GeneratedPlanDraft, "sessions">,
) {
  if (hasNormalPlanInternalMethodScaffold(draft)) {
    throw invalidComposition(
      "The fixed normal-plan slots must receive code-owned methods before review or activation.",
    );
  }
}

/** Code-owned plan-kind policy; provider output has no corresponding field. */
export function resolveNormalPlanKind(
  request: PlanGenerationRequest,
): GeneratedPlanDraft["kind"] {
  const parsed = parseNormalPlanRequest(request);
  return resolveNormalPlanKindFromParsedRequest(parsed);
}

type ValidatedBoundary = Readonly<{
  request: PlanGenerationRequest & {
    knowledgeMap: NonNullable<PlanGenerationRequest["knowledgeMap"]>;
  };
  composition: NormalPlanEnvelopeComposition;
  topicsById: ReadonlyMap<string, NonNullable<PlanGenerationRequest["knowledgeMap"]>["topics"][number]>;
}>;

function validateContract(
  contract: NormalPlanProviderFillContract,
): ValidatedBoundary {
  const request = parseNormalPlanRequest(contract.request);
  const composition = contract.composition;
  if (
    !composition
    || composition.version !== NORMAL_PLAN_ENVELOPE_COMPOSER_VERSION
    || !Array.isArray(composition.envelopes)
    || composition.envelopes.length < 1
    || composition.envelopes.length > MAX_GENERATED_PLAN_SESSIONS
    || !Array.isArray(composition.deferrals)
  ) {
    throw invalidComposition("The provider-fill boundary requires one supported, non-empty envelope composition.");
  }

  const topicsById = new Map(request.knowledgeMap.topics.map((topic) => [topic.id, topic]));
  const envelopeIds = new Set<string>();
  const scheduledTopicIds = new Set<string>();

  composition.envelopes.forEach((envelope, index) => {
    if (
      typeof envelope.envelopeId !== "string"
      || !ENVELOPE_ID_PATTERN.test(envelope.envelopeId)
      || envelopeIds.has(envelope.envelopeId)
    ) {
      throw invalidComposition("Every provider-fill envelope must have one unique, bounded code-owned id.");
    }
    envelopeIds.add(envelope.envelopeId);
    if (envelope.sequence !== index + 1) {
      throw invalidComposition("Provider-fill envelopes must use one contiguous code-owned sequence.");
    }
    if (
      !Array.isArray(envelope.topicIds)
      || envelope.topicIds.length < 1
      || envelope.topicIds.length > 6
      || new Set(envelope.topicIds).size !== envelope.topicIds.length
      || envelope.topicIds.some((topicId: string) => !topicsById.has(topicId))
    ) {
      throw invalidComposition("Every envelope must contain unique targets from the accepted knowledge map.");
    }
    envelope.topicIds.forEach((topicId: string) => scheduledTopicIds.add(topicId));
    if (
      envelope.contentBudget.minutes !== envelope.timing.activeMinutes
      || envelope.topicIds.length > envelope.contentBudget.maximumContentTargets
      || envelope.topicIds.length > envelope.contentBudget.maximumCompletionChecks
      || envelope.contentBudget.maximumCompletionChecks < 1
      || envelope.contentBudget.maximumCompletionChecks > 4
      || envelope.timing.hardMaximumMinutes !== envelope.hardMaximumMinutes
      || envelope.timing.activeMinutes > envelope.hardMaximumMinutes
      || !Number.isFinite(Date.parse(envelope.scheduledFor))
      || !Number.isFinite(Date.parse(envelope.availabilityStartsAt))
      || Date.parse(envelope.scheduledFor) < Date.parse(envelope.availabilityStartsAt)
      || (
        request.deadline !== null
        && Date.parse(envelope.scheduledFor) + envelope.timing.activeMinutes * 60_000
          > Date.parse(request.deadline)
      )
    ) {
      throw invalidComposition("An envelope's timing, target budget, or schedule is internally inconsistent.");
    }
  });

  const deferredTopicIds = new Set<string>();
  for (const deferral of composition.deferrals) {
    if (
      !topicsById.has(deferral.topicId)
      || deferredTopicIds.has(deferral.topicId)
      || scheduledTopicIds.has(deferral.topicId)
      || typeof deferral.reason !== "string"
      || deferral.reason.trim().length < 8
      || deferral.reason.trim().length > 300
    ) {
      throw invalidComposition("Every deferral must identify one unscheduled map target with one bounded reason.");
    }
    deferredTopicIds.add(deferral.topicId);
  }
  if (request.knowledgeMap.topics.some((topic) => (
    !scheduledTopicIds.has(topic.id) && !deferredTopicIds.has(topic.id)
  ))) {
    throw invalidComposition("Every accepted map target must be scheduled or explicitly deferred.");
  }

  return { request, composition, topicsById };
}

function parseNormalPlanRequest(
  request: PlanGenerationRequest,
): ValidatedBoundary["request"] {
  const parsed = PlanGenerationRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new NormalPlanProviderFillError(
      "invalid_request",
      "The normal-plan provider-fill boundary requires a valid plan-generation request.",
    );
  }
  if (parsed.data.intent !== "plan") {
    throw new NormalPlanProviderFillError(
      "not_normal_plan",
      "Study Now cannot use the multi-session provider-fill boundary.",
    );
  }
  if (!parsed.data.knowledgeMap) {
    throw new NormalPlanProviderFillError(
      "missing_knowledge_map",
      "The provider-fill boundary requires the accepted knowledge map.",
    );
  }
  return parsed.data as ValidatedBoundary["request"];
}

function buildSchemaFromValidatedBoundary(boundary: ValidatedBoundary) {
  const sessions: Record<string, z.ZodType<NormalPlanProviderSessionFill>> = {};
  for (const envelope of boundary.composition.envelopes) {
    const evidence: Record<string, z.ZodString> = {};
    for (const slotId of normalPlanEvidenceSlotIds(envelope)) evidence[slotId] = EvidenceCopySchema;
    sessions[envelope.envelopeId] = z.object({
      title: SessionTitleSchema,
      objective: SessionObjectiveSchema,
      evidence: z.object(evidence).strict(),
    }).strict();
  }
  return z.object({ plan: PlanCopySchema, sessions: z.object(sessions).strict() }).strict();
}

function buildFallbackFromValidatedBoundary(
  boundary: ValidatedBoundary,
): NormalPlanProviderFill {
  const scheduledTopicIds = unique(
    boundary.composition.envelopes.flatMap((envelope) => [...envelope.topicIds]),
  );
  const scheduledTitles = scheduledTopicIds.map((topicId) => boundary.topicsById.get(topicId)!.title);
  const sessions: Record<string, NormalPlanProviderSessionFill> = {};

  for (const envelope of boundary.composition.envelopes) {
    const topicTitles = envelope.topicIds.map((topicId) => boundary.topicsById.get(topicId)!.title);
    const focus = safeFallbackText(topicTitles.slice(0, 3).join(", "), "the assigned learning targets", 3, 140);
    const evidence: Record<string, string> = {};
    normalPlanEvidenceSlotIds(envelope).forEach((slotId, index) => {
      const topicTitle = topicTitles[index % topicTitles.length] ?? focus;
      evidence[slotId] = fallbackEvidence(
        envelope,
        safeFallbackText(
          topicTitle,
          `Accepted learning target ${index + 1}`,
          3,
          120,
        ),
        index + 1,
      );
    });
    sessions[envelope.envelopeId] = {
      title: fallbackSessionTitle(envelope, focus),
      objective: fallbackSessionObjective(envelope, focus),
      evidence,
    };
  }

  const fill = buildSchemaFromValidatedBoundary(boundary).parse({
    plan: {
      title: safeFallbackText(
        deriveLearningTitle(boundary.request.goal),
        "Focused learning plan",
        3,
        LEARNING_TITLE_CHARACTER_LIMIT,
      ),
      topic: safeFallbackText(
        scheduledTitles.slice(0, 3).join(", "),
        "The accepted learning targets",
        3,
        180,
      ),
      rationale: boundary.composition.status === "partial"
        ? "YOVA fixed this sequence from the accepted topic map, current evidence, available time, and session limits. Topics that do not fit are shown explicitly as deferred instead of being silently dropped."
        : "YOVA fixed this sequence from the accepted topic map, current evidence, available time, and session limits. Each session has one bounded purpose and observable completion evidence.",
    },
    sessions,
  }) as NormalPlanProviderFill;
  assertSafeFallback(fill);
  return deepFreeze(fill);
}

function sanitizeProviderFill(
  provider: NormalPlanProviderFill,
  fallback: NormalPlanProviderFill,
  boundary: ValidatedBoundary,
): NormalPlanProviderFill {
  const sessions: Record<string, NormalPlanProviderSessionFill> = {};
  for (const [envelopeId, providerSession] of Object.entries(provider.sessions)) {
    const fallbackSession = fallback.sessions[envelopeId]!;
    const envelope = boundary.composition.envelopes.find((candidate) => (
      candidate.envelopeId === envelopeId
    ))!;
    const sessionAnchors = meaningfulAnchorTokens([
      boundary.request.goal,
      ...envelope.topicIds.flatMap((topicId) => {
        const topic = boundary.topicsById.get(topicId)!;
        return [topic.title, topic.description, ...topic.subtopics];
      }),
    ]);
    sessions[envelopeId] = {
      title: safeProviderText(
        providerSession.title,
        fallbackSession.title,
        3,
        LEARNING_TITLE_CHARACTER_LIMIT,
        false,
        sessionAnchors,
      ),
      objective: fallbackSession.objective,
      evidence: { ...fallbackSession.evidence },
    };
  }
  const planAnchors = meaningfulAnchorTokens([
    boundary.request.goal,
    boundary.request.startingContext ?? "",
    ...boundary.request.knowledgeMap.topics.flatMap((topic) => (
      [topic.title, topic.description, ...topic.subtopics]
    )),
  ]);
  return deepFreeze({
    plan: {
      title: safeProviderText(
        provider.plan.title,
        fallback.plan.title,
        3,
        LEARNING_TITLE_CHARACTER_LIMIT,
        false,
        planAnchors,
      ),
      topic: safeProviderText(provider.plan.topic, fallback.plan.topic, 3, 180, false, planAnchors),
      rationale: safeProviderText(
        provider.plan.rationale,
        fallback.plan.rationale,
        20,
        900,
        false,
        planAnchors,
      ),
    },
    sessions,
  });
}

function safeProviderText(
  value: string,
  fallback: string,
  minimum: number,
  maximum: number,
  requireActiveEvidence = false,
  requiredAnchorTokens?: ReadonlySet<string>,
) {
  const cleaned = cleanInterfaceText(value).slice(0, maximum).trim();
  if (
    cleaned.length < minimum
    || describesLearnerAsAType(cleaned)
    || RAW_INTERFACE_FORMATTING_PATTERN.test(cleaned)
    || (requireActiveEvidence && !isActiveCompletionEvidence(cleaned))
    || containsStructuralAuthorityClaim(cleaned)
    || (
      requiredAnchorTokens !== undefined
      && !containsAnyAnchor(cleaned, requiredAnchorTokens)
    )
  ) return fallback;
  return cleaned;
}

function safeFallbackText(
  candidate: string,
  generic: string,
  minimum: number,
  maximum: number,
) {
  const cleaned = cleanInterfaceText(candidate).slice(0, maximum).trim();
  if (
    cleaned.length >= minimum
    && !describesLearnerAsAType(cleaned)
    && !RAW_INTERFACE_FORMATTING_PATTERN.test(cleaned)
  ) return cleaned;
  return generic.slice(0, maximum);
}

function cleanInterfaceText(value: string) {
  return value
    .replace(/[\u2013\u2014]/gu, " - ")
    .replace(/\*\*|__/gu, "")
    .replace(/(^|\s)#{1,6}\s+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function fallbackSessionTitle(envelope: NormalPlanSessionEnvelope, focus: string) {
  const prefix = envelope.learningMode === "learn"
    ? "Build"
    : envelope.kind === "required_practice"
      ? "Retrieve"
      : envelope.kind === "additional_practice"
        ? "Apply"
        : "Practice";
  return safeFallbackText(
    `${prefix} ${focus}`,
    envelope.learningMode === "learn" ? "Build the next foundation" : "Practice the next target",
    3,
    LEARNING_TITLE_CHARACTER_LIMIT,
  );
}

function fallbackSessionObjective(envelope: NormalPlanSessionEnvelope, focus: string) {
  const candidate = envelope.learningMode === "learn"
    ? `Session ${envelope.sequence} builds an accurate explanation of ${focus}, uses one concrete example, and ends with an independent check.`
    : envelope.kind === "additional_practice"
      ? `Session ${envelope.sequence} transfers ${focus} to a different example, then corrects the exact gap or error the attempt exposes.`
      : `Session ${envelope.sequence} retrieves and applies ${focus} without initial support, then corrects the exact gap or error the attempt exposes.`;
  return safeFallbackText(
    candidate,
    envelope.learningMode === "learn"
      ? `Session ${envelope.sequence} builds an accurate model of the assigned targets, uses one example, and ends with an independent check.`
      : `Session ${envelope.sequence} attempts the assigned targets without initial support, then corrects the exact gap or error the attempt exposes.`,
    10,
    280,
  );
}

function fallbackEvidence(
  envelope: NormalPlanSessionEnvelope,
  target: string,
  evidenceNumber: number,
) {
  const evidenceQualifier = ` in evidence check ${evidenceNumber}`;
  const candidate = envelope.taskFamily === "problem_solving"
    ? `Solve one representative problem for ${target}${evidenceQualifier} without copying the model and explain the key step`
    : envelope.taskFamily === "programming"
      ? `Implement one comparable solution for ${target}${evidenceQualifier} and explain the key decision`
      : envelope.taskFamily === "writing_argumentation"
        ? `Draft one bounded section for ${target}${evidenceQualifier} and match each claim to supporting evidence`
        : envelope.taskFamily === "memorization"
          ? `Recall ${target}${evidenceQualifier} without notes and correct every exposed gap`
          : envelope.taskFamily === "reading_to_quiz"
            ? `Recall the central idea in ${target}${evidenceQualifier} after closing the source and correct the missing detail`
            : envelope.learningMode === "learn"
              ? `Explain ${target}${evidenceQualifier} in your own words after the model is hidden`
              : `Apply ${target}${evidenceQualifier} in one new example without initial support and correct any exposed error`;
  const generic = envelope.taskFamily === "problem_solving"
    ? "Solve one representative problem without copying the model and explain the key step"
    : envelope.taskFamily === "programming"
      ? "Implement one comparable solution and explain the key decision"
      : envelope.taskFamily === "writing_argumentation"
        ? "Draft one bounded section and match each claim to supporting evidence"
        : envelope.taskFamily === "memorization"
          ? "Recall each assigned target without notes and correct every exposed gap"
          : envelope.learningMode === "learn"
            ? "Explain each assigned target in your own words after the model is hidden"
            : "Apply each assigned target in one new example and correct any exposed error";
  const result = safeFallbackText(candidate, generic, 8, PROVIDER_EVIDENCE_MAX_LENGTH);
  return isActiveCompletionEvidence(result) ? result : generic;
}

function assertSafeFallback(fill: NormalPlanProviderFill) {
  const prose = [
    fill.plan.title,
    fill.plan.topic,
    fill.plan.rationale,
    ...Object.values(fill.sessions).flatMap((session) => [
      session.title,
      session.objective,
      ...Object.values(session.evidence),
    ]),
  ];
  if (
    prose.some((value) => describesLearnerAsAType(value) || RAW_INTERFACE_FORMATTING_PATTERN.test(value))
    || Object.values(fill.sessions).some((session) => (
      Object.values(session.evidence).some((value) => !isActiveCompletionEvidence(value))
    ))
  ) {
    throw invalidComposition("The deterministic provider-fill fallback did not satisfy its prose safety boundary.");
  }
}

function mapAuthoritativeContentTarget(
  topic: NonNullable<PlanGenerationRequest["knowledgeMap"]>["topics"][number],
  targetNumber: number,
) {
  const candidate = topic.title.trim().length >= 5
    ? topic.title.trim()
    : `${topic.title.trim()}: ${topic.description.trim()}`;
  return safeFallbackText(
    candidate,
    `Accepted learning target ${targetNumber}`,
    5,
    180,
  );
}

function amountLabel(targetCount: number, evidenceCount: number, minutes: number) {
  return [
    `${targetCount} focused ${targetCount === 1 ? "target" : "targets"}`,
    `${evidenceCount} evidence ${evidenceCount === 1 ? "check" : "checks"}`,
    `about ${minutes} min`,
  ].join(" + ");
}

function resolveNormalPlanKindFromParsedRequest(
  request: ValidatedBoundary["request"],
): GeneratedPlanDraft["kind"] {
  if (request.knowledgeMap.scopeJudgment.band === "broad_course") return "course";
  const goal = request.goal;
  if (/\b(test|exam|quiz|midterm|final|sat|act|ap exam)\b/iu.test(goal)) return "test";
  if (/\b(book|novel|chapter|read)\b/iu.test(goal)) return "book";
  if (/\b(skill|coding|programming|speaking|vocabulary|language|procedure|technique)\b/iu.test(goal)) return "skill";
  if (/\b(course|class|curriculum)\b/iu.test(goal)) return "course";
  return "topic";
}

function invalidComposition(message: string) {
  return new NormalPlanProviderFillError("invalid_composition", message);
}

function formatZodIssues(error: z.ZodError) {
  return error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    return `${path}:${issue.code}`;
  }).join(", ");
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function containsStructuralAuthorityClaim(value: string) {
  const normalized = normalizedSearchText(value);
  return STRUCTURAL_AUTHORITY_PATTERN.test(value)
    || METHOD_AUTHORITY_PHRASES.some((methodName) => normalized.includes(methodName));
}

function meaningfulAnchorTokens(values: readonly string[]) {
  return new Set(values.flatMap((value) => (
    normalizedSearchText(value).split(" ").filter((token) => (
      token.length >= 4 && !GENERIC_ANCHOR_WORDS.has(token)
    ))
  )));
}

function containsAnyAnchor(value: string, anchors: ReadonlySet<string>) {
  if (anchors.size === 0) return false;
  return normalizedSearchText(value).split(" ").some((token) => anchors.has(token));
}

function normalizedSearchText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

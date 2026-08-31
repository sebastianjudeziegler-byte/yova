import { z } from "zod";
import { CORE_METHOD_IDS, LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { CALIBRATION_PATTERNS } from "@/lib/learning/confidence-calibration";
import {
  METHOD_PHASES,
  methodFidelityContractForPrompt,
} from "@/lib/learning/method-fidelity";
import {
  MethodRuntimeProviderOutputSchema,
  MethodRuntimeSchema,
  type MethodRuntime,
} from "@/lib/session-generation/method-runtime";
import {
  LessonDeliveryInstructionsSchema,
  SessionDeliveryPolicySchema,
} from "@/lib/personalization/session-delivery-policy";
import { GenerationPersonalizationContextSchema } from "@/lib/personalization/personalization-generation";
import { KnowledgeMapTopicSchema } from "@/lib/knowledge-map/schema";
import { SESSION_ARCHITECTURE_VERSIONS } from "@/lib/session-generation/architecture";
import { PRACTICE_INTENTS } from "@/lib/learning/practice-variation";
import { MAX_RUNTIME_PLAN_SESSIONS } from "@/lib/plan-generation/schema";
import { StudyRouteSchema } from "@/lib/study-route/schema";

export const SessionGenerationRequestSchema = z.object({
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  /** Exact committed route expected by this generation request. */
  routeRevisionId: z.string().uuid().optional(),
  sessionAdjustment: z.object({
    familiarity: z.enum(["as_planned", "already_know", "need_teaching", "challenge_me"]),
    availableMinutes: z.number().int().min(10).max(90).nullable(),
    knownTargets: z.array(z.string().trim().min(2).max(180)).max(4).default([]),
    note: z.string().trim().max(500),
  }).optional(),
  previewContext: z.object({
    /**
     * Browser-preview plans have no durable database row to reload at the API
     * boundary, so the exact committed route travels with the validated
     * preview context. Authenticated requests continue to load it from
     * `study_routes` instead of trusting the client copy.
     */
    studyRoute: StudyRouteSchema.optional(),
    sessionArchitectureVersion: z.enum(SESSION_ARCHITECTURE_VERSIONS).default("filled_teaching_v1"),
    learningGoal: z.object({
      title: z.string().trim().min(2).max(160),
      topic: z.string().trim().min(2).max(500),
      kind: z.enum(["test", "topic", "course", "book", "skill"]),
      deadline: z.string().trim().max(80).nullable(),
      sourceMode: z.enum(["user_materials", "yova_generated"]),
      studyMode: z.enum(["inside_yova", "outside_yova"]),
      learningIntent: z.enum(["learn", "study"]),
    }),
    planRationale: z.string().trim().min(10).max(1_200),
    knowledgeTopics: z.array(KnowledgeMapTopicSchema).min(1).max(6),
    journey: z.object({
      currentSequence: z.number().int().positive(),
      totalSessions: z.number().int().positive().max(MAX_RUNTIME_PLAN_SESSIONS),
      previousSessions: z.array(z.object({
        sequence: z.number().int().positive(),
        title: z.string().trim().min(2).max(160),
        objective: z.string().trim().min(5).max(800),
        status: z.enum(["ready", "upcoming", "complete", "skipped"]),
        contentTargets: z.array(z.string().trim().min(5).max(180)).max(6),
      })).max(MAX_RUNTIME_PLAN_SESSIONS - 1),
      nextSessions: z.array(z.object({
        sequence: z.number().int().positive(),
        title: z.string().trim().min(2).max(160),
        objective: z.string().trim().min(5).max(800),
        contentTargets: z.array(z.string().trim().min(5).max(180)).max(6),
      })).max(MAX_RUNTIME_PLAN_SESSIONS - 1),
    }),
    session: z.object({
      title: z.string().trim().min(2).max(160),
      objective: z.string().trim().min(5).max(800),
      method: z.string().trim().min(2).max(160),
      methodReason: z.string().trim().min(5).max(800),
      estimatedMinutes: z.number().int().min(5).max(180),
      learningMode: z.enum(["learn", "study"]),
      topicIds: z.array(z.string().uuid()).min(1).max(6).default([]),
      contentTargets: z.array(z.string().trim().min(5).max(180)).max(6).default([]),
      completionEvidence: z.array(z.string().trim().min(8).max(220)).max(4).default([]),
      reviewConcept: z.string().trim().min(2).max(120).nullable().optional(),
      reviewType: z.enum(["repair_and_retrieve", "verify", "maintenance_transfer"]).nullable().optional(),
    }),
    learnerProfile: z.object({
      commonBlocker: z.string().trim().max(240).nullable(),
      guidancePreference: z.string().trim().max(240).nullable(),
      explanationPreference: z.string().trim().max(240).nullable(),
      focusFrequency: z.string().trim().max(240).nullable(),
      startingPattern: z.string().trim().max(240).nullable(),
      primaryImprovementGoal: z.string().trim().max(240).nullable(),
      functionalSupportNeed: z.string().trim().max(240).nullable().optional(),
      processingPreference: z.string().trim().max(240).nullable().optional(),
      memoryChallenge: z.string().trim().max(240).nullable().optional(),
      supportPreference: z.string().trim().max(240).nullable().optional(),
      workspacePreference: z.string().trim().max(240).nullable().optional(),
      freeformContext: z.string().trim().max(800).nullable().optional(),
      observationCorrection: z.string().trim().max(500).nullable().optional(),
    }).nullable(),
    recentResults: z.array(z.object({
      methodId: z.enum(CORE_METHOD_IDS).nullable(),
      taskType: z.enum(LEARNING_TASK_TYPES).nullable(),
      knowledgeStage: z.enum(["novice", "developing", "retrieval_ready"]).nullable(),
      correctAnswers: z.number().int().min(0).max(100).nullable(),
      totalAnswers: z.number().int().min(0).max(100).nullable(),
      feedback: z.enum(["too_easy", "about_right", "too_difficult"]).nullable(),
      observedGap: z.string().trim().max(500).nullable(),
      plannedMinutes: z.number().int().min(1).max(300).nullable(),
      actualMinutes: z.number().int().min(1).max(300).nullable(),
      calibrationPattern: z.enum(CALIBRATION_PATTERNS),
    })).max(8),
    recentInterruptions: z.array(z.object({
      occurredAt: z.string().datetime({ offset: true }),
      plannedMinutes: z.number().int().min(1).max(300).nullable(),
      actualMinutes: z.number().int().min(1).max(300).nullable(),
      completedSteps: z.number().int().min(0).max(20).nullable(),
      totalSteps: z.number().int().min(1).max(20).nullable(),
    })).max(4),
    conceptSignals: z.array(z.object({
      topicId: z.string().uuid().optional(),
      concept: z.string().trim().min(2).max(120),
      attempts: z.number().int().min(1).max(100),
      secureAttempts: z.number().int().min(0).max(100),
      needsReviewAttempts: z.number().int().min(0).max(100),
      lastOutcome: z.enum(["secure", "needs_review"]),
      lastObservedAt: z.string().datetime({ offset: true }),
      status: z.enum(["early_signal", "needs_review", "showing_strength"]),
      misconceptionSummary: z.string().trim().min(8).max(300).optional(),
    })).max(20),
    scaffoldSignals: z.array(z.object({
      topicId: z.string().uuid().optional(),
      concept: z.string().trim().min(2).max(120),
      checks: z.number().int().min(1).max(100),
      supportedChecks: z.number().int().min(0).max(100),
      independentChecks: z.number().int().min(0).max(100),
      secureIndependentChecks: z.number().int().min(0).max(100),
      latestOutcome: z.enum(["secure", "needs_review"]),
      latestPhase: z.enum(METHOD_PHASES),
      status: z.enum(["collect_evidence", "restore_support", "fade_support", "independent_transfer"]),
      evidence: z.string().trim().min(10).max(500),
      guidance: z.string().trim().min(10).max(500),
    })).max(20),
    topicCalibrationSignals: z.array(z.object({
      topicId: z.string().uuid().optional(),
      concept: z.string().trim().min(2).max(120),
      pattern: z.enum(CALIBRATION_PATTERNS),
      checkedAnswers: z.number().int().min(0).max(100),
      highConfidenceMisses: z.number().int().min(0).max(100),
      lowConfidenceSuccesses: z.number().int().min(0).max(100),
      misconceptionSummary: z.string().trim().min(8).max(300).optional(),
      feedback: z.string().trim().min(10).max(500),
    })).max(20).default([]),
    personalization: GenerationPersonalizationContextSchema.optional(),
  }).optional(),
}).superRefine((request, context) => {
  const previewRoute = request.previewContext?.studyRoute;
  if (!request.previewContext) return;

  if (request.routeRevisionId && !previewRoute) {
    context.addIssue({
      code: "custom",
      path: ["previewContext", "studyRoute"],
      message: "A routed browser preview must include its canonical study route.",
    });
    return;
  }
  if (!previewRoute) return;

  const routeIdentity = previewRoute.identity;
  const identityMatches = routeIdentity.lifecycleStatus === "committed"
    && routeIdentity.planId === request.planId
    && routeIdentity.sessionId === request.planSessionId
    && routeIdentity.routeRevisionId === request.routeRevisionId;
  if (!identityMatches) {
    context.addIssue({
      code: "custom",
      path: ["previewContext", "studyRoute", "identity"],
      message: "The browser preview route must be the exact committed route requested for this session.",
    });
  }
});

export type SessionGenerationRequest = z.infer<typeof SessionGenerationRequestSchema>;
export type SessionAdjustment = NonNullable<SessionGenerationRequest["sessionAdjustment"]>;
export type PreviewSessionGenerationContext = NonNullable<
  SessionGenerationRequest["previewContext"]
>;

export const SessionMethodBriefingSchema = z.object({
  learningMode: z.enum(["learn", "study"]),
  taskType: z.enum(LEARNING_TASK_TYPES),
  methodId: z.enum(CORE_METHOD_IDS),
  name: z.string().trim().min(3).max(90),
  what: z.string().trim().min(15).max(280),
  why: z.string().trim().min(20).max(500),
  how: z.array(z.string().trim().min(8).max(240)).min(2).max(5),
  completion: z.string().trim().min(15).max(300),
  personalization: z.array(z.string().trim().min(20).max(280)).min(1).max(3),
});

export const SessionCoverageSchema = z.object({
  focus: z.string().trim().min(10).max(240),
  essentialIdeas: z.array(z.string().trim().min(5).max(180)).min(1).max(4),
  completionEvidence: z.array(z.string().trim().min(8).max(220)).min(1).max(3),
  evidenceMap: z.array(z.object({
    essentialIdea: z.string().trim().min(5).max(180),
    activityConcept: z.string().trim().min(2).max(120),
  })).min(1).max(4),
  deferredContent: z.array(z.string().trim().min(5).max(180)).max(4),
});

export const TeachingBlockSchema = z.object({
  keyIdea: z.string().trim().min(10).max(220),
  explanation: z.string().trim().min(40).max(700),
  example: z.object({
    setup: z.string().trim().min(10).max(180),
    steps: z.array(z.string().trim().min(8).max(200)).min(2).max(5),
    takeaway: z.string().trim().min(10).max(180),
  }).nullable(),
  commonMistake: z.object({
    mistake: z.string().trim().min(8).max(240),
    correction: z.string().trim().min(10).max(300),
  }).nullable(),
});

export const LessonBriefSchema = z.object({
  version: z.literal(1),
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  essentialIdeas: z.array(z.string().trim().min(5).max(180)).min(1).max(4),
  sourceChunks: z.array(z.object({
    chunkId: z.string().uuid(),
    // OpenAI strict structured outputs require every object property to be
    // present. `null` represents a source chunk whose persisted material id is
    // unavailable; the server replaces model-supplied source metadata before
    // the learner ever sees it.
    materialId: z.string().uuid().nullable(),
    sourceName: z.string().trim().min(1).max(180),
    locationLabel: z.string().trim().min(2).max(120),
    role: z.enum(["content_source", "scope_outline"]),
    text: z.string().trim().min(12).max(6_000),
  })).max(6),
  knowledgeSource: z.enum([
    "model_knowledge",
    "material_content",
    "scope_defined_model_instruction",
    "mixed_material_and_model",
  ]),
  evidenceContext: z.object({
    confirmedGaps: z.array(z.object({
      topicId: z.string().uuid(),
      concept: z.string().trim().min(2).max(140),
      evidence: z.string().trim().min(8).max(300),
    })).max(4),
    secureKnowledge: z.array(z.object({
      topicId: z.string().uuid(),
      concept: z.string().trim().min(2).max(140),
      acknowledgement: z.string().trim().min(8).max(220),
    })).max(4),
    priorMisconceptions: z.array(z.object({
      topicId: z.string().uuid(),
      concept: z.string().trim().min(2).max(140),
      misconception: z.string().trim().min(8).max(300),
    })).max(3),
  }),
  contentRequirements: z.object({
    teachEveryEssentialIdea: z.literal(true),
    includeConcreteExample: z.boolean(),
    includeCommonMixup: z.literal(true),
    preservePrerequisiteOrder: z.literal(true),
  }),
});

const GeneratedSessionActivityBaseShape = {
  topicId: z.string().uuid().nullable(),
  methodPhase: z.enum(METHOD_PHASES),
  estimatedMinutes: z.number().int().min(1).max(20),
  requiredForCompletion: z.boolean(),
  label: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(320),
  teaching: TeachingBlockSchema.nullable(),
  practiceIntent: z.enum(PRACTICE_INTENTS).nullable().default(null),
  misconceptionSummary: z.string().trim().min(8).max(300).nullable().default(null),
  /**
   * Method-specific interaction data. Null for activities generated before
   * method runtimes existed, and for methods that still use the generic path,
   * so saved sessions keep parsing and rendering unchanged.
   */
  methodRuntime: MethodRuntimeSchema.nullable().default(null),
};

const NonModelMethodPhaseSchema = z.enum([
  "orient",
  "survey",
  "question",
  "pretest",
  "read_source",
  "retrieve",
  "explain",
  "reexplain",
  "guided_practice",
  "independent_practice",
  "discriminate",
  "connect",
  "repair",
  "evidence_match",
  "code_trace",
  "transfer",
  "schedule_return",
  "reflect",
  "review",
], { error: "Only instruction activities may use the model phase." });

const NoTeachingBlockSchema = z.null({
  error: "Only instruction activities may carry a teaching block.",
});

const InstructionActivitySchema = z.object({
  ...GeneratedSessionActivityBaseShape,
  type: z.literal("instruction"),
  topicId: z.null(),
  concept: z.null(),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.null(),
  feedback: z.null(),
  practiceIntent: z.null().default(null),
  misconceptionSummary: z.null().default(null),
});

const ReflectionActivitySchema = z.object({
  ...GeneratedSessionActivityBaseShape,
  type: z.literal("reflection"),
  methodPhase: NonModelMethodPhaseSchema,
  topicId: z.null(),
  concept: z.null(),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.null(),
  feedback: z.null(),
  teaching: NoTeachingBlockSchema,
  practiceIntent: z.null().default(null),
  misconceptionSummary: z.null().default(null),
});

const MultipleChoiceActivityOutputSchema = z.object({
  ...GeneratedSessionActivityBaseShape,
  type: z.literal("multiple_choice"),
  methodPhase: NonModelMethodPhaseSchema,
  topicId: z.string().uuid(),
  concept: z.string().trim().min(2).max(120),
  choices: z.array(z.string().trim().min(1).max(220)).min(3).max(5),
  correctAnswer: z.string().trim().min(1).max(220),
  feedback: z.string().trim().min(20).max(500),
  teaching: NoTeachingBlockSchema,
});

const FreeResponseActivitySchema = z.object({
  ...GeneratedSessionActivityBaseShape,
  type: z.literal("free_response"),
  methodPhase: NonModelMethodPhaseSchema,
  topicId: z.string().uuid(),
  concept: z.string().trim().min(2).max(120),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.string().trim().min(1).max(600),
  feedback: z.string().trim().min(20).max(500),
  teaching: NoTeachingBlockSchema,
});

const providerRuntime = MethodRuntimeProviderOutputSchema.nullable().default(null);
const ProviderInstructionActivitySchema = InstructionActivitySchema.extend({ methodRuntime: providerRuntime });
const ProviderReflectionActivitySchema = ReflectionActivitySchema.extend({ methodRuntime: providerRuntime });
const ProviderMultipleChoiceActivitySchema = MultipleChoiceActivityOutputSchema
  .omit({ choices: true, correctAnswer: true })
  .extend({
    choices: z.array(z.string().trim().min(1).max(220)).length(4),
    correctChoiceIndex: z.number().int().min(0).max(3),
    methodRuntime: providerRuntime,
  });
const ProviderFreeResponseActivitySchema = FreeResponseActivitySchema.extend({ methodRuntime: providerRuntime });

// The OpenAI SDK parses the provider response with this schema before YOVA's
// deterministic normalizers and bounded repair loop can run. Keep cross-field
// rules out of this boundary: a provider mistake should become a normal YOVA
// validation result, not a raw SDK ZodError that bypasses generation stats.
const GeneratedSessionActivityOutputSchema = z.discriminatedUnion("type", [
  ProviderInstructionActivitySchema,
  ProviderReflectionActivitySchema,
  ProviderMultipleChoiceActivitySchema,
  ProviderFreeResponseActivitySchema,
]);

const StrictGeneratedSessionActivitySchema = z.discriminatedUnion("type", [
  InstructionActivitySchema,
  ReflectionActivitySchema,
  MultipleChoiceActivityOutputSchema,
  FreeResponseActivitySchema,
]).superRefine((activity, context) => {
  if (activity.type === "multiple_choice" && !activity.choices.includes(activity.correctAnswer)) {
    context.addIssue({ code: "custom", path: ["correctAnswer"], message: "The correct answer must exactly match one choice." });
  }
  if (activity.methodPhase === "model" && !activity.teaching) {
    context.addIssue({ code: "custom", path: ["teaching"], message: "Model activities need a structured teaching block." });
  }
});

export type GeneratedSessionActivity = {
  topicId: string | null;
  methodPhase: (typeof METHOD_PHASES)[number];
  concept: string | null;
  estimatedMinutes: number;
  requiredForCompletion: boolean;
  label: string;
  title: string;
  body: string;
  teaching: z.infer<typeof TeachingBlockSchema> | null;
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  choices: string[];
  correctAnswer: string | null;
  feedback: string | null;
  practiceIntent?: (typeof PRACTICE_INTENTS)[number] | null;
  misconceptionSummary?: string | null;
  methodRuntime?: MethodRuntime | null;
};

// Keep the public TypeScript shape ergonomic for rendering and test fixtures,
// while the final runtime schema remains a strict discriminated union.
export const GeneratedSessionActivitySchema = StrictGeneratedSessionActivitySchema as unknown as z.ZodType<GeneratedSessionActivity>;

const SessionSourceGroundingOutputSchema = z.object({
  mode: z.enum(["materials_only", "materials_plus_ai"]),
  summary: z.string().trim().min(20).max(420),
  sourceNames: z.array(z.string().trim().min(1).max(180)).min(1).max(5),
  anchors: z.array(z.object({
    chunkId: z.string().uuid(),
    sourceName: z.string().trim().min(1).max(180),
    locationLabel: z.string().trim().min(2).max(120),
    excerpt: z.string().trim().min(12).max(240),
    usedFor: z.string().trim().min(10).max(240),
  })).min(1).max(4),
  supplements: z.array(z.object({
    topic: z.string().trim().min(2).max(140),
    reason: z.string().trim().min(15).max(280),
  })).max(3),
});

export const SessionSourceGroundingSchema = SessionSourceGroundingOutputSchema.superRefine((grounding, context) => {
  if (grounding.mode === "materials_only" && grounding.supplements.length > 0) {
    context.addIssue({ code: "custom", path: ["supplements"], message: "Material-only sessions cannot list AI supplements." });
  }
  if (grounding.mode === "materials_plus_ai" && grounding.supplements.length === 0) {
    context.addIssue({ code: "custom", path: ["supplements"], message: "Supplemented sessions must explain what YOVA added." });
  }
});

export const SessionSupportPlanSchema = z.object({
  level: z.enum(["supported_start", "fading", "independent_start"]),
  title: z.string().trim().min(3).max(180),
  explanation: z.string().trim().min(20).max(600),
  evidenceLabel: z.string().trim().min(3).max(180),
  concept: z.string().trim().min(2).max(120).nullable(),
});

export const GeneratedSessionDraftOutputSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  rationale: z.string().trim().min(20).max(700),
  coverage: SessionCoverageSchema,
  methodBriefing: SessionMethodBriefingSchema,
  sourceGrounding: SessionSourceGroundingSchema.nullable(),
  activities: z.array(GeneratedSessionActivitySchema).min(3).max(8),
});

/**
 * Provider-facing full-session schema. It validates JSON shape and field
 * constraints only; YOVA applies all cross-field invariants after parsing so
 * structural misses participate in the bounded repair and observation flow.
 */
export const GeneratedSessionDraftProviderOutputSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  rationale: z.string().trim().min(20).max(700),
  coverage: SessionCoverageSchema,
  methodBriefing: SessionMethodBriefingSchema,
  sourceGrounding: SessionSourceGroundingOutputSchema.nullable(),
  activities: z.array(GeneratedSessionActivityOutputSchema).min(3).max(8),
});

export type GeneratedSessionDraftProviderOutput = z.infer<typeof GeneratedSessionDraftProviderOutputSchema>;

/**
 * Resolves provider-only multiple-choice indexes into YOVA's canonical answer
 * representation. The provider never gets to repeat or paraphrase the correct
 * choice, while the final session schema still verifies answer membership.
 */
export function materializeGeneratedSessionProviderOutput(
  provider: GeneratedSessionDraftProviderOutput,
) {
  return {
    ...provider,
    activities: provider.activities.map((activity) => {
      if (activity.type !== "multiple_choice") return activity;
      const { correctChoiceIndex, ...canonical } = activity;
      return {
        ...canonical,
        correctAnswer: activity.choices[correctChoiceIndex]!,
      };
    }),
  };
}

export const GeneratedSessionDraftSchema = GeneratedSessionDraftOutputSchema.superRefine((session, context) => {
  const firstActivity = session.activities[0];
  const expectedOpeningPhase = methodFidelityContractForPrompt(
    session.methodBriefing.methodId,
    session.methodBriefing.learningMode,
  ).orderedPhases[0];
  if (firstActivity?.methodPhase !== expectedOpeningPhase) {
    context.addIssue({
      code: "custom",
      path: ["activities", 0],
      message: `${session.methodBriefing.methodId} sessions must begin with the ${expectedOpeningPhase} phase.`,
    });
  }
  if (session.methodBriefing.learningMode === "learn") {
    const pretestingModelIndex = session.methodBriefing.methodId === "pretesting"
      && firstActivity?.methodPhase === "pretest"
      ? session.activities.findIndex((activity, index) => (
        index > 0 && activity.methodPhase === "model" && Boolean(activity.teaching)
      ))
      : -1;
    if (!firstActivity?.teaching && pretestingModelIndex < 0) {
      context.addIssue({
        code: "custom",
        path: session.methodBriefing.methodId === "pretesting"
          ? ["activities"]
          : ["activities", 0, "teaching"],
        message: session.methodBriefing.methodId === "pretesting"
          ? "A Learn pretest may come first only when a structured model-phase subject lesson follows it."
          : "Teaching-first sessions must begin with a structured subject lesson, not a paragraph in the instruction field.",
      });
    }
  }
  if (!session.activities.some((activity) => activity.requiredForCompletion && (activity.type === "multiple_choice" || activity.type === "free_response"))) {
    context.addIssue({ code: "custom", path: ["activities"], message: "Completion must require at least one knowledge-producing attempt." });
  }
});

const StreamedGeneratedSessionActivityBaseShape = {
  topicId: z.string().uuid().nullable(),
  methodPhase: z.enum(METHOD_PHASES),
  estimatedMinutes: z.number().int().min(1).max(20),
  requiredForCompletion: z.boolean(),
  label: z.string().trim().min(2).max(50),
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(320),
  teaching: z.null(),
  lessonBrief: LessonBriefSchema.nullable(),
  practiceIntent: z.enum(PRACTICE_INTENTS).nullable().default(null),
  misconceptionSummary: z.string().trim().min(8).max(300).nullable().default(null),
};

const StreamedInstructionActivitySchema = z.object({
  ...StreamedGeneratedSessionActivityBaseShape,
  type: z.literal("instruction"),
  topicId: z.string().uuid(),
  concept: z.null(),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.null(),
  feedback: z.null(),
  practiceIntent: z.null().default(null),
  misconceptionSummary: z.null().default(null),
});

const StreamedReflectionActivitySchema = z.object({
  ...StreamedGeneratedSessionActivityBaseShape,
  type: z.literal("reflection"),
  topicId: z.null(),
  concept: z.null(),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.null(),
  feedback: z.null(),
  practiceIntent: z.null().default(null),
  misconceptionSummary: z.null().default(null),
});

const StreamedMultipleChoiceActivitySchema = z.object({
  ...StreamedGeneratedSessionActivityBaseShape,
  type: z.literal("multiple_choice"),
  topicId: z.string().uuid(),
  concept: z.string().trim().min(2).max(120),
  choices: z.array(z.string().trim().min(1).max(220)).min(3).max(5),
  correctAnswer: z.string().trim().min(1).max(220),
  feedback: z.string().trim().min(20).max(500),
}).superRefine((activity, context) => {
  if (!activity.choices.includes(activity.correctAnswer)) {
    context.addIssue({ code: "custom", path: ["correctAnswer"], message: "The correct answer must exactly match one choice." });
  }
});

const StreamedFreeResponseActivitySchema = z.object({
  ...StreamedGeneratedSessionActivityBaseShape,
  type: z.literal("free_response"),
  topicId: z.string().uuid(),
  concept: z.string().trim().min(2).max(120),
  choices: z.array(z.string()).max(0),
  correctAnswer: z.string().trim().min(1).max(600),
  feedback: z.string().trim().min(20).max(500),
});

// The provider-facing schema accepts a misplaced lesson brief long enough for
// YOVA to normalize it at the output boundary. OpenAI's structured-output
// parser validates this schema before our deterministic repair code runs, so
// putting the cross-field placement rule here would turn an otherwise usable
// skeleton into a raw SDK ZodError.
const StreamedGeneratedSessionActivityOutputSchema = z.discriminatedUnion("type", [
  StreamedInstructionActivitySchema,
  StreamedReflectionActivitySchema,
  StreamedMultipleChoiceActivitySchema,
  StreamedFreeResponseActivitySchema,
]);

const StrictStreamedGeneratedSessionActivitySchema = StreamedGeneratedSessionActivityOutputSchema.superRefine((activity, context) => {
  if ((activity.methodPhase === "model" || activity.methodPhase === "orient") && activity.type === "instruction" && !activity.lessonBrief) {
    context.addIssue({ code: "custom", path: ["lessonBrief"], message: "Teaching activities need a lesson brief." });
  }
  if (activity.type !== "instruction" && activity.lessonBrief) {
    context.addIssue({ code: "custom", path: ["lessonBrief"], message: "Only instruction activities may carry a lesson brief." });
  }
});

export type StreamedGeneratedSessionActivity = Omit<GeneratedSessionActivity, "teaching"> & {
  teaching: null;
  lessonBrief: z.infer<typeof LessonBriefSchema> | null;
};

// Keep old cached fixtures and rendering code ergonomic while the strict
// runtime schema fills newly introduced evidence-routing fields with null.
export const StreamedGeneratedSessionActivitySchema = StrictStreamedGeneratedSessionActivitySchema as unknown as z.ZodType<StreamedGeneratedSessionActivity>;

export const StreamedGeneratedSessionDraftOutputSchema = z.object({
  topicIds: z.array(z.string().uuid()).min(1).max(6),
  rationale: z.string().trim().min(20).max(700),
  coverage: SessionCoverageSchema,
  methodBriefing: SessionMethodBriefingSchema,
  sourceGrounding: SessionSourceGroundingSchema.nullable(),
  // Eight focused activities support four teach/check cycles. A ninth slot is
  // reserved only for the optional delayed-return marker, which is not part of
  // today's time budget.
  activities: z.array(StreamedGeneratedSessionActivityOutputSchema).min(3).max(9),
});

export type StreamedGeneratedSessionDraftOutput = z.infer<typeof StreamedGeneratedSessionDraftOutputSchema>;

/**
 * Removes lesson briefs from activity types that can never present teaching.
 * The final schema still enforces the invariant after this deterministic
 * normalization, while a provider placement mistake no longer crashes the
 * SDK parser before YOVA can repair it.
 */
export function normalizeStreamedLessonBriefPlacement(
  draft: StreamedGeneratedSessionDraftOutput,
): StreamedGeneratedSessionDraftOutput {
  return {
    ...draft,
    activities: draft.activities.map((activity) => (
      activity.type === "instruction" || activity.lessonBrief === null
        ? activity
        : { ...activity, lessonBrief: null }
    )),
  };
}

export const StreamedGeneratedSessionDraftSchema = StreamedGeneratedSessionDraftOutputSchema.extend({
  activities: z.array(StreamedGeneratedSessionActivitySchema).min(3).max(9),
}).superRefine((session, context) => {
  const focusedActivityCount = session.activities.filter((activity) => activity.methodPhase !== "schedule_return").length;
  if (focusedActivityCount > 8) {
    context.addIssue({ code: "custom", path: ["activities"], message: "Streamed sessions may contain at most eight focused activities." });
  }
  const returnCount = session.activities.filter((activity) => activity.methodPhase === "schedule_return").length;
  if (returnCount > 1) {
    context.addIssue({ code: "custom", path: ["activities"], message: "Streamed sessions may contain at most one delayed-return marker." });
  }
  const firstActivity = session.activities[0];
  const expectedOpeningPhase = methodFidelityContractForPrompt(
    session.methodBriefing.methodId,
    session.methodBriefing.learningMode,
  ).orderedPhases[0];
  if (firstActivity?.methodPhase !== expectedOpeningPhase) {
    context.addIssue({
      code: "custom",
      path: ["activities", 0],
      message: `${session.methodBriefing.methodId} sessions must begin with the ${expectedOpeningPhase} phase.`,
    });
  }
  if (session.methodBriefing.learningMode === "learn" && !firstActivity?.lessonBrief) {
    context.addIssue({ code: "custom", path: ["activities", 0, "lessonBrief"], message: "Teaching-first streamed sessions must begin with a lesson brief." });
  }
  if (!session.activities.some((activity) => activity.requiredForCompletion && (activity.type === "multiple_choice" || activity.type === "free_response"))) {
    context.addIssue({ code: "custom", path: ["activities"], message: "Completion must require at least one knowledge-producing attempt." });
  }
});

export const CachedGeneratedSessionV15Schema = GeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(15),
  routeRevisionId: z.string().uuid().optional(),
  model: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  routingContext: z.object({
    taskType: z.enum(LEARNING_TASK_TYPES),
    knowledgeStage: z.enum(["novice", "developing", "retrieval_ready"]),
  }).optional(),
  supportPlan: SessionSupportPlanSchema.optional(),
  deliveryPolicy: SessionDeliveryPolicySchema,
  cacheContext: z.object({
    effectiveMinutes: z.number().int().min(5).max(180),
    adjustmentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    contractFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    scopeFingerprint: z.string().regex(/^sc1:[a-f0-9]{16}$/),
    routeRevisionId: z.string().uuid().optional(),
  }).optional(),
}).superRefine(requireMatchingCachedRouteRevisionReceipts);

export const CachedGeneratedSessionV16Schema = StreamedGeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(16),
  routeRevisionId: z.string().uuid().optional(),
  model: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  routingContext: z.object({
    taskType: z.enum(LEARNING_TASK_TYPES),
    knowledgeStage: z.enum(["novice", "developing", "retrieval_ready"]),
  }).optional(),
  supportPlan: SessionSupportPlanSchema.optional(),
  deliveryPolicy: SessionDeliveryPolicySchema,
  deliveryInstructions: LessonDeliveryInstructionsSchema,
});

// V17 invalidates older streamed skeletons whose provider-authored activity
// estimates could substantially underfill the learner's selected time and
// whose teaching blocks were not guaranteed to alternate with their checks.
export const CachedGeneratedSessionV17Schema = StreamedGeneratedSessionDraftSchema.extend({
  schemaVersion: z.literal(17),
  routeRevisionId: z.string().uuid().optional(),
  model: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  routingContext: z.object({
    taskType: z.enum(LEARNING_TASK_TYPES),
    knowledgeStage: z.enum(["novice", "developing", "retrieval_ready"]),
  }).optional(),
  supportPlan: SessionSupportPlanSchema.optional(),
  deliveryPolicy: SessionDeliveryPolicySchema,
  deliveryInstructions: LessonDeliveryInstructionsSchema,
  cacheContext: z.object({
    effectiveMinutes: z.number().int().min(5).max(180),
    adjustmentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    contractFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    scopeFingerprint: z.string().regex(/^sc1:[a-f0-9]{16}$/),
    routeRevisionId: z.string().uuid().optional(),
  }),
}).superRefine(requireMatchingCachedRouteRevisionReceipts);

function requireMatchingCachedRouteRevisionReceipts(
  session: {
    routeRevisionId?: string;
    cacheContext?: { routeRevisionId?: string };
  },
  context: z.RefinementCtx,
) {
  if (
    session.cacheContext
    && session.routeRevisionId !== session.cacheContext.routeRevisionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["cacheContext", "routeRevisionId"],
      message: "The cached session and cache context must identify the same study-route revision.",
    });
  }
}

export const CachedGeneratedSessionSchema = z.discriminatedUnion("schemaVersion", [
  CachedGeneratedSessionV15Schema,
  CachedGeneratedSessionV16Schema,
  CachedGeneratedSessionV17Schema,
]);

export const SessionGenerationResponseSchema = z.object({
  planSessionId: z.string().uuid(),
  session: CachedGeneratedSessionSchema,
  generation: z.object({
    mode: z.enum(["openai", "cache"]),
    persistence: z.enum(["browser", "supabase"]),
  }),
});

export type FilledGeneratedSessionDraft = z.infer<typeof GeneratedSessionDraftSchema>;
export type StreamedGeneratedSessionDraft = z.infer<typeof StreamedGeneratedSessionDraftSchema>;
export type GeneratedSessionDraft = FilledGeneratedSessionDraft | StreamedGeneratedSessionDraft;
export type SessionMethodBriefing = z.infer<typeof SessionMethodBriefingSchema>;
export type SessionCoverage = z.infer<typeof SessionCoverageSchema>;
export type TeachingBlock = z.infer<typeof TeachingBlockSchema>;
export type LessonBrief = z.infer<typeof LessonBriefSchema>;
export type SessionSourceGrounding = z.infer<typeof SessionSourceGroundingSchema>;
export type SessionGenerationResponse = z.infer<typeof SessionGenerationResponseSchema>;

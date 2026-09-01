import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { MaterialExcerpt } from "@/lib/materials/context";
import {
  buildMappedSessionSourceGrounding,
  validateSessionSourceGrounding,
} from "@/lib/materials/grounding";
import {
  getCoreLearningMethod,
  type CoreMethodId,
  type LearningTaskType,
} from "@/lib/learning/method-catalog";
import {
  methodFidelityContractForPrompt,
  type MethodPhase,
} from "@/lib/learning/method-fidelity";
import { mapTargetsToKnowledgeTopics } from "@/lib/learning/target-topic-mapping";
import type { SessionLearningMode, StudyMode } from "@/lib/domain";
import type { LessonDeliveryInstructions } from "@/lib/personalization/session-delivery-policy";
import { cachedSessionActivityContractIssue } from "@/lib/session-generation/cache-activity-contract";
import {
  GeneratedSessionDraftSchema,
  StreamedGeneratedSessionDraftSchema,
  type GeneratedSessionDraft,
  type StreamedGeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import { validateSessionCompletionContract } from "@/lib/session-generation/completion-contract";
import { validateStreamedLessonScope } from "@/lib/session-generation/lesson-brief";
import { validateMethodRuntimeActivities } from "@/lib/session-generation/method-runtime";
import { validateStreamedTeachingPacing } from "@/lib/session-generation/streamed-pacing";
import { validateSessionTimeBudget } from "@/lib/session-generation/time-budget";
import type { StudyRoute } from "@/lib/study-route/schema";

type DegradedArchitecture = "filled" | "streamed";

export type SourceGroundedDegradedSessionInput = {
  architecture: DegradedArchitecture;
  objective: string;
  learningMode: SessionLearningMode;
  executionEnvironment: StudyMode;
  taskType: LearningTaskType;
  methodId: CoreMethodId;
  methodName?: string | null;
  estimatedMinutes: number;
  topicIds: string[];
  /** Immutable committed-route identity; teaching may use a validated subset. */
  routeTopicIds?: string[];
  contentTargets: string[];
  deferredContentTargets: string[];
  completionEvidence: string[];
  knowledgeTopics: KnowledgeMapTopic[];
  materials: MaterialExcerpt[];
  personalizationReasons: string[];
  studyRoute?: StudyRoute | null;
  deliveryInstructions?: LessonDeliveryInstructions;
  maximumActivities: number;
};

/**
 * Builds the last-resort session required by the personalization contract.
 *
 * The fallback is deliberately narrower than normal generation. It may quote
 * and ask about mapped explanatory source chunks, but it never turns a scope
 * outline, an AI-origin topic, or an unmapped plan label into subject teaching.
 * Returning `null` is the safety boundary: callers must ask for readable
 * material instead of inventing the missing explanation.
 */
export function buildSourceGroundedDegradedSession(
  input: SourceGroundedDegradedSessionInput,
): GeneratedSessionDraft | null {
  const trustedScope = trustedMaterialFallbackScope(input);
  if (!trustedScope) return null;
  return buildTrustedSourceGroundedDegradedSession(trustedScope);
}

/** Privacy-safe authority check used only to classify a terminal fallback. */
export function hasTrustworthyMaterialFallbackScope(
  input: SourceGroundedDegradedSessionInput,
) {
  return trustedMaterialFallbackScope(input) !== null;
}

/**
 * Narrows a mixed-authority session to the targets that have exact mapped
 * explanatory prose. Any target without that authority is carried into
 * deferredContentTargets instead of being taught from model knowledge.
 */
function trustedMaterialFallbackScope(
  input: SourceGroundedDegradedSessionInput,
): SourceGroundedDegradedSessionInput | null {
  if (input.topicIds.length === 0 || input.topicIds.length > 4) return null;
  if (input.contentTargets.length > 4) return null;
  if (input.architecture === "streamed" && !input.deliveryInstructions) return null;

  const activeTopics = input.topicIds.flatMap((topicId) => {
    const topic = input.knowledgeTopics.find((candidate) => candidate.id === topicId);
    return topic ? [topic] : [];
  });
  if (activeTopics.length !== input.topicIds.length) return null;

  const mappedTargets = mapTargetsToKnowledgeTopics(input.contentTargets, activeTopics);
  if (mappedTargets.issue) return null;

  const trustedTopicIds = new Set(activeTopics.flatMap((topic) => {
    if (topic.origin !== "material" || topic.sourceReferences.length === 0) return [];
    const allowedChunkIds = new Set(topic.sourceReferences.map((reference) => reference.chunkId));
    const hasExplanatorySource = input.materials.some((material) => (
      material.role === "content_source"
      && Boolean(material.chunkId)
      && allowedChunkIds.has(material.chunkId!)
      && material.text.trim().length >= 40
    ));
    const hasScopeOnlyReference = input.materials.some((material) => (
      material.role === "scope_outline"
      && Boolean(material.chunkId)
      && allowedChunkIds.has(material.chunkId!)
    ));
    return hasExplanatorySource && !hasScopeOnlyReference ? [topic.id] : [];
  }));

  if (input.contentTargets.length === 0) {
    const topicIds = input.topicIds.filter((topicId) => trustedTopicIds.has(topicId));
    return topicIds.length > 0 ? { ...input, topicIds } : null;
  }

  const trustedAssignments = mappedTargets.assignments.filter((assignment) => (
    trustedTopicIds.has(assignment.topic.id)
  ));
  if (trustedAssignments.length === 0) return null;
  const trustedTargetIndexes = new Set(
    trustedAssignments.map((assignment) => assignment.targetIndex),
  );
  const deferredTargets = input.contentTargets.filter((_, index) => (
    !trustedTargetIndexes.has(index)
  ));

  return {
    ...input,
    // A degraded session must not pad one verified claim to fill a longer
    // window after other targets were deferred. Fifteen minutes per retained
    // target is the largest honest deterministic slice.
    estimatedMinutes: Math.min(
      input.estimatedMinutes,
      Math.max(15, trustedAssignments.length * 15),
    ),
    topicIds: uniqueText(trustedAssignments.map((assignment) => assignment.topic.id)),
    contentTargets: trustedAssignments.map((assignment) => assignment.target),
    // Completion evidence is plan-authored for the original joint scope and
    // cannot be safely rebound by array position after narrowing. The builder
    // supplies its explicit source-grounded completion contract below.
    completionEvidence: [],
    deferredContentTargets: uniqueText([
      ...input.deferredContentTargets,
      ...deferredTargets,
    ]),
  };
}

function buildTrustedSourceGroundedDegradedSession(
  input: SourceGroundedDegradedSessionInput,
): GeneratedSessionDraft | null {
  const activeTopics = input.topicIds.flatMap((topicId) => {
    const topic = input.knowledgeTopics.find((candidate) => candidate.id === topicId);
    return topic ? [topic] : [];
  });
  if (activeTopics.length !== input.topicIds.length) return null;

  const mappedTargets = mapTargetsToKnowledgeTopics(input.contentTargets, activeTopics);
  if (mappedTargets.issue) return null;

  const trustedByTopic = new Map<string, MaterialExcerpt>();
  for (const topic of activeTopics) {
    if (topic.origin !== "material" || topic.sourceReferences.length === 0) return null;
    const allowedChunkIds = new Set(topic.sourceReferences.map((reference) => reference.chunkId));
    const source = input.materials.find((material) => (
      material.role === "content_source"
      && Boolean(material.chunkId)
      && allowedChunkIds.has(material.chunkId!)
      && material.text.trim().length >= 40
    ));
    if (!source) return null;
    trustedByTopic.set(topic.id, source);
  }

  const trustedMaterials = uniqueBy(
    [...trustedByTopic.values()],
    (material) => material.chunkId!,
  );
  const sourceGrounding = buildMappedSessionSourceGrounding({
    materials: trustedMaterials,
    focus: input.objective,
  });
  if (!sourceGrounding) return null;

  const groundingIssue = validateSessionSourceGrounding({
    sourceMode: "user_materials",
    materials: input.materials,
    grounding: sourceGrounding,
    materialTopicRequirements: activeTopics.map((topic) => ({
      topic: topic.title,
      chunkIds: topic.sourceReferences.map((reference) => reference.chunkId),
    })),
  });
  if (groundingIssue) return null;

  const targetSources = input.contentTargets.length > 0
    ? mappedTargets.assignments.map((assignment) => trustedByTopic.get(assignment.topic.id)!)
    : activeTopics.map((topic) => trustedByTopic.get(topic.id)!);
  const essentialIdeas = uniqueBy(
    targetSources.map((source) => sourceClaim(source.text)),
    (claim) => claim,
  ).slice(0, 4);
  if (essentialIdeas.length === 0) return null;
  if (essentialIdeas.length !== targetSources.length) return null;

  const phases = fallbackPhases(input);
  if (!phases) return null;
  const questionIndexes = phases.flatMap((phase, index) => (
    questionPhase(phase.methodPhase) ? [index] : []
  ));
  if (questionIndexes.length < essentialIdeas.length) return null;

  const method = getCoreLearningMethod(input.methodId);
  const ideaAssignments = essentialIdeas.map((idea, index) => {
    const targetAssignment = mappedTargets.assignments[index];
    const topic = targetAssignment?.topic ?? activeTopics[index % activeTopics.length]!;
    const source = trustedByTopic.get(topic.id)!;
    return {
      idea,
      topic,
      source,
      target: input.contentTargets[index] ?? null,
      concept: boundedLabel(input.contentTargets[index] ?? topic.title, 120),
      questionIndex: questionIndexes[index]!,
    };
  });
  const assignmentByQuestionIndex = new Map(
    ideaAssignments.map((assignment) => [assignment.questionIndex, assignment]),
  );

  const methodActivities = phases.map((phase, index) => {
    const assigned = assignmentByQuestionIndex.get(index)
      ?? ideaAssignments[index % ideaAssignments.length]!;
    return input.architecture === "streamed"
      ? streamedActivity({
        phase,
        index,
        assigned,
        input,
        trustedMaterials,
        ideaAssignments,
      })
      : filledActivity({ phase, index, assigned, input });
  });
  const recognitionActivity = requiresSourceGroundedLearnRecognition(input)
    ? sourceGroundedRecognitionActivity({
      assigned: ideaAssignments.at(-1)!,
      deferredTargets: input.deferredContentTargets,
      streamed: input.architecture === "streamed",
    })
    : null;
  if (requiresSourceGroundedLearnRecognition(input) && !recognitionActivity) return null;
  const activities = recognitionActivity
    ? insertBeforeDelayedReturn(methodActivities, recognitionActivity)
    : methodActivities;
  const completionEvidence = uniqueText(input.completionEvidence).slice(0, 3);
  const draft = {
    topicIds: input.routeTopicIds ?? input.topicIds,
    rationale: "The generated lesson did not pass YOVA's bounded checks, so this degraded session keeps the committed route and uses only verified explanatory sections from the learner's mapped source.",
    coverage: {
      focus: boundedText(input.objective, 240),
      essentialIdeas,
      completionEvidence: completionEvidence.length > 0
        ? completionEvidence
        : ["Explain each active target using only the mapped source section, then complete the final closed-source check."],
      evidenceMap: ideaAssignments.map((assignment) => ({
        essentialIdea: assignment.idea,
        activityConcept: assignment.concept,
      })),
      deferredContent: uniqueText(input.deferredContentTargets).slice(0, 4),
    },
    methodBriefing: {
      learningMode: input.learningMode,
      taskType: input.taskType,
      methodId: input.methodId,
      name: input.methodName?.trim() || method.name,
      what: method.what,
      why: `${method.why} This degraded path keeps the committed recipe while limiting factual content to verified mapped source text.`.slice(0, 500),
      how: method.how.slice(0, 4),
      completion: method.completion,
      personalization: normalizedPersonalization(input.personalizationReasons),
    },
    sourceGrounding,
    activities,
  };

  const parsed = input.architecture === "streamed"
    ? StreamedGeneratedSessionDraftSchema.safeParse(draft)
    : GeneratedSessionDraftSchema.safeParse(draft);
  if (!parsed.success) return null;

  const routeIssue = sourceGroundedFallbackRouteIssue(parsed.data, input.studyRoute);
  const timeIssue = validateSessionTimeBudget(parsed.data, input.estimatedMinutes);
  const cacheContractIssue = cachedSessionActivityContractIssue(parsed.data, {
    reviewType: null,
    reviewConcept: null,
    estimatedMinutes: input.estimatedMinutes,
    executionEnvironment: input.executionEnvironment,
  });
  const runtimeIssue = validateMethodRuntimeActivities(
    input.methodId,
    parsed.data.activities,
  );
  const completionIssue = validateSessionCompletionContract({
    essentialIdeas: parsed.data.coverage.essentialIdeas,
    evidenceMap: parsed.data.coverage.evidenceMap,
    activities: parsed.data.activities,
  });
  const streamedScopeIssue = input.architecture === "streamed"
    ? validateStreamedLessonScope(parsed.data as StreamedGeneratedSessionDraft, {
      sessionTopicIds: input.routeTopicIds ?? input.topicIds,
      sessionObjective: input.objective,
      sessionContentTargets: input.contentTargets,
      sessionEstimatedMinutes: input.estimatedMinutes,
      authoritativeTargetAssignments: ideaAssignments.flatMap((assignment) => (
        assignment.target
          ? [{ essentialIdea: assignment.idea, target: assignment.target }]
          : []
      )),
    })
    : null;
  const streamedPacingIssue = input.architecture === "streamed"
    ? validateStreamedTeachingPacing({
      draft: parsed.data as StreamedGeneratedSessionDraft,
      availableMinutes: input.estimatedMinutes,
      maximumFocusedActivities: input.maximumActivities,
    })
    : null;
  return routeIssue || timeIssue || cacheContractIssue || runtimeIssue || completionIssue || streamedScopeIssue || streamedPacingIssue
    ? null
    : parsed.data;
}

type FallbackPhase = { methodPhase: MethodPhase; activeMinutes: number };

function fallbackPhases(input: SourceGroundedDegradedSessionInput): FallbackPhase[] | null {
  const recognitionMinutes = requiresSourceGroundedLearnRecognition(input) ? 2 : 0;
  const methodMinutes = input.estimatedMinutes - recognitionMinutes;
  const routePhases = input.studyRoute?.execution.orderedPhases.map((phase) => ({
    methodPhase: phase.methodPhase,
    activeMinutes: phase.activeMinutes,
  }));
  const methodPhases = methodFidelityContractForPrompt(
    input.methodId,
    input.learningMode,
  ).orderedPhases;
  if (methodMinutes < methodPhases.length) return null;
  const routeMinutes = routePhases?.reduce((total, phase) => total + phase.activeMinutes, 0);
  const base = routePhases?.length
    ? routeMinutes === methodMinutes
      ? routePhases
      : allocatePhaseMinutes(
        routePhases.map((phase) => phase.methodPhase),
        methodMinutes,
      )
    : allocatePhaseMinutes(methodPhases, methodMinutes);
  let phases = base.flatMap(splitLongPhase);

  const minimumQuestionCount = Math.max(
    input.contentTargets.length || 1,
    input.methodId === "practice_test_error_repair" ? 3 : 1,
    input.methodId === "interleaved_practice" ? 2 : 1,
  );
  while (phases.filter((phase) => questionPhase(phase.methodPhase)).length < minimumQuestionCount) {
    const splitIndex = phases.findIndex((phase) => (
      questionPhase(phase.methodPhase) && phase.activeMinutes >= 2
    ));
    if (splitIndex < 0) return null;
    const phase = phases[splitIndex]!;
    const firstMinutes = Math.floor(phase.activeMinutes / 2);
    phases = [
      ...phases.slice(0, splitIndex),
      { ...phase, activeMinutes: firstMinutes },
      { ...phase, activeMinutes: phase.activeMinutes - firstMinutes },
      ...phases.slice(splitIndex + 1),
    ];
  }

  while (phases.length < 3) {
    const splitIndex = phases.findIndex((phase) => phase.activeMinutes >= 2);
    if (splitIndex < 0) return null;
    const phase = phases[splitIndex]!;
    const firstMinutes = Math.floor(phase.activeMinutes / 2);
    phases = [
      ...phases.slice(0, splitIndex),
      { ...phase, activeMinutes: firstMinutes },
      { ...phase, activeMinutes: phase.activeMinutes - firstMinutes },
      ...phases.slice(splitIndex + 1),
    ];
  }

  const maximumActivities = Math.min(8, input.maximumActivities);
  return phases.length + (recognitionMinutes > 0 ? 1 : 0) <= maximumActivities ? phases : null;
}

function allocatePhaseMinutes(phases: MethodPhase[], totalMinutes: number): FallbackPhase[] {
  const boundedTotal = Math.max(phases.length, totalMinutes);
  const base = Math.floor(boundedTotal / phases.length);
  let remainder = boundedTotal - (base * phases.length);
  return phases.map((methodPhase) => ({
    methodPhase,
    activeMinutes: base + (remainder-- > 0 ? 1 : 0),
  }));
}

function splitLongPhase(phase: FallbackPhase): FallbackPhase[] {
  const count = Math.ceil(phase.activeMinutes / 20);
  if (count === 1) return [phase];
  const base = Math.floor(phase.activeMinutes / count);
  let remainder = phase.activeMinutes - (base * count);
  return Array.from({ length: count }, () => ({
    methodPhase: phase.methodPhase,
    activeMinutes: base + (remainder-- > 0 ? 1 : 0),
  }));
}

function filledActivity({
  phase,
  index,
  assigned,
  input,
}: {
  phase: FallbackPhase;
  index: number;
  assigned: SourceAssignment;
  input: SourceGroundedDegradedSessionInput;
}) {
  if (questionPhase(phase.methodPhase)) {
    return questionActivity({ phase, assigned, streamed: false });
  }
  if (
    phase.methodPhase === "reflect"
    || phase.methodPhase === "review"
    || phase.methodPhase === "schedule_return"
  ) {
    return reflectionActivity(phase, input.objective, false);
  }
  return {
    topicId: null,
    methodPhase: phase.methodPhase,
    estimatedMinutes: phase.activeMinutes,
    requiredForCompletion: true,
    label: phaseLabel(phase.methodPhase),
    title: instructionTitle(phase.methodPhase, index),
    body: instructionBody(phase.methodPhase, assigned.idea),
    teaching: revealsSourceModel(phase.methodPhase)
      ? sourceTeachingBlock(assigned.source.text)
      : null,
    type: "instruction" as const,
    concept: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
    practiceIntent: null,
    misconceptionSummary: null,
    methodRuntime: null,
  };
}

function streamedActivity({
  phase,
  index,
  assigned,
  input,
  trustedMaterials,
  ideaAssignments,
}: {
  phase: FallbackPhase;
  index: number;
  assigned: SourceAssignment;
  input: SourceGroundedDegradedSessionInput;
  trustedMaterials: MaterialExcerpt[];
  ideaAssignments: SourceAssignment[];
}) {
  if (questionPhase(phase.methodPhase)) {
    return questionActivity({ phase, assigned, streamed: true });
  }
  if (
    phase.methodPhase === "reflect"
    || phase.methodPhase === "review"
    || phase.methodPhase === "schedule_return"
  ) {
    return reflectionActivity(phase, input.objective, true);
  }
  const lessonSources = uniqueBy(
    ideaAssignments.map((assignment) => (
      trustedMaterials.find((material) => material.chunkId === assignment.source.chunkId)
        ?? assignment.source
    )),
    (material) => material.chunkId!,
  );
  return {
    topicId: assigned.topic.id,
    methodPhase: phase.methodPhase,
    estimatedMinutes: phase.activeMinutes,
    requiredForCompletion: true,
    label: phaseLabel(phase.methodPhase),
    title: instructionTitle(phase.methodPhase, index),
    body: instructionBody(phase.methodPhase, assigned.idea),
    teaching: null,
    lessonBrief: revealsSourceModel(phase.methodPhase)
      ? {
        version: 1 as const,
        topicIds: [...new Set(ideaAssignments.map((assignment) => assignment.topic.id))],
        essentialIdeas: ideaAssignments.map((assignment) => assignment.idea),
        sourceChunks: lessonSources.map((source) => ({
          chunkId: source.chunkId!,
          materialId: source.materialId ?? null,
          sourceName: source.name,
          locationLabel: source.locationLabel ?? "Uploaded material",
          role: "content_source" as const,
          text: source.text.slice(0, 6_000),
        })),
        knowledgeSource: "material_content" as const,
        evidenceContext: {
          confirmedGaps: [],
          secureKnowledge: [],
          priorMisconceptions: [],
        },
        contentRequirements: {
          teachEveryEssentialIdea: true as const,
          includeConcreteExample: false,
          includeCommonMixup: true as const,
          preservePrerequisiteOrder: true as const,
        },
      }
      : null,
    type: "instruction" as const,
    concept: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
    practiceIntent: null,
    misconceptionSummary: null,
  };
}

type SourceAssignment = {
  idea: string;
  topic: KnowledgeMapTopic;
  source: MaterialExcerpt;
  target: string | null;
  concept: string;
  questionIndex: number;
};

function requiresSourceGroundedLearnRecognition(
  input: SourceGroundedDegradedSessionInput,
) {
  return input.learningMode === "learn"
    && input.taskType !== "writing_argumentation"
    && input.executionEnvironment === "inside_yova";
}

function sourceGroundedRecognitionActivity({
  assigned,
  deferredTargets,
  streamed,
}: {
  assigned: SourceAssignment;
  deferredTargets: string[];
  streamed: boolean;
}) {
  const check = sourceGroundedRecognitionCheck(
    assigned.source.text,
    deferredTargets,
  );
  if (!check) return null;
  return {
    topicId: assigned.topic.id,
    methodPhase: "transfer" as const,
    estimatedMinutes: 2,
    requiredForCompletion: true,
    label: "Recall",
    title: "Check the source",
    body: check.prompt,
    teaching: null,
    ...(streamed ? { lessonBrief: null } : {}),
    type: "multiple_choice" as const,
    concept: assigned.concept,
    choices: check.choices,
    correctAnswer: check.correctAnswer,
    feedback: check.feedback,
    practiceIntent: null,
    misconceptionSummary: null,
    ...(streamed ? {} : { methodRuntime: null }),
  };
}

/**
 * Builds recognition without inventing a neighboring claim. The prompt is an
 * exact-source cloze, and every answer choice is an exact contiguous phrase
 * from the same active mapped chunk. If the chunk cannot safely supply four
 * distinct choices, deterministic degradation remains unavailable.
 */
function sourceGroundedRecognitionCheck(
  sourceText: string,
  deferredTargets: string[],
) {
  const normalizedSource = sourceText.trim().replace(/\s+/gu, " ");
  const sourceSentence = sourceSentences(normalizedSource)[0] ?? normalizedSource;
  const sourceTokens = normalizedSource.split(" ");
  const sentenceTokens = sourceSentence.split(" ");
  if (sentenceTokens.length < 4 || sourceTokens.length < 4) return null;

  for (const phraseLength of [3, 2, 1]) {
    const sourcePhrases = sourcePhraseWindows(sourceTokens, phraseLength);
    const sentencePhrases = sourcePhraseWindows(sentenceTokens, phraseLength);
    if (sourcePhrases.length < 4 || sentencePhrases.length === 0) continue;

    const correct = [...sentencePhrases].sort((left, right) => (
      recognitionPhraseScore(right) - recognitionPhraseScore(left)
      || left.index - right.index
    ))[0]!;
    const correctTokens = new Set(correct.tokens.map(normalizeRecognitionText));
    const alternatives = sourcePhrases.filter((candidate) => (
      normalizeRecognitionText(candidate.text) !== normalizeRecognitionText(correct.text)
    ));
    const preferredAlternatives = alternatives.filter((candidate) => (
      candidate.tokens.filter((token) => (
        correctTokens.has(normalizeRecognitionText(token))
      )).length <= Math.floor(phraseLength / 2)
    ));
    const distractors = uniqueSourcePhrases([
      ...preferredAlternatives,
      ...alternatives,
    ]).slice(0, 3);
    if (distractors.length < 3) continue;

    const windowStart = Math.max(0, correct.index - 3);
    const windowEnd = Math.min(
      sentenceTokens.length,
      correct.index + phraseLength + 3,
    );
    const before = sentenceTokens.slice(windowStart, correct.index).join(" ");
    const after = sentenceTokens.slice(correct.index + phraseLength, windowEnd).join(" ");
    const excerpt = [
      windowStart > 0 ? "…" : "",
      before,
      "_____",
      after,
      windowEnd < sentenceTokens.length ? "…" : "",
    ].filter(Boolean).join(" ");
    const prompt = boundedText(
      `Complete this mapped-source statement: “${excerpt}”`,
      280,
    );
    const feedback = boundedText(
      `The exact mapped-source phrase is “${correct.text}.”`,
      500,
    );
    const choices = distractors.map((candidate) => candidate.text);
    choices.splice(stableCorrectChoiceIndex(correct.text), 0, correct.text);
    const learnerSurface = [prompt, ...choices, feedback].join(" ");
    if (containsExactDeferredLabel(learnerSurface, deferredTargets)) continue;
    if (!choices.every((choice) => normalizedSource.includes(choice))) continue;

    return {
      prompt,
      choices,
      correctAnswer: correct.text,
      feedback,
    };
  }

  return null;
}

type SourcePhrase = {
  text: string;
  index: number;
  tokens: string[];
};

function sourcePhraseWindows(
  sourceTokens: string[],
  phraseLength: number,
): SourcePhrase[] {
  const seen = new Set<string>();
  return sourceTokens.flatMap((_, index) => {
    const tokens = sourceTokens.slice(index, index + phraseLength);
    if (tokens.length !== phraseLength) return [];
    const text = tokens.join(" ");
    const key = normalizeRecognitionText(text);
    if (!key || seen.has(key) || text.length > 220) return [];
    seen.add(key);
    return [{
      text,
      index,
      tokens,
    }];
  });
}

function recognitionPhraseScore(phrase: SourcePhrase) {
  const numberWords = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  ]);
  return phrase.tokens.reduce((score, token, index) => {
    const normalized = normalizeRecognitionText(token);
    const numeric = /^\d+$/u.test(normalized) || numberWords.has(normalized);
    return score
      + (numeric ? index === 0 ? 12 : 8 : 0)
      + (normalized.length >= 6 ? 2 : normalized.length >= 4 ? 1 : 0);
  }, 0);
}

function uniqueSourcePhrases(phrases: SourcePhrase[]) {
  const seen = new Set<string>();
  return phrases.filter((phrase) => {
    const key = normalizeRecognitionText(phrase.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableCorrectChoiceIndex(value: string) {
  return [...value].reduce((hash, character) => hash + character.codePointAt(0)!, 0) % 4;
}

function containsExactDeferredLabel(surface: string, deferredTargets: string[]) {
  const normalizedSurface = ` ${normalizeRecognitionText(surface)} `;
  return deferredTargets.some((target) => {
    const normalizedTarget = normalizeRecognitionText(target);
    return normalizedTarget.length > 0
      && normalizedSurface.includes(` ${normalizedTarget} `);
  });
}

function normalizeRecognitionText(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function insertBeforeDelayedReturn<
  Activity extends { methodPhase: MethodPhase },
  Recognition extends { methodPhase: MethodPhase },
>(
  activities: Activity[],
  recognition: Recognition,
): Array<Activity | Recognition> {
  const returnIndex = activities.findIndex((activity) => (
    activity.methodPhase === "schedule_return"
  ));
  return returnIndex < 0
    ? [...activities, recognition]
    : [
      ...activities.slice(0, returnIndex),
      recognition,
      ...activities.slice(returnIndex),
    ];
}

function questionActivity({
  phase,
  assigned,
  streamed,
}: {
  phase: FallbackPhase;
  assigned: SourceAssignment;
  streamed: boolean;
}) {
  const body = boundedText(
    phase.methodPhase === "repair"
      ? `Repair with this exact mapped-source claim: ${assigned.idea} State the correction in your own words.`
      : `With the source closed, explain this mapped claim: ${assigned.idea} After the attempt, compare with the verified answer.`,
    320,
  );
  return {
    topicId: assigned.topic.id,
    methodPhase: phase.methodPhase,
    estimatedMinutes: phase.activeMinutes,
    requiredForCompletion: true,
    label: phaseLabel(phase.methodPhase),
    title: boundedText(`${phaseLabel(phase.methodPhase)}: ${assigned.concept}`, 140),
    body,
    teaching: null,
    ...(streamed ? { lessonBrief: null } : {}),
    type: "free_response" as const,
    concept: assigned.concept,
    choices: [],
    correctAnswer: boundedText(sourceAnswer(assigned.source.text), 600),
    feedback: "Compare your response with the exact mapped-source answer, then repair only what the verified text supports.",
    practiceIntent: null,
    misconceptionSummary: null,
    ...(streamed ? {} : { methodRuntime: null }),
  };
}

function reflectionActivity(
  phase: FallbackPhase,
  objective: string,
  streamed: boolean,
) {
  return {
    topicId: null,
    methodPhase: phase.methodPhase,
    estimatedMinutes: phase.activeMinutes,
    requiredForCompletion: phase.methodPhase !== "schedule_return",
    label: phaseLabel(phase.methodPhase),
    title: phase.methodPhase === "schedule_return"
      ? "Plan the source-grounded return"
      : phase.methodPhase === "review"
        ? "Review against the verified source"
        : "Name the remaining gap",
    body: boundedText(
      phase.methodPhase === "schedule_return"
        ? `Return to ${objective} after a delay and retrieve the central relationship before reopening the mapped source.`
        : phase.methodPhase === "review"
          ? `Reopen the mapped source for ${objective}, compare it with the closed-source attempt, and name the exact repair the verified text supports.`
        : `State which part of ${objective} is now supported by the source and which exact relationship still needs another pass.`,
      320,
    ),
    teaching: null,
    ...(streamed ? { lessonBrief: null } : {}),
    type: "reflection" as const,
    concept: null,
    choices: [],
    correctAnswer: null,
    feedback: null,
    practiceIntent: null,
    misconceptionSummary: null,
    ...(streamed ? {} : { methodRuntime: null }),
  };
}

function sourceTeachingBlock(text: string) {
  const keyIdea = sourceClaim(text);
  const explanation = sourceAnswer(text);
  return {
    keyIdea: boundedText(keyIdea, 220),
    explanation: boundedText(explanation, 700),
    example: null,
    commonMistake: null,
  };
}

function sourceClaim(text: string) {
  const sentences = sourceSentences(text);
  return boundedText(sentences[0] ?? text.trim(), 180);
}

function sourceAnswer(text: string) {
  const sentences = sourceSentences(text);
  return boundedText(sentences.slice(0, 3).join(" ") || text.trim(), 600);
}

function sourceSentences(text: string) {
  return text.trim().replace(/\s+/gu, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

function sourceGroundedFallbackRouteIssue(
  draft: GeneratedSessionDraft,
  route: StudyRoute | null | undefined,
) {
  if (!route) return null;
  const expectedPhases = route.execution.orderedPhases.map((phase) => phase.methodPhase);
  const actualPhases = draft.activities.map((activity) => activity.methodPhase);
  let matched = 0;
  for (const phase of actualPhases) {
    if (phase === expectedPhases[matched]) matched += 1;
  }
  if (matched !== expectedPhases.length) return "phase_order";
  if (draft.methodBriefing.methodId !== route.approach.primaryMethodId) return "method";
  if (draft.methodBriefing.name !== route.approach.visibleMethodName) return "method_name";
  return null;
}

function questionPhase(phase: MethodPhase) {
  return [
    "question",
    "pretest",
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
  ].includes(phase);
}

function revealsSourceModel(phase: MethodPhase) {
  return ["model", "read_source"].includes(phase);
}

function phaseLabel(phase: MethodPhase) {
  return phase.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase()).slice(0, 50);
}

function instructionTitle(phase: MethodPhase, index: number) {
  if (phase === "model") return "Build the verified source model";
  if (phase === "read_source") return "Read the mapped explanatory section";
  if (phase === "repair") return "Repair against the verified source";
  if (phase === "survey") return "Survey the bounded source";
  if (phase === "orient") return "Orient to the bounded target";
  return `Source-grounded ${phaseLabel(phase).toLocaleLowerCase()} ${index + 1}`.slice(0, 140);
}

function instructionBody(phase: MethodPhase, idea: string) {
  if (phase === "model") {
    return boundedText(`Study the verified source explanation for ${idea}. Use only this model in the closed-source checks that follow.`, 320);
  }
  if (phase === "read_source") {
    return boundedText(`Read the mapped explanatory section for ${idea}. Mark the relationship, sequence, or procedure that directly supports the target.`, 320);
  }
  if (phase === "repair") {
    return boundedText(`Compare the earlier attempt with the verified source explanation for ${idea}, replace the exposed gap, and keep unsupported detail out.`, 320);
  }
  if (phase === "survey") {
    return boundedText(`Survey the mapped source section for ${idea}. Identify its visible structure and decide where the target explanation begins and ends before close reading.`, 320);
  }
  if (phase === "orient") {
    return boundedText(`Keep this source-grounded attempt bounded to ${idea}. Completion means producing the requested evidence without adding claims beyond the mapped section.`, 320);
  }
  return boundedText(`Use the mapped explanatory source to orient this phase around ${idea}.`, 320);
}

function normalizedPersonalization(reasons: string[]) {
  const valid = uniqueText(reasons).filter((reason) => reason.length >= 20).slice(0, 3);
  return valid.length > 0
    ? valid
    : ["YOVA kept the committed route and reduced the lesson to a source-grounded sequence after generation failed its checks."];
}

function boundedLabel(value: string, maximum: number) {
  return boundedText(value.trim() || "Mapped source target", maximum);
}

function boundedText(value: string, maximum: number) {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maximum) return normalized;
  const slice = normalized.slice(0, maximum - 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maximum * 0.6 ? boundary : slice.length).trimEnd()}…`;
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueBy<Value>(values: Value[], key: (value: Value) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const candidate = key(value);
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

import { describe, expect, it, vi } from "vitest";
import { APIConnectionTimeoutError } from "openai";
import { z } from "zod";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "22222222-2222-4222-8222-222222222222";
const CHUNK_ID = "33333333-3333-4333-8333-333333333333";
const AI_TOPIC_ID = "44444444-4444-4444-8444-444444444444";
const RETRIEVAL_TOPIC_IDS = [
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
] as const;

function completedProviderResponse(id: string, output_parsed: unknown) {
  return {
    id,
    model: "gpt-yova-test",
    status: "completed",
    output_parsed,
    usage: {
      input_tokens: 600,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 300,
    },
  };
}

function spanishRestaurantContext(estimatedMinutes = 20): SessionGenerationContext {
  const target = "Spanish food and restaurant vocabulary";
  return {
    sessionArchitectureVersion: "streamed_teaching_v1",
    learningGoal: {
      title: "Spanish food and restaurant vocabulary",
      topic: "Explain how Spanish food names and restaurant request phrases work together in a complete exchange",
      kind: "skill",
      deadline: null,
      sourceMode: "yova_generated",
      studyMode: "inside_yova",
      learningIntent: "learn",
    },
    planRationale: "Build an accurate language model, use it in one concrete exchange, and explain the pattern with less support.",
    journey: {
      currentSequence: 1,
      totalSessions: 3,
      previousSessions: [],
      nextSessions: [],
    },
    materials: [],
    knowledgeTopics: [{
      id: TOPIC_ID,
      title: target,
      description: "High-frequency Spanish food nouns and polite restaurant request phrases used in a short exchange.",
      subtopics: ["foods and drinks", "polite requests", "short restaurant exchange"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    session: {
      title: "Order food in a short Spanish exchange",
      objective: "Explain how Spanish food words combine with a polite restaurant request, then use the pattern in a short exchange.",
      method: "Self-explanation",
      methodReason: "Study one accurate exchange, then explain and use its language pattern without the model visible.",
      estimatedMinutes,
      learningMode: "learn",
      topicIds: [TOPIC_ID],
      contentTargets: [target],
      completionEvidence: ["Explain and use the restaurant request pattern without reopening the model"],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: null,
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

const SPANISH_IDEAS = [
  "Spanish food vocabulary uses nouns such as agua and sopa to name what a diner may order.",
  "Spanish restaurant vocabulary combines quisiera with a food or drink to form a polite request.",
] as const;

function spanishRecoveryItems(itemCount: 1 | 2 = 2) {
  return {
    items: SPANISH_IDEAS.slice(0, itemCount).map((essentialIdea, index) => ({
      essentialIdea,
      concept: index === 0 ? "Spanish food nouns" : "Spanish polite restaurant requests",
      check: index === 0 ? {
        title: "Explain the food words",
        prompt: "Explain how agua and sopa function in a Spanish restaurant order, and give one short example.",
        referenceAnswer: "Agua and sopa are food or drink nouns that name the item being requested, as in Quisiera agua, por favor.",
        feedback: "The answer should connect the Spanish noun to the item requested in a complete restaurant phrase.",
      } : {
        title: "Build a polite restaurant request",
        prompt: "Explain how quisiera combines with a Spanish food or drink noun, then write one complete request.",
        referenceAnswer: "Quisiera introduces a polite request and is followed by the desired item, as in Quisiera una sopa, por favor.",
        feedback: "Use quisiera plus the requested food or drink and complete the phrase with context-appropriate wording.",
      },
      independentCheck: null,
    })),
  };
}

const THREE_TARGET_SPANISH_TARGETS = [
  "High-frequency foods and drinks",
  "Restaurant people, objects, and menu terms",
  "English to Spanish and Spanish to English recall",
] as const;

const THREE_TARGET_SPANISH_IDEAS = [
  "High-frequency Spanish foods and drinks include words such as agua, pan, and sopa for common items.",
  "Restaurant people, objects, and menu terms include camarero, mesa, tenedor, menú, and cuenta.",
] as const;

function threeTargetSpanishContext(): SessionGenerationContext {
  const context = spanishRestaurantContext(45);
  const topicIds = [TOPIC_ID, AI_TOPIC_ID, RETRIEVAL_TOPIC_IDS[0]];
  return {
    ...context,
    learningGoal: {
      ...context.learningGoal,
      title: "Spanish food and restaurant vocabulary",
      topic: "Explain how Spanish food names and restaurant terms work together in common dining contexts",
    },
    knowledgeTopics: [{
      ...context.knowledgeTopics[0]!,
      id: topicIds[0],
      title: "Core food vocabulary",
      description: "High-frequency Spanish words for common foods and drinks, especially items likely to appear on a basic quiz.",
      subtopics: ["fruits and vegetables", "meats and proteins", "grains and staples", "drinks", "snacks and desserts"],
    }, {
      ...context.knowledgeTopics[0]!,
      id: topicIds[1],
      title: "Restaurant vocabulary",
      description: "Words for places, people, and objects you would see in a restaurant or on a menu.",
      subtopics: ["restaurant and cafe", "menu and bill", "waiter and waitress", "tableware and utensils", "kitchen and dining terms"],
    }, {
      ...context.knowledgeTopics[0]!,
      id: topicIds[2],
      title: "Quiz-ready recognition and recall",
      description: "Practice identifying, matching, and producing the target words quickly from English or Spanish prompts.",
      subtopics: ["Spanish to English", "English to Spanish", "multiple-choice traps", "spelling", "quick self-test"],
    }],
    session: {
      ...context.session,
      title: "Learn Spanish food and restaurant vocabulary",
      objective: "Build an accurate first mental model of Spanish food and restaurant vocabulary, use concrete examples, and explain the central relationships.",
      estimatedMinutes: 45,
      topicIds,
      contentTargets: [...THREE_TARGET_SPANISH_TARGETS],
      completionEvidence: THREE_TARGET_SPANISH_TARGETS.map((target) => `Explain ${target} without reopening the model`),
    },
    personalization: {
      decisions: [{
        id: "decision:method_delivery:block_length:shorter_rounds",
        artifact: "method_delivery",
        setting: "block_length",
        value: "shorter_rounds",
        title: "Shorter focused rounds",
        explanation: "Use shorter focused rounds while preserving the exact learning target.",
        signalIds: ["signal:shorter_rounds"],
        evidenceLabel: "You told YOVA",
        methodCandidates: [],
        experimental: false,
      }],
      methodTie: {
        state: {
          controls: { experiments: false },
          activeExperiment: null,
          experimentHistory: [],
        },
        signals: [],
      },
    },
  };
}

function threeTargetSpanishRecoveryItems() {
  return {
    items: THREE_TARGET_SPANISH_IDEAS.map((essentialIdea, index) => ({
      essentialIdea,
      concept: index === 0
        ? "Spanish food and drink vocabulary"
        : "Spanish restaurant people and menu terms",
      check: index === 0 ? {
        title: "Explain the Spanish food words",
        prompt: "Explain what agua, pan, and sopa name and how they fit the high-frequency Spanish food and drink category.",
        referenceAnswer: "Agua names water, pan names bread, and sopa names soup, so each word names a common food or drink item.",
        feedback: "Connect every Spanish word to its concrete food or drink meaning and keep the category distinction clear.",
      } : {
        title: "Explain the restaurant terms",
        prompt: "Explain how camarero, mesa, tenedor, menú, and cuenta represent people, objects, and menu terms in a restaurant.",
        referenceAnswer: "Camarero names a waiter, mesa a table, tenedor a fork, menú the menu, and cuenta the bill in a restaurant.",
        feedback: "Separate the person from the dining objects and the two menu-related terms while preserving each meaning.",
      },
      independentCheck: null,
    })),
  };
}

function workedExampleContext(): SessionGenerationContext {
  const target = "Use the product rule to differentiate a product of two functions";
  const context = spanishRestaurantContext(15);
  return {
    ...context,
    learningGoal: {
      ...context.learningGoal,
      title: "Solve calculus derivative problems",
      topic: "Differentiate products of functions with the product rule",
    },
    knowledgeTopics: [{
      ...context.knowledgeTopics[0]!,
      title: target,
      description: "How the derivative of a product combines each factor with the derivative of the other factor.",
      subtopics: ["identify both factors", "differentiate each factor", "combine product-rule terms"],
    }],
    session: {
      ...context.session,
      title: "Solve one product-rule derivative",
      objective: "Solve a calculus derivative problem by applying the product rule and simplifying the result.",
      method: "Worked example fading",
      methodReason: "Study one complete derivative, then apply the same rule with the worked steps faded.",
      contentTargets: [target],
      completionEvidence: ["Differentiate a new product of functions without reopening the worked solution"],
    },
  };
}

function duplicateWorkedExampleRecovery() {
  const prompt = "Differentiate h(x) = x squared times sine of x, and show how the product rule determines both terms.";
  const check = {
    title: "Apply the product rule",
    prompt,
    referenceAnswer: "The derivative is 2x sine of x plus x squared cosine of x because each factor is differentiated once.",
    feedback: "Keep the untouched partner beside each derivative, then add the two resulting product terms.",
  };
  return {
    items: [{
      essentialIdea: "The product rule differentiates each factor once while preserving the other factor, then adds the two terms.",
      concept: "Product-rule differentiation",
      check,
      independentCheck: { ...check, title: "Independent product-rule application" },
    }],
  };
}

function retrievalRecoveryItems(targets: string[]) {
  const terms = ["agua", "sopa", "cuenta", "quisiera"];
  const definitions = ["water", "soup", "bill", "I would like"];
  return {
    items: targets.map((target, index) => ({
      essentialIdea: `${target} and is used as a bounded restaurant-vocabulary recall item.`,
      concept: `Meaning of ${terms[index] ?? `restaurant term ${index + 1}`}`,
      check: {
        title: `Recall restaurant term ${index + 1}`,
        prompt: `Without notes, state the English meaning of the Spanish restaurant term ${terms[index] ?? `item ${index + 1}`}.`,
        referenceAnswer: `The Spanish restaurant term ${terms[index] ?? `item ${index + 1}`} means ${definitions[index] ?? "the supplied definition"} in English.`,
        feedback: "Compare the recalled Spanish term and English meaning, then correct only the missing half of the pair.",
      },
      independentCheck: null,
    })),
  };
}

function fourSlotRetrievalContext(): SessionGenerationContext {
  const targets = [
    "Spanish restaurant term agua means water",
    "Spanish restaurant term sopa means soup",
    "Spanish restaurant term cuenta means bill",
    "Spanish restaurant phrase quisiera means I would like",
  ];
  const context = spanishRestaurantContext(60);
  return {
    ...context,
    learningGoal: {
      ...context.learningGoal,
      title: "Memorize Spanish restaurant vocabulary",
      topic: "Memorize Spanish restaurant terms and definitions for closed-note recall",
    },
    knowledgeTopics: targets.map((target, index) => ({
      ...context.knowledgeTopics[0]!,
      id: RETRIEVAL_TOPIC_IDS[index]!,
      title: target,
      description: `The exact meaning and use of ${target}.`,
      subtopics: [target],
    })),
    session: {
      ...context.session,
      title: "Recall four Spanish restaurant terms",
      objective: "Memorize and recall four Spanish restaurant vocabulary terms and definitions without notes.",
      method: "Retrieval practice",
      methodReason: "Use closed-note retrieval for each vocabulary term, then repair only missed definitions.",
      estimatedMinutes: 60,
      topicIds: [...RETRIEVAL_TOPIC_IDS],
      contentTargets: targets,
      completionEvidence: targets.map((target) => `Recall ${target} without notes`),
    },
  };
}

function twoSlotRetrievalContext(): SessionGenerationContext {
  const context = fourSlotRetrievalContext();
  return {
    ...context,
    knowledgeTopics: context.knowledgeTopics.slice(0, 2),
    session: {
      ...context.session,
      title: "Recall two Spanish restaurant terms",
      objective: "Memorize and recall two Spanish restaurant vocabulary terms and definitions without notes.",
      estimatedMinutes: 15,
      topicIds: context.session.topicIds.slice(0, 2),
      contentTargets: context.session.contentTargets?.slice(0, 2),
      completionEvidence: context.session.completionEvidence?.slice(0, 2),
    },
  };
}

function ambiguousLegacyMultiTopicContext(): SessionGenerationContext {
  const targets = [
    "Explain the first core relationship",
    "Explain the second core relationship",
    "Explain the third core relationship",
  ];
  const context = spanishRestaurantContext(25);
  return {
    ...context,
    learningGoal: {
      ...context.learningGoal,
      title: "Understand three related course ideas",
      topic: "Explain how three related course ideas work",
    },
    knowledgeTopics: targets.map((_, index) => ({
      ...context.knowledgeTopics[0]!,
      id: RETRIEVAL_TOPIC_IDS[index]!,
      title: `General course idea ${index + 1}`,
      description: "A broad course relationship used for explanation and practice.",
      subtopics: ["core relationship", "related idea"],
    })),
    session: {
      ...context.session,
      title: "Explain three related ideas",
      objective: "Explain three related course relationships and how each one works.",
      method: "Self-explanation",
      methodReason: "Study each accurate relationship, then explain it without reopening the model.",
      estimatedMinutes: 25,
      topicIds: [...RETRIEVAL_TOPIC_IDS.slice(0, 3)],
      contentTargets: targets,
      completionEvidence: targets.map((target) => `${target} without reopening the model`),
    },
  };
}

function spanishSkeletonWithWrongPracticeMetadata() {
  const lessonBrief = (essentialIdea: string) => ({
    version: 1 as const,
    topicIds: [TOPIC_ID],
    essentialIdeas: [essentialIdea],
    sourceChunks: [],
    knowledgeSource: "model_knowledge" as const,
    evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
    contentRequirements: {
      teachEveryEssentialIdea: true as const,
      includeConcreteExample: true,
      includeCommonMixup: true as const,
      preservePrerequisiteOrder: true as const,
    },
  });
  const items = spanishRecoveryItems(2).items;
  return {
    topicIds: [TOPIC_ID],
    rationale: "Teach two bounded restaurant-language relationships and require a typed explanation after each model.",
    coverage: {
      focus: "Combine Spanish food nouns with polite restaurant request phrases.",
      essentialIdeas: [...SPANISH_IDEAS],
      completionEvidence: ["Explain and use both language relationships without reopening the model"],
      evidenceMap: items.map((item) => ({
        essentialIdea: item.essentialIdea,
        activityConcept: item.concept,
      })),
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "self_explanation",
      name: "Self-explanation",
      what: "Study each accurate language relationship, then explain and apply it from memory.",
      why: "Explaining the pattern shows whether the words and request structure form one usable model.",
      how: ["Study one short model.", "Close it and explain the relationship in your own words."],
      completion: "Explain and use both Spanish restaurant-language relationships without the model visible.",
      personalization: ["The lesson uses short focused explanations before each typed language check."],
    },
    sourceGrounding: null,
    activities: items.flatMap((item, index) => [{
      topicId: TOPIC_ID,
      methodPhase: "model" as const,
      estimatedMinutes: 5,
      requiredForCompletion: true,
      label: "Learn",
      title: `Learn ${item.concept}`,
      body: "Read this focused explanation, then answer the typed question before continuing.",
      teaching: null,
      lessonBrief: lessonBrief(item.essentialIdea),
      practiceIntent: null,
      misconceptionSummary: null,
      type: "instruction" as const,
      concept: null,
      choices: [],
      correctAnswer: null,
      feedback: null,
    }, {
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 5,
      requiredForCompletion: true,
      label: "Explain",
      title: item.check.title,
      body: item.check.prompt,
      teaching: null,
      lessonBrief: null,
      practiceIntent: index === 0 ? "develop_gap" as const : "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept: item.concept,
      choices: [],
      correctAnswer: item.check.referenceAnswer,
      feedback: item.check.feedback,
    }]),
    targetAssignments: SPANISH_IDEAS.map((essentialIdea) => ({
      essentialIdea,
      targetId: "target_1" as const,
    })),
  };
}

function contextWithMaterials(
  materials: SessionGenerationContext["materials"],
): SessionGenerationContext {
  return {
    sessionArchitectureVersion: "streamed_teaching_v1",
    learningGoal: {
      title: "World War I Test Prep",
      topic: "World War I",
      kind: "test",
      deadline: null,
      sourceMode: "user_materials",
      studyMode: "inside_yova",
      learningIntent: "learn",
    },
    planRationale: "Teach the mapped causes before asking for evidence.",
    journey: {
      currentSequence: 1,
      totalSessions: 1,
      previousSessions: [],
      nextSessions: [],
    },
    materials,
    knowledgeTopics: [{
      id: TOPIC_ID,
      title: "Causes of World War I",
      description: "How long-term tensions and alliance commitments widened the conflict.",
      subtopics: ["Militarism", "Alliance systems", "The July Crisis"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "material",
      deferred: null,
    }],
    session: {
      title: "Connect the causes of World War I",
      objective: "Explain how alliances widened a local crisis.",
      method: "Self-explanation",
      methodReason: "Build the causal model before checking it.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TOPIC_ID],
      contentTargets: ["Alliances widened a local crisis"],
      completionEvidence: ["Explain the relationship without notes"],
      reviewConcept: null,
      reviewType: null,
    },
    learnerProfile: null,
    sessionAdjustment: null,
    recentResults: [],
    recentInterruptions: [],
    conceptSignals: [],
    scaffoldSignals: [],
    topicCalibrationSignals: [],
  };
}

function mixedStreamedContext(): SessionGenerationContext {
  const materialTarget = "Alliances widened a local crisis";
  const aiTarget = "Mobilization timing restricted diplomacy";
  const context = contextWithMaterials([{
    materialId: MATERIAL_ID,
    chunkId: CHUNK_ID,
    chunkIndex: 0,
    name: "World War I alliances.pdf",
    text: "Alliance obligations connected the local July Crisis to mobilization by additional European powers.",
    truncated: false,
    locationLabel: "Page 2, Alliances",
    role: "content_source",
  }]);
  context.knowledgeTopics = [{
    ...context.knowledgeTopics[0]!,
    title: materialTarget,
    description: "How alliance obligations widened the July Crisis.",
    sourceReferences: [{
      materialId: MATERIAL_ID,
      chunkId: CHUNK_ID,
      chunkIndex: 0,
      startCharacter: 0,
      endCharacter: 98,
      locationLabel: "Page 2, Alliances",
      sectionRole: "content_source",
    }],
    origin: "material",
  }, {
    ...context.knowledgeTopics[0]!,
    id: AI_TOPIC_ID,
    title: aiTarget,
    description: "How mobilization timing narrowed diplomatic choices during the July Crisis.",
    sourceReferences: [],
    origin: "ai_generated",
  }];
  context.session = {
    ...context.session,
    topicIds: [TOPIC_ID, AI_TOPIC_ID],
    contentTargets: [materialTarget, aiTarget],
    completionEvidence: [
      `Explain ${materialTarget} without notes.`,
      `Explain ${aiTarget} without notes.`,
    ],
  };
  return context;
}

describe("bounded streamed-skeleton repair policy", () => {
  it("repairs both wrong Spanish practice-intent labels in one provider call", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse.mockResolvedValueOnce(completedProviderResponse(
      "spanish-wrong-practice-metadata",
      spanishSkeletonWithWrongPracticeMetadata(),
    ));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(spanishRestaurantContext());

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.draft.methodBriefing).toMatchObject({
      taskType: "conceptual_learning",
      methodId: "self_explanation",
    });
    expect(result.draft.activities.filter((activity) => (
      activity.type === "multiple_choice" || activity.type === "free_response"
    )).map((activity) => activity.practiceIntent)).toEqual(["baseline", "baseline"]);
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: false,
      failedValidator: "session_practice_variation",
      repairAttempted: true,
      repairSucceeded: true,
      validationIssueCode: "session_practice_metadata",
    });
  });

  it("recovers a broader semantic failure with a server-owned compact V17 sequence", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-spanish-skeleton", {}))
      .mockResolvedValueOnce(completedProviderResponse("compact-spanish-recovery", spanishRecoveryItems(2)));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(spanishRestaurantContext());

    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_streamed_teaching_skeleton",
      "yova_streamed_teaching_recovery",
    ]);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      repairAttempted: true,
      repairSucceeded: true,
      recoveryMode: "safe_learn",
    });
    expect(result.deliveryInstructions).toBeDefined();
    expect(result.draft.activities.filter((activity) => (
      "lessonBrief" in activity && activity.lessonBrief
    ))).toHaveLength(2);
    expect(result.draft.activities.filter((activity) => activity.type === "free_response")).toHaveLength(2);
    expect(result.draft.coverage.essentialIdeas).toEqual([...SPANISH_IDEAS]);
    expect(result.draft.coverage.evidenceMap.map((entry) => entry.activityConcept)).toEqual([
      "Spanish food nouns",
      "Spanish polite restaurant requests",
    ]);
    const recoveryInput = parseResponse.mock.calls[1]?.[0]?.input as string;
    const recoveryPrompt = JSON.parse(recoveryInput.slice(recoveryInput.indexOf("\n") + 1));
    expect(recoveryPrompt.ideaSlots[0]).toMatchObject({
      topic: "Spanish food and restaurant vocabulary",
      topicDescription: "High-frequency Spanish food nouns and polite restaurant request phrases used in a short exchange.",
      topicSubtopics: ["foods and drinks", "polite requests", "short restaurant exchange"],
    });
  });

  it("keeps shared Spanish subject vocabulary active when a personalized compact recovery defers bilingual recall", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const context = threeTargetSpanishContext();
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-three-target-spanish-skeleton", {}))
      .mockResolvedValueOnce(completedProviderResponse(
        "compact-three-target-spanish-recovery",
        threeTargetSpanishRecoveryItems(),
      ));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(context);

    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_streamed_teaching_skeleton",
      "yova_streamed_teaching_recovery",
    ]);
    const firstInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const firstPrompt = JSON.parse(firstInput.slice(firstInput.indexOf("\n") + 1));
    expect(firstPrompt.currentSessionScope).toEqual({
      activeTargets: [...THREE_TARGET_SPANISH_TARGETS.slice(0, 2)],
      deferredTargets: [THREE_TARGET_SPANISH_TARGETS[2]],
    });
    expect(firstPrompt.session.contentTargets).toEqual([...THREE_TARGET_SPANISH_TARGETS.slice(0, 2)]);
    expect(firstPrompt.knowledgeTopics.map((topic: { title: string }) => topic.title)).toEqual([
      "Core food vocabulary",
      "Restaurant vocabulary",
    ]);
    const recoveryInput = parseResponse.mock.calls[1]?.[0]?.input as string;
    const recoveryPrompt = JSON.parse(recoveryInput.slice(recoveryInput.indexOf("\n") + 1));
    expect(recoveryPrompt.ideaSlots.map((slot: { target: string }) => slot.target)).toEqual([
      ...THREE_TARGET_SPANISH_TARGETS.slice(0, 2),
    ]);
    expect(recoveryPrompt.ideaSlots[0]).toMatchObject({
      topic: "Core food vocabulary",
      topicDescription: "High-frequency Spanish words for common foods and drinks, especially items likely to appear on a basic quiz.",
    });
    expect(recoveryPrompt.deferredTargets).toEqual([THREE_TARGET_SPANISH_TARGETS[2]]);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      repairAttempted: true,
      repairSucceeded: true,
      recoveryMode: "safe_learn",
    });
    expect(result.draft.coverage.essentialIdeas).toEqual([...THREE_TARGET_SPANISH_IDEAS]);
    expect(result.draft.coverage.deferredContent).toEqual([THREE_TARGET_SPANISH_TARGETS[2]]);
    expect(result.draft.activities.filter((activity) => (
      "lessonBrief" in activity && activity.lessonBrief
    ))).toHaveLength(2);
    expect(result.draft.activities.filter((activity) => activity.type === "free_response")).toHaveLength(2);
    const activeSurface = JSON.stringify({
      essentialIdeas: result.draft.coverage.essentialIdeas,
      evidenceMap: result.draft.coverage.evidenceMap,
      activities: result.draft.activities,
    });
    expect(activeSurface).toMatch(/Spanish/);
    expect(activeSurface).not.toMatch(/English to Spanish|Spanish to English|bilingual recall/i);
  });

  it("keeps a one-slot self-explanation recovery schema-valid with a bounded reflection", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-short-spanish-skeleton", {}))
      .mockResolvedValueOnce(completedProviderResponse("compact-short-spanish-recovery", spanishRecoveryItems(1)));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(spanishRestaurantContext(15));

    expect(result.generationStats.recoveryMode).toBe("safe_learn");
    expect(result.draft.activities.map((activity) => [activity.methodPhase, activity.type])).toEqual([
      ["model", "instruction"],
      ["explain", "free_response"],
      ["reflect", "reflection"],
    ]);
    expect(result.draft.activities.reduce((sum, activity) => (
      activity.methodPhase === "schedule_return" ? sum : sum + activity.estimatedMinutes
    ), 0)).toBe(15);
  });

  it("reserves settlement headroom for the compact recovery request", async () => {
    const startedAt = new Date("2026-08-23T09:30:00.000Z");
    const deadlineAt = startedAt.getTime() + 90_000;
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse.mockReset();
    parseResponse
      .mockImplementationOnce(async () => {
        vi.setSystemTime(startedAt.getTime() + 35_000);
        return completedProviderResponse("invalid-before-reserved-recovery", {});
      })
      .mockImplementationOnce(async (_request, options: { timeout: number; maxRetries: number }) => {
        expect(options).toMatchObject({ timeout: 22_000, maxRetries: 0 });
        expect(Date.now() + options.timeout).toBeLessThanOrEqual(deadlineAt - 12_000);
        vi.setSystemTime(startedAt.getTime() + 57_000);
        return completedProviderResponse("reserved-compact-recovery", spanishRecoveryItems(1));
      });

    try {
      const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
      const result = await generateStreamedTeachingSkeletonWithOpenAI(spanishRestaurantContext(15), {
        deadlineAt,
        settlementReserveMs: 12_000,
      });

      expect(result.generationStats.recoveryMode).toBe("safe_learn");
      expect(parseResponse).toHaveBeenCalledTimes(2);
      expect(Date.now()).toBeLessThanOrEqual(deadlineAt - 12_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds recovery rationale and focus before strict V17 parsing", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const context = spanishRestaurantContext(15);
    context.session.objective = `Explain how Spanish food words combine with a polite restaurant request. ${"Connect each restaurant noun to the polite request pattern in a complete exchange. ".repeat(12)}`;
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-long-objective-skeleton", {}))
      .mockResolvedValueOnce(completedProviderResponse("bounded-long-objective-recovery", spanishRecoveryItems(1)));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(context);

    expect(result.draft.rationale).toHaveLength(700);
    expect(result.draft.coverage.focus).toHaveLength(240);
  });

  it("rejects a worked-example recovery that repeats the guided prompt as its independent application", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-worked-skeleton", {}))
      .mockResolvedValueOnce(completedProviderResponse("duplicate-independent-recovery", duplicateWorkedExampleRecovery()));

    await expect(generateStreamedTeachingSkeletonWithOpenAI(workedExampleContext())).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        failedValidator: "session_semantic_validation",
        recoveryMode: "safe_learn",
        validationIssueCode: "session_recovery_validation",
      },
    });
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_streamed_teaching_skeleton",
      "yova_streamed_teaching_recovery",
    ]);
  });

  it("caps compact retrieval at three slots so mapped teach-check cycles plus repair stay within eight activities", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const context = fourSlotRetrievalContext();
    const targets = context.session.contentTargets!;
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-four-slot-retrieval", {}))
      .mockResolvedValueOnce(completedProviderResponse(
        "three-slot-retrieval-recovery",
        retrievalRecoveryItems(targets.slice(0, 3)),
      ));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(context);

    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_streamed_teaching_skeleton",
      "yova_streamed_teaching_recovery",
    ]);
    expect(result.draft.coverage.essentialIdeas).toHaveLength(3);
    expect(result.draft.coverage.deferredContent).toEqual([targets[3]]);
    expect(result.draft.activities).toHaveLength(7);
    expect(result.draft.activities.filter((activity) => activity.type === "free_response")).toHaveLength(3);
  });

  it("reduces a 15-minute two-target retrieval lesson before generation so every retained idea keeps its teach-check pair and repair", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const original = twoSlotRetrievalContext();
    const targets = original.session.contentTargets!;
    parseResponse.mockReset();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-two-slot-retrieval", {}))
      .mockResolvedValueOnce(completedProviderResponse(
        "reduced-two-slot-retrieval",
        retrievalRecoveryItems([targets[0]!]),
      ));

    const result = await generateStreamedTeachingSkeletonWithOpenAI(original);

    const firstInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const firstPrompt = JSON.parse(firstInput.slice(firstInput.indexOf("\n") + 1));
    expect(firstPrompt.streamedTeachingPacing.minimumActiveIdeas).toBe(1);
    expect(firstPrompt.currentSessionScope).toMatchObject({
      activeTargets: [targets[0]],
      deferredTargets: [targets[1]],
    });
    expect(result.draft.coverage.deferredContent).toEqual([targets[1]]);
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "model",
      "retrieve",
      "repair",
    ]);
    expect(result.draft.activities).toHaveLength(3);
  });

  it("preserves an ambiguous legacy multi-topic context instead of guessing which topic and evidence to drop", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const context = ambiguousLegacyMultiTopicContext();
    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(generateStreamedTeachingSkeletonWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        failedValidator: "session_provider_request",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
    const input = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(input.slice(input.indexOf("\n") + 1));
    expect(prompt.session.contentTargets).toEqual(context.session.contentTargets);
    expect(prompt.session.topicIds).toEqual(context.session.topicIds);
    expect(prompt.knowledgeTopics).toHaveLength(3);
    expect(prompt.streamedTeachingPacing.minimumActiveIdeas).toBe(3);
    expect(prompt.currentSessionScope).toMatchObject({
      activeTargets: context.session.contentTargets,
      deferredTargets: [],
    });
  });

  it("reports a raw provider rejection as a structured generation failure", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("provider unavailable"));

    const context = contextWithMaterials([]);
    context.personalization = {
      decisions: [{
        id: "decision:method_delivery:knowledge_check:closed_note_first",
        artifact: "method_delivery",
        setting: "knowledge_check",
        value: "closed_note_first",
        title: "Check before more review",
        explanation: "Ask for a closed-note answer before showing more explanation.",
        signalIds: ["signal:calibration_risk"],
        evidenceLabel: "You told YOVA",
        methodCandidates: [],
        experimental: false,
      }, {
        id: "decision:workspace:visual_structure:more",
        artifact: "workspace",
        setting: "visual_structure",
        value: "PRIVATE-CSS-ONLY",
        title: "More visual structure",
        explanation: "Use stronger interface grouping.",
        signalIds: ["signal:workspace_settings"],
        evidenceLabel: "You told YOVA",
        methodCandidates: [],
        experimental: false,
      }],
      methodTie: {
        state: {
          controls: { experiments: false },
          activeExperiment: null,
          experimentHistory: [],
        },
        signals: [],
      },
    };

    await expect(generateStreamedTeachingSkeletonWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        failedValidator: "session_provider_request",
        repairAttempted: false,
        repairDetail: expect.stringContaining("unknown"),
      },
    });

    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as Record<string, unknown>;
    expect(prompt).toMatchObject({
      sessionDeliveryPolicy: {
        knowledgeCheck: { mode: "closed_note_first" },
      },
    });
    expect(prompt).not.toHaveProperty("personalization");
    expect(providerInput).not.toContain("PRIVATE-CSS-ONLY");
  });

  it("sends exact per-target source authority into an ordinary mixed streamed session", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(generateStreamedTeachingSkeletonWithOpenAI(mixedStreamedContext())).rejects.toMatchObject({
      generationStats: { attempts: 1, failedValidator: "session_provider_request" },
    });
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1));
    expect(prompt.sessionProvenanceContract).toMatchObject({
      version: "mixed_provenance_v1",
      targetProvenance: [{
        targetIndex: 0,
        topicId: TOPIC_ID,
        provenance: "mapped_material",
        allowedChunkIds: [CHUNK_ID],
      }, {
        targetIndex: 1,
        topicId: AI_TOPIC_ID,
        provenance: "model_knowledge",
        allowedChunkIds: [],
      }],
    });
    expect(prompt.sourceGroundingPolicy).toMatchObject({
      supplementationAllowed: true,
      supplementationRequiredForTeaching: true,
    });
  });

  it("retries a real SDK timeout whose Error name is generic", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    parseResponse.mockReset();
    parseResponse
      .mockRejectedValueOnce(new APIConnectionTimeoutError())
      .mockRejectedValueOnce(new Error("provider unavailable after retry"));

    await expect(generateStreamedTeachingSkeletonWithOpenAI(contextWithMaterials([]))).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        failedValidator: "session_provider_request",
        repairAttempted: true,
        repairSucceeded: false,
        repairDetail: expect.stringContaining("unknown"),
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("allows the third call to be the successful scope-only repair", async () => {
    const {
      streamedSkeletonRepairAttemptCopy,
      streamedSkeletonRequestTimeoutMs,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 10_000;
    const simulatedOutcomes = [
      "streamed_lesson_scope",
      "streamed_lesson_scope",
      null,
    ] as const;
    const requestTimes = [startedAt, startedAt + 9_000, startedAt + 18_000];
    let previousFailedValidator: "streamed_lesson_scope" | null = null;
    let successfulAttempt = 0;

    simulatedOutcomes.forEach((outcome, attemptIndex) => {
      const timeout = streamedSkeletonRequestTimeoutMs({
        attemptIndex,
        generationStartedAt: startedAt,
        now: requestTimes[attemptIndex]!,
        previousFailedValidator,
      });
      expect(timeout).not.toBeNull();
      if (outcome === null) successfulAttempt = attemptIndex + 1;
      previousFailedValidator = outcome;
    });

    expect(successfulAttempt).toBe(3);
    expect(streamedSkeletonRepairAttemptCopy(successfulAttempt)).toBe("2 repair attempts");
  });

  it("keeps ordinary non-scope failures at the existing two provider calls", async () => {
    const { streamedSkeletonRequestTimeoutMs } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 20_000;

    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 0,
      generationStartedAt: startedAt,
      now: startedAt,
      previousFailedValidator: null,
    })).toBe(35_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 1,
      generationStartedAt: startedAt,
      now: startedAt + 8_000,
      previousFailedValidator: "session_structure",
    })).toBe(35_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 16_000,
      previousFailedValidator: "session_structure",
    })).toBeNull();
  });

  it("uses only the remaining total budget and refuses an unviable third call", async () => {
    const { streamedSkeletonRequestTimeoutMs } = await import("@/lib/openai/streamed-teaching-generator");
    const startedAt = 30_000;

    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 40_000,
      previousFailedValidator: "streamed_lesson_scope",
    })).toBe(18_000);
    expect(streamedSkeletonRequestTimeoutMs({
      attemptIndex: 2,
      generationStartedAt: startedAt,
      now: startedAt + 54_001,
      previousFailedValidator: "streamed_lesson_scope",
    })).toBeNull();
  });

  it("turns a later-attempt SDK Zod failure into a controlled session failure", async () => {
    const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
    const malformed = z.object({ required: z.string() }).safeParse({});
    if (malformed.success) throw new Error("Expected the test fixture to fail Zod parsing.");

    parseResponse.mockReset();
    parseResponse
      .mockRejectedValueOnce(malformed.error)
      .mockRejectedValueOnce(malformed.error);

    const generation = generateStreamedTeachingSkeletonWithOpenAI(contextWithMaterials([{
      name: "World War I study guide.pdf",
      text: "Alliances and mobilization widened the July Crisis into a European war.",
      truncated: false,
      role: "scope_outline",
    }]));

    await expect(generation).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        failedValidator: "session_structure",
        repairAttempted: true,
        repairSucceeded: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("stops a streamed provider call at the shared route deadline", async () => {
    const startedAt = new Date("2026-08-21T15:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse.mockReset();
    parseResponse.mockImplementationOnce((_, options: { signal: AbortSignal }) => (
      new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      })
    ));

    try {
      const { generateStreamedTeachingSkeletonWithOpenAI } = await import("@/lib/openai/streamed-teaching-generator");
      const generation = generateStreamedTeachingSkeletonWithOpenAI(contextWithMaterials([]), {
        deadlineAt: startedAt.getTime() + 30_000,
        settlementReserveMs: 12_000,
      });
      const rejection = expect(generation).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 1,
          failedValidator: "session_provider_request",
        },
      });

      await vi.advanceTimersByTimeAsync(18_000);
      await rejection;
      expect(parseResponse).toHaveBeenCalledTimes(1);
      expect(parseResponse.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        maxRetries: 0,
        timeout: 18_000,
        signal: expect.any(AbortSignal),
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("streamed lesson-brief placement normalization", () => {
  it("removes misplaced lesson briefs from multiple choice, free response, and reflection", async () => {
    const {
      normalizeStreamedLessonBriefPlacement,
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const essentialIdea = "Alliance commitments increased the chance that a local crisis would widen.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: [essentialIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const output = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach one bounded causal relationship before requiring an explanation from memory.",
      coverage: {
        focus: "Explain how alliance commitments increased escalation risk.",
        essentialIdeas: [essentialIdea],
        completionEvidence: ["Explain the alliance relationship without reopening the model"],
        evidenceMap: [{
          essentialIdea,
          activityConcept: "Alliance escalation risk",
        }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a concise causal model and then explain the relationship from memory.",
        why: "Producing the causal relationship reveals whether the learner understood the model.",
        how: ["Study the model once.", "Explain the relationship without reopening it."],
        completion: "Explain how alliance commitments increased escalation risk without notes.",
        personalization: ["The bounded model keeps the first learning action focused and concrete."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId: TOPIC_ID,
          methodPhase: "model",
          estimatedMinutes: 5,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the alliance model",
          body: "Study the bounded causal relationship before trying to explain it.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "guided_practice",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          label: "Check",
          title: "Choose the escalation link",
          body: "Choose the statement that best explains the active relationship.",
          teaching: null,
          lessonBrief,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "multiple_choice",
          concept: "Alliance escalation recognition",
          choices: [
            "Alliance commitments could draw additional states into a local crisis.",
            "Alliance commitments guaranteed that every dispute stayed local.",
            "Alliance commitments ended all military planning before the crisis.",
          ],
          correctAnswer: "Alliance commitments could draw additional states into a local crisis.",
          feedback: "Existing commitments increased the chance that several states would enter a local conflict.",
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the escalation risk",
          body: "Explain the active relationship from memory in one or two sentences.",
          teaching: null,
          lessonBrief,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: "Alliance escalation risk",
          choices: [],
          correctAnswer: essentialIdea,
          feedback: "Connect preexisting alliance commitments directly to the risk of wider state involvement.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check the relationship later",
          body: "YOVA will bring this same active relationship back after a delay.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => StreamedGeneratedSessionDraftSchema.parse(output)).toThrow(/only instruction activities/i);

    const normalized = normalizeStreamedLessonBriefPlacement(output);
    expect(normalized.activities.map((activity) => activity.lessonBrief !== null)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(normalized)).not.toThrow();
  });
});

describe("authoritative streamed-session source grounding", () => {
  it("creates a verifiable synthetic anchor when legacy excerpts lack chunk metadata", async () => {
    const { authoritativeSourceGrounding, legacyMaterialChunkId } = await import("@/lib/openai/streamed-teaching-generator");
    const context = contextWithMaterials([{
      name: "World War I study guide.pdf",
      text: "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
      truncated: false,
      role: "scope_outline",
    }]);

    expect(authoritativeSourceGrounding(context)).toMatchObject({
      mode: "materials_plus_ai",
      sourceNames: ["World War I study guide.pdf"],
      anchors: [{
        chunkId: legacyMaterialChunkId(
          "World War I study guide.pdf",
          "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
        ),
        locationLabel: "Uploaded material",
      }],
    });
  });

  it("keeps verified mapped chunks as authoritative anchors", async () => {
    const { authoritativeSourceGrounding } = await import("@/lib/openai/streamed-teaching-generator");
    const context = contextWithMaterials([{
      materialId: MATERIAL_ID,
      chunkId: CHUNK_ID,
      chunkIndex: 0,
      name: "World War I study guide.pdf",
      text: "Militarism, alliances, imperial competition, and nationalism increased European tensions.",
      truncated: false,
      locationLabel: "Page 1, Long-term causes",
      role: "scope_outline",
    }]);

    expect(authoritativeSourceGrounding(context)).toMatchObject({
      mode: "materials_plus_ai",
      sourceNames: ["World War I study guide.pdf"],
      anchors: [{
        chunkId: CHUNK_ID,
        locationLabel: "Page 1, Long-term causes",
      }],
    });
  });

  it("discloses AI-origin targets without attributing them to the uploaded source", async () => {
    const { authoritativeSourceGrounding } = await import("@/lib/openai/streamed-teaching-generator");

    expect(authoritativeSourceGrounding(mixedStreamedContext())).toMatchObject({
      mode: "materials_plus_ai",
      anchors: [expect.objectContaining({ chunkId: CHUNK_ID })],
      supplements: [expect.objectContaining({ topic: "Mobilization timing restricted diplomacy" })],
    });
  });
});

describe("streamed-session activity compaction", () => {
  it("keeps the final interleaved first action inside the delivery-policy cap", async () => {
    const {
      allocateStreamedTeachingMinutes,
      interleaveStreamedTeachingCycles,
      validateStreamedTeachingPacing,
    } = await import("@/lib/session-generation/streamed-pacing");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      buildStatedPreferenceLessonDelivery,
      validateSessionDeliveryPolicy,
    } = await import("@/lib/personalization/session-delivery-policy");
    const {
      melatoninStreamedEvaluationContext,
    } = await import("@/evals/melatonin-session-case");
    const context = melatoninStreamedEvaluationContext();
    const firstIdea = "Darkness changes the circadian signal that controls biological timing.";
    const secondIdea = "The pineal gland releases melatonin as a signal of biological night.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: [firstIdea, secondIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const question = (concept: string, idea: string) => ({
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      label: "Explain",
      title: `Explain ${concept}`,
      body: `Explain ${concept} without reopening the lesson.`,
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept,
      choices: [],
      correctAnswer: idea,
      feedback: `Compare your explanation with this relationship: ${idea}`,
    });
    const delivery = buildStatedPreferenceLessonDelivery({
      learnerProfile: context.learnerProfile,
      estimatedMinutes: 15,
      taskType: "conceptual_learning",
    });
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach the two connected melatonin relationships before requiring explanation from memory.",
      coverage: {
        focus: "Connect darkness, circadian timing, pineal release, and melatonin.",
        essentialIdeas: [firstIdea, secondIdea],
        completionEvidence: ["Explain both connected relationships without notes"],
        evidenceMap: [
          { essentialIdea: firstIdea, activityConcept: "Darkness and circadian timing" },
          { essentialIdea: secondIdea, activityConcept: "Pineal melatonin release" },
        ],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study the causal model, then explain each relationship from memory.",
        why: "Explaining each link reveals whether the causal model is understood.",
        how: ["Study one relationship.", "Explain it before continuing."],
        completion: "Explain both relationships without reopening the lesson.",
        personalization: delivery.policy.learnerFacingReasons.slice(0, 3),
      },
      sourceGrounding: null,
      activities: [{
        topicId: TOPIC_ID,
        methodPhase: "model",
        estimatedMinutes: 5,
        requiredForCompletion: true,
        label: "Learn",
        title: "Build the melatonin model",
        body: "Study the connected model before explaining each relationship.",
        teaching: null,
        lessonBrief,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "instruction",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }, question("Darkness and circadian timing", firstIdea), question("Pineal melatonin release", secondIdea), {
        topicId: null,
        methodPhase: "reflect",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        label: "Reflect",
        title: "Name the central relationship",
        body: "Name the relationship that now feels most important in the model.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "reflection",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }, {
        topicId: null,
        methodPhase: "schedule_return",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        label: "Return",
        title: "Check the model again later",
        body: "YOVA will bring this model back after a delay for unsupported retrieval.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "reflection",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
    });

    const maximumFirstActionMinutes = Math.max(5, delivery.policy.pacing.firstActionMinutes + 2);
    expect(delivery.policy.pacing.firstActionMinutes).toBe(2);
    expect(maximumFirstActionMinutes).toBe(5);
    const interleaved = interleaveStreamedTeachingCycles({
      draft,
      availableMinutes: 15,
      maximumFocusedActivities: delivery.policy.pacing.maximumActivities,
      maximumFirstActionMinutes,
    });
    const finalized = {
      ...interleaved,
      activities: allocateStreamedTeachingMinutes({
        activities: interleaved.activities,
        availableMinutes: 15,
        maximumFirstActionMinutes,
      }),
    };

    expect(finalized.activities.map((activity) => activity.methodPhase)).toEqual([
      "model", "explain", "model", "explain", "schedule_return",
    ]);
    expect(finalized.activities[0]?.estimatedMinutes).toBeLessThanOrEqual(5);
    expect(validateStreamedTeachingPacing({
      draft: finalized,
      availableMinutes: 15,
      maximumFocusedActivities: delivery.policy.pacing.maximumActivities,
    })).toBeNull();
    expect(validateSessionDeliveryPolicy({
      policy: delivery.policy,
      learningMode: "learn",
      activities: finalized.activities,
    })).toBeNull();
  });

  it("keeps produced recall when only one guided check can fit", async () => {
    const { retainBoundedQuestionMix } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const questionBase = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      body: "Answer this bounded World War I check.",
      teaching: null,
      lessonBrief: null,
      choices: [] as string[],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const questions = [
      {
        ...questionBase,
        type: "multiple_choice" as const,
        methodPhase: "guided_practice" as const,
        concept: "July Crisis trigger",
        label: "Check",
        title: "Choose the trigger",
        choices: ["Sarajevo assassination", "U.S. entry", "Armistice"],
        correctAnswer: "Sarajevo assassination",
        feedback: "The assassination triggered the July Crisis.",
      },
      {
        ...questionBase,
        type: "free_response" as const,
        methodPhase: "explain" as const,
        concept: "July Crisis escalation",
        label: "Explain",
        title: "Explain the escalation",
        correctAnswer: "Alliance commitments and mobilization widened the July Crisis into war.",
        feedback: "Connect commitments and mobilization directly to escalation.",
      },
    ];

    expect(retainBoundedQuestionMix(questions, 1).map((activity) => activity.type))
      .toEqual(["free_response"]);
    expect(retainBoundedQuestionMix(questions, 2).map((activity) => activity.type))
      .toEqual(["multiple_choice", "free_response"]);
  });

  it("keeps teaching, method phases, and both question types inside a 15-minute session", async () => {
    const { compactStreamedActivities } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const base = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      body: "Complete this focused World War I learning action.",
      teaching: null,
      lessonBrief: null,
      choices: [] as string[],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const activities = [
      { ...base, type: "instruction" as const, methodPhase: "model" as const, concept: null, label: "Learn", title: "Build the model" },
      { ...base, type: "multiple_choice" as const, methodPhase: "guided_practice" as const, concept: "Alliances", label: "Try", title: "Choose the link", choices: ["A", "B", "C"], correctAnswer: "A", feedback: "Alliance commitments widened the conflict." },
      { ...base, type: "instruction" as const, methodPhase: "orient" as const, concept: null, label: "Pause", title: "Review the timeline" },
      { ...base, type: "free_response" as const, methodPhase: "explain" as const, concept: "Mobilization", label: "Explain", title: "Explain the escalation", correctAnswer: "Mobilization made the crisis difficult to contain.", feedback: "Connect mobilization directly to escalation." },
      { ...base, type: "reflection" as const, topicId: null, methodPhase: "reflect" as const, concept: null, label: "Reflect", title: "Name the key link" },
      { ...base, type: "reflection" as const, topicId: null, methodPhase: "schedule_return" as const, concept: null, label: "Return", title: "Return later" },
    ];

    const compacted = compactStreamedActivities({
      activities,
      estimatedMinutes: 15,
      requiredPhases: ["model", "explain"],
    });

    expect(compacted.filter((activity) => activity.methodPhase !== "schedule_return")).toHaveLength(4);
    expect(compacted.some((activity) => activity.methodPhase === "model")).toBe(true);
    expect(compacted.some((activity) => activity.methodPhase === "explain")).toBe(true);
    expect(compacted.some((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(compacted.some((activity) => activity.type === "free_response")).toBe(true);
    expect(compacted.some((activity) => activity.methodPhase === "schedule_return")).toBe(true);
  });

  it("bounds the first activity to the learner delivery policy instead of regenerating the skeleton", async () => {
    const { alignFirstActionPacing } = await import("@/lib/openai/streamed-teaching-generator");
    const topicId = "10000000-0000-4000-8000-000000000001";
    const activities = [{
      topicId,
      methodPhase: "model" as const,
      estimatedMinutes: 9,
      requiredForCompletion: true,
      label: "Learn",
      title: "Build the World War I cause map",
      body: "Study the connected cause map before explaining it.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
      type: "instruction" as const,
      concept: null,
      choices: [],
      correctAnswer: null,
      feedback: null,
    }];

    expect(alignFirstActionPacing({ activities, maximumMinutes: 5 })[0]?.estimatedMinutes).toBe(5);
  });
});

describe("runtime session-window scoping", () => {
  it("uses cycle-compatible teaching methods for conceptual and programming lessons", async () => {
    const { streamedTeachingCycleRouting } = await import("@/lib/openai/streamed-teaching-generator");
    const { learningModeContract } = await import("@/lib/learning/learning-intent");
    const baseRouting = {
      learningIntent: "learn" as const,
      sessionLearningMode: "learn" as const,
      knowledgeStage: "novice" as const,
      methodFit: null,
      methods: [],
      deliveryModifiers: [],
      decisionBasis: [],
      guardrails: [],
      executionContract: learningModeContract("learn"),
    };

    expect(streamedTeachingCycleRouting({
      ...baseRouting,
      taskType: "conceptual_learning",
      suggestedPrimaryMethodId: "read_recall_review",
      allowedMethodIds: ["read_recall_review", "self_explanation", "retrieval_practice"],
    }).allowedMethodIds).toEqual(["self_explanation"]);
    expect(streamedTeachingCycleRouting({
      ...baseRouting,
      taskType: "programming",
      suggestedPrimaryMethodId: "scaffolded_coding",
      allowedMethodIds: ["scaffolded_coding", "worked_example_fading"],
    }).allowedMethodIds).toEqual(["worked_example_fading"]);
  });

  it("breaks a tie only after limiting the router list to streamed-cycle methods", async () => {
    const { streamedTeachingCycleRouting } = await import("@/lib/openai/streamed-teaching-generator");
    const { learningModeContract } = await import("@/lib/learning/learning-intent");
    const result = streamedTeachingCycleRouting({
      learningIntent: "learn",
      sessionLearningMode: "learn",
      taskType: "conceptual_learning",
      knowledgeStage: "novice",
      suggestedPrimaryMethodId: "read_recall_review",
      allowedMethodIds: ["read_recall_review", "self_explanation", "retrieval_practice"],
      methodFit: null,
      methods: [],
      deliveryModifiers: [],
      decisionBasis: [],
      guardrails: [],
      executionContract: learningModeContract("learn"),
    }, {
      decisions: [],
      methodTie: {
        state: {
          controls: { experiments: false },
          activeExperiment: null,
          experimentHistory: [],
        },
        signals: [{
          id: "signal:memory_breakdown",
          key: "memory_breakdown",
          title: "Rewordable display copy",
          code: "recognition_without_recall",
          evidenceLabel: "You told YOVA",
          paused: false,
        }],
      },
    });

    expect(result.allowedMethodIds).toEqual(["retrieval_practice"]);
    expect(result.decisionBasis.at(-1)).toMatch(/personalization tie-break/i);
  });

  it("keeps a Bioenergetics claim mapped to its concise ATP target", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
      StreamedSkeletonProviderOutputSchema,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const { streamedTeachingPacingContract } = await import("@/lib/session-generation/streamed-pacing");
    const { lessonIdeaMatchesTarget } = await import("@/lib/session-generation/lesson-brief");
    const target = "Energy coupling and ATP";
    const ideas = [
      "Cells couple ATP hydrolysis to energy-requiring reactions.",
      "ATP energy coupling through phosphorylation transfers energy to cellular reactants.",
    ];
    const concepts = ["ATP energy coupling", "ATP phosphorylation"];
    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach how ATP couples energy-releasing reactions to cellular work before checking recall.",
      coverage: {
        focus: "Connect ATP hydrolysis to energy-requiring cellular reactions.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Explain ATP energy coupling without reopening the model",
          "Explain how phosphorylation transfers usable energy",
        ],
        evidenceMap: ideas.map((idea, index) => ({
          essentialIdea: idea,
          activityConcept: concepts[index]!,
        })),
        // Coverage alignment can conservatively preserve a concise target
        // label when the explanatory claim is longer. Current-window scoping
        // must remove that label once the target has a taught, checked claim.
        deferredContent: [target],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study one connected energy model and explain the relationship from memory.",
        why: "Producing the ATP relationship reveals whether the mechanism is understood.",
        how: ["Read the model once.", "Explain the relationship without reopening it."],
        completion: "Explain how ATP hydrolysis supports energy-requiring cellular work.",
        personalization: ["The session begins with a concrete mechanism before the question."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId: TOPIC_ID,
          methodPhase: "model",
          estimatedMinutes: 9,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the ATP coupling model",
          body: "Read the focused mechanism before explaining it from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "explain",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain ATP energy coupling",
          body: "Explain how ATP hydrolysis can support an energy-requiring cellular reaction.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: concepts[0],
          choices: [],
          correctAnswer: ideas[0],
          feedback: "Connect energy released by ATP hydrolysis to the energy-requiring cellular work.",
        },
        {
          topicId: TOPIC_ID,
          methodPhase: "transfer",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Apply",
          title: "Explain ATP phosphorylation",
          body: "Explain how ATP can transfer usable energy by phosphorylating a cellular reactant.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "independent_transfer",
          misconceptionSummary: null,
          type: "free_response",
          concept: concepts[1],
          choices: [],
          correctAnswer: ideas[1],
          feedback: "Connect phosphate transfer to the reactant's changed energy and reactivity.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check ATP coupling later",
          body: "YOVA will bring this relationship back after a delay.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: [target],
      estimatedMinutes: 25,
      learnerDirection: null,
      targetAssignments: ideas.map((essentialIdea) => ({
        essentialIdea,
        targetId: "target_1" as const,
      })),
    });
    expect(scoped.coverage.essentialIdeas).toEqual(ideas);
    expect(scoped.coverage.deferredContent).toEqual([]);

    const providerOutput = StreamedSkeletonProviderOutputSchema.parse({
      ...draft,
      targetAssignments: ideas.map((essentialIdea) => ({ essentialIdea, targetId: "target_1" })),
    });
    const cacheableDraft = StreamedGeneratedSessionDraftOutputSchema.parse(providerOutput);
    expect(providerOutput.targetAssignments).toHaveLength(2);
    expect("targetAssignments" in cacheableDraft).toBe(false);

    const deferredNeighbor = "Energy coupling and ATP during long-term exercise";
    const longActiveIdea = "Cells use ATP hydrolysis to transfer energy into reactions that require cellular work.";
    expect(lessonIdeaMatchesTarget(longActiveIdea, target)).toBe(false);
    const sharedParentDraft = StreamedGeneratedSessionDraftSchema.parse({
      ...draft,
      coverage: {
        ...draft.coverage,
        essentialIdeas: [longActiveIdea],
        completionEvidence: [draft.coverage.completionEvidence[0]!],
        evidenceMap: [{
          essentialIdea: longActiveIdea,
          activityConcept: concepts[0]!,
        }],
        deferredContent: [deferredNeighbor],
      },
      activities: [
        {
          ...draft.activities[0]!,
          estimatedMinutes: 5,
          lessonBrief: {
            ...draft.activities[0]!.lessonBrief!,
            essentialIdeas: [longActiveIdea],
          },
        },
        {
          ...draft.activities[1]!,
          correctAnswer: longActiveIdea,
        },
        draft.activities[3]!,
      ],
    });
    const shortened = scopeStreamedSkeletonToCurrentWindow({
      draft: sharedParentDraft,
      plannedTargets: [target, deferredNeighbor],
      estimatedMinutes: 15,
      learnerDirection: null,
      pacingContract: streamedTeachingPacingContract({
        availableMinutes: 15,
        activeIdeaCount: 2,
        maximumActiveIdeas: 1,
      }),
      targetAssignments: [{ essentialIdea: longActiveIdea, targetId: "target_1" }],
    });
    expect(shortened.coverage.essentialIdeas).toEqual([longActiveIdea]);
    expect(shortened.coverage.deferredContent).toContain(deferredNeighbor);

    const contaminatedIdea = "ATP and energy coupling during long-term exercise changes how cells supply usable energy.";
    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: StreamedGeneratedSessionDraftSchema.parse({
        ...sharedParentDraft,
        coverage: {
          ...sharedParentDraft.coverage,
          essentialIdeas: [contaminatedIdea],
          evidenceMap: [{
            essentialIdea: contaminatedIdea,
            activityConcept: concepts[0]!,
          }],
        },
        activities: sharedParentDraft.activities.map((activity) => (
          activity.type === "instruction" && activity.lessonBrief
            ? {
                ...activity,
                lessonBrief: { ...activity.lessonBrief, essentialIdeas: [contaminatedIdea] },
              }
            : activity.type === "free_response"
              ? { ...activity, correctAnswer: contaminatedIdea }
              : activity
        )),
      }),
      plannedTargets: [target, deferredNeighbor],
      estimatedMinutes: 15,
      learnerDirection: null,
      pacingContract: streamedTeachingPacingContract({
        availableMinutes: 15,
        activeIdeaCount: 2,
        maximumActiveIdeas: 1,
      }),
      targetAssignments: [{ essentialIdea: contaminatedIdea, targetId: "target_1" }],
    })).toThrow(/deferred(?:-session substance| content remained)/i);
  });

  it("defines the 15-minute World War I window before generation", async () => {
    const {
      buildStreamedCurrentSessionScope,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const plannedTargets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];

    expect(buildStreamedCurrentSessionScope({
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis first and leave later-war topics for later sessions.",
    })).toEqual({
      activeTargets: plannedTargets.slice(0, 2),
      deferredTargets: plannedTargets.slice(2),
    });

    expect(buildStreamedCurrentSessionScope({
      plannedTargets: plannedTargets.slice(0, 2),
      alreadyDeferredTargets: plannedTargets.slice(2),
      estimatedMinutes: 15,
      learnerDirection: null,
    })).toEqual({
      activeTargets: plannedTargets.slice(0, 2),
      deferredTargets: plannedTargets.slice(2),
    });
  });

  it("uses stable target ids for a legitimate WWI paraphrase that strict prose matching cannot identify", async () => {
    const {
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      lessonIdeaMatchesTarget,
    } = await import("@/lib/session-generation/lesson-brief");
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "Before 1914, European alliances divided powers into rival armed blocs whose commitments increased the danger that a regional dispute would spread among major states.",
      "The Sarajevo assassination triggered a sequence that turned a local crisis into declarations of war.",
      "Basic chronology from 1914 to 1918 runs from the outbreak through U.S. entry to the armistice.",
    ];
    expect(lessonIdeaMatchesTarget(ideas[0]!, targets[0]!)).toBe(false);

    const resolved = validateStreamedTargetAssignments({
      essentialIdeas: ideas,
      targetAssignments: ideas.map((essentialIdea, index) => ({
        essentialIdea,
        targetId: `target_${index + 1}` as "target_1" | "target_2" | "target_3",
      })),
      currentSessionScope: { activeTargets: targets, deferredTargets: [] },
    });

    expect(resolved.map((assignment) => assignment.target)).toEqual(targets);
  });

  it("builds a narrow description-backed subject reference for an exact session topic", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const context = contextWithMaterials([]);
    const target = "Light scattering in the atmosphere";
    const idea = "Air molecules redirect incoming sunlight in many directions, with the shorter wavelengths redirected more strongly.";
    context.knowledgeTopics = [{
      ...context.knowledgeTopics[0]!,
      title: target,
      description: "How sunlight interacts with air molecules and gets redirected in different directions.",
      subtopics: ["Air molecules", "Short-wavelength scattering"],
    }];
    context.session.contentTargets = [target];
    const currentSessionScope = { activeTargets: [target], deferredTargets: [] };
    const targetSubjectReferences = buildStreamedTargetSubjectReferences({
      context,
      currentSessionScope,
    });

    expect(targetSubjectReferences).toEqual({
      target_1: [
        "How sunlight interacts with air molecules and gets redirected in different directions.",
        "Air molecules",
        "Short-wavelength scattering",
      ],
    });
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [idea],
      targetAssignments: [{ essentialIdea: idea, targetId: "target_1" }],
      currentSessionScope,
      targetSubjectReferences,
    })).toHaveLength(1);
  });

  it("uses mapped active topic references to distinguish shared Spanish vocabulary from deferred bilingual recall", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const context = threeTargetSpanishContext();
    context.knowledgeTopics = context.knowledgeTopics.slice(0, 2);
    context.session.topicIds = context.session.topicIds.slice(0, 2);
    context.session.contentTargets = [...THREE_TARGET_SPANISH_TARGETS.slice(0, 2)];
    context.session.deferredContentTargets = [THREE_TARGET_SPANISH_TARGETS[2]];
    const currentSessionScope = {
      activeTargets: [...THREE_TARGET_SPANISH_TARGETS.slice(0, 2)],
      deferredTargets: [THREE_TARGET_SPANISH_TARGETS[2]],
    };
    const targetSubjectReferences = buildStreamedTargetSubjectReferences({
      context,
      currentSessionScope,
    });

    expect(targetSubjectReferences).toMatchObject({
      target_1: expect.arrayContaining([
        "High-frequency Spanish words for common foods and drinks, especially items likely to appear on a basic quiz.",
        "drinks",
      ]),
      target_2: expect.arrayContaining([
        "Words for places, people, and objects you would see in a restaurant or on a menu.",
        "menu and bill",
      ]),
    });
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [...THREE_TARGET_SPANISH_IDEAS],
      targetAssignments: THREE_TARGET_SPANISH_IDEAS.map((essentialIdea, index) => ({
        essentialIdea,
        targetId: `target_${index + 1}` as "target_1" | "target_2",
      })),
      currentSessionScope,
      targetSubjectReferences,
    })).toHaveLength(2);

    const bilingualRecallLeak = "Spanish restaurant terms can be recalled by translating each word from English to Spanish.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [THREE_TARGET_SPANISH_IDEAS[0], bilingualRecallLeak],
      targetAssignments: [{
        essentialIdea: THREE_TARGET_SPANISH_IDEAS[0],
        targetId: "target_1",
      }, {
        essentialIdea: bilingualRecallLeak,
        targetId: "target_2",
      }],
      currentSessionScope,
      targetSubjectReferences,
    })).toThrow(/deferred-session substance/i);
  });

  it("does not lend a broad one-topic reference that also describes the deferred bilingual target", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const context = spanishRestaurantContext(15);
    context.knowledgeTopics = [{
      ...context.knowledgeTopics[0]!,
      title: "Broad Spanish vocabulary",
      description: "High-frequency Spanish foods and drinks plus English-to-Spanish and Spanish-to-English recall practice.",
      subtopics: ["foods and drinks", "English to Spanish", "Spanish to English", "closed-note recall"],
    }];
    context.session.contentTargets = [THREE_TARGET_SPANISH_TARGETS[0]];
    context.session.deferredContentTargets = [THREE_TARGET_SPANISH_TARGETS[2]];
    const currentSessionScope = {
      activeTargets: [THREE_TARGET_SPANISH_TARGETS[0]],
      deferredTargets: [THREE_TARGET_SPANISH_TARGETS[2]],
    };
    const targetSubjectReferences = buildStreamedTargetSubjectReferences({
      context,
      currentSessionScope,
    });

    expect(targetSubjectReferences).toEqual({});
    const bilingualRecallLeak = "High-frequency Spanish foods and drinks are recalled by translating each word from English to Spanish.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [bilingualRecallLeak],
      targetAssignments: [{ essentialIdea: bilingualRecallLeak, targetId: "target_1" }],
      currentSessionScope,
      targetSubjectReferences,
    })).toThrow(/deferred-session substance/i);
  });

  it("does not reuse one broad topic reference to authorize claims for multiple active target ids", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const context = spanishRestaurantContext(25);
    const activeTargets = [
      "High-frequency foods and drinks",
      "Restaurant people, objects, and menu terms",
    ];
    context.knowledgeTopics = [{
      ...context.knowledgeTopics[0]!,
      title: "Broad Spanish restaurant vocabulary",
      description: "High-frequency Spanish foods and drinks plus words for restaurant people, objects, and menu terms.",
      subtopics: ["foods and drinks", "restaurant people", "dining objects", "menu terms"],
    }];
    context.session.contentTargets = activeTargets;
    const currentSessionScope = { activeTargets, deferredTargets: [] };
    const targetSubjectReferences = buildStreamedTargetSubjectReferences({
      context,
      currentSessionScope,
    });

    expect(targetSubjectReferences).toEqual({});
    const firstTargetIdea = "High-frequency Spanish foods and drinks include agua, pan, and sopa.";
    const duplicateFirstTargetClaim = "High-frequency Spanish foods and drinks also include leche, arroz, and carne.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [firstTargetIdea, duplicateFirstTargetClaim],
      targetAssignments: [{ essentialIdea: firstTargetIdea, targetId: "target_1" }, {
        essentialIdea: duplicateFirstTargetClaim,
        targetId: "target_2",
      }],
      currentSessionScope,
      targetSubjectReferences,
    })).toThrow(/does not preserve that target's subject terms/i);
  });

  it("does not aggregate English and Spanish references across different active target ids", async () => {
    const { validateStreamedTargetAssignments } = await import("@/lib/openai/streamed-teaching-generator");
    const activeTargets = [
      "High-frequency foods and drinks",
      "Restaurant people, objects, and menu terms",
    ];
    const currentSessionScope = {
      activeTargets,
      deferredTargets: ["English to Spanish translation practice"],
    };
    const firstTargetWithEnglishLeak = "High-frequency Spanish foods and drinks can be paired with English glosses for meaning.";
    const secondTargetIdea = "Restaurant people, objects, and menu terms distinguish camarero, mesa, and menú.";

    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [firstTargetWithEnglishLeak, secondTargetIdea],
      targetAssignments: [{ essentialIdea: firstTargetWithEnglishLeak, targetId: "target_1" }, {
        essentialIdea: secondTargetIdea,
        targetId: "target_2",
      }],
      currentSessionScope,
      targetSubjectReferences: {
        target_1: ["High-frequency Spanish words for common foods and drinks."],
        target_2: ["English labels for restaurant people, objects, and menu terms."],
      },
    })).toThrow(/deferred-session substance/i);
  });

  it("excludes exact one- and two-term deferred labels from broad active-topic references", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const activeTarget = "Cell-cycle checkpoints";

    for (const deferredTarget of ["Mitosis", "Calvin cycle"]) {
      const context = spanishRestaurantContext(15);
      context.knowledgeTopics = [{
        ...context.knowledgeTopics[0]!,
        title: "Broad cell biology",
        description: `Cell-cycle checkpoints regulate division before a later explanation of ${deferredTarget}.`,
        subtopics: ["checkpoint signals", deferredTarget],
      }];
      context.session.contentTargets = [activeTarget];
      context.session.deferredContentTargets = [deferredTarget];
      const currentSessionScope = {
        activeTargets: [activeTarget],
        deferredTargets: [deferredTarget],
      };
      const targetSubjectReferences = buildStreamedTargetSubjectReferences({
        context,
        currentSessionScope,
      });

      expect(targetSubjectReferences).toEqual({});
      const contaminatedIdea = `Cell-cycle checkpoints regulate division before ${deferredTarget} begins.`;
      expect(() => validateStreamedTargetAssignments({
        essentialIdeas: [contaminatedIdea],
        targetAssignments: [{ essentialIdea: contaminatedIdea, targetId: "target_1" }],
        currentSessionScope,
        targetSubjectReferences,
      })).toThrow(/deferred-session substance/i);
    }
  });

  it("keeps a one-word deferred label in the full-scope fingerprint after rejecting its broad topic reference", async () => {
    const {
      buildStreamedTargetSubjectReferences,
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const { StreamedGeneratedSessionDraftSchema } = await import("@/lib/session-generation/schema");
    const { streamedTeachingPacingContract } = await import("@/lib/session-generation/streamed-pacing");
    const activeTarget = "Cell-cycle checkpoints";
    const deferredTarget = "Mitosis";
    const activeIdea = "Cell-cycle checkpoints pause division when DNA damage or incomplete replication is detected.";
    const concept = "Cell-cycle checkpoint control";
    const context = spanishRestaurantContext(15);
    context.knowledgeTopics = [{
      ...context.knowledgeTopics[0]!,
      title: "Broad cell biology",
      description: "Cell-cycle checkpoints regulate division before the cell proceeds into Mitosis.",
      subtopics: ["checkpoint signals", "Mitosis"],
    }];
    context.session.contentTargets = [activeTarget];
    context.session.deferredContentTargets = [deferredTarget];
    const currentSessionScope = {
      activeTargets: [activeTarget],
      deferredTargets: [deferredTarget],
    };
    const targetSubjectReferences = buildStreamedTargetSubjectReferences({
      context,
      currentSessionScope,
    });
    expect(targetSubjectReferences).toEqual({});

    const lessonBrief = {
      version: 1 as const,
      topicIds: [TOPIC_ID],
      essentialIdeas: [activeIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [TOPIC_ID],
      rationale: "Teach the active checkpoint relationship before requiring a typed explanation.",
      coverage: {
        focus: "Explain how cell-cycle checkpoints regulate division.",
        essentialIdeas: [activeIdea],
        completionEvidence: ["Explain cell-cycle checkpoint control without reopening the model"],
        evidenceMap: [{ essentialIdea: activeIdea, activityConcept: concept }],
        deferredContent: [deferredTarget],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study the checkpoint model and explain the active relationship from memory.",
        why: "Producing the relationship reveals whether the checkpoint mechanism is understood.",
        how: ["Study the bounded model once.", "Explain the checkpoint relationship without reopening it."],
        completion: "Explain how cell-cycle checkpoints regulate division without notes.",
        personalization: ["Mitosis appears in the broader topic map but belongs to a later lesson."],
      },
      sourceGrounding: null,
      activities: [{
        topicId: TOPIC_ID,
        methodPhase: "model",
        estimatedMinutes: 7,
        requiredForCompletion: true,
        label: "Learn",
        title: "Build the checkpoint model",
        body: "Study the bounded checkpoint relationship before explaining it.",
        teaching: null,
        lessonBrief,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "instruction",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }, {
        topicId: TOPIC_ID,
        methodPhase: "explain",
        estimatedMinutes: 7,
        requiredForCompletion: true,
        label: "Explain",
        title: "Explain checkpoint control",
        body: "Explain how checkpoint signals can pause cell division.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: "baseline",
        misconceptionSummary: null,
        type: "free_response",
        concept,
        choices: [],
        correctAnswer: activeIdea,
        feedback: "Connect the detected problem to the checkpoint signal that pauses division.",
      }, {
        topicId: null,
        methodPhase: "reflect",
        estimatedMinutes: 1,
        requiredForCompletion: false,
        label: "Reflect",
        title: "Notice the checkpoint relationship",
        body: "Note which detected problem would cause the checkpoint to pause division.",
        teaching: null,
        lessonBrief: null,
        practiceIntent: null,
        misconceptionSummary: null,
        type: "reflection",
        concept: null,
        choices: [],
        correctAnswer: null,
        feedback: null,
      }],
    });
    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: [activeTarget, deferredTarget],
      estimatedMinutes: 15,
      learnerDirection: null,
      pacingContract: streamedTeachingPacingContract({
        availableMinutes: 15,
        activeIdeaCount: 2,
        maximumActiveIdeas: 1,
        methodId: "self_explanation",
      }),
      targetAssignments: [{ essentialIdea: activeIdea, targetId: "target_1" }],
      targetSubjectReferences,
    });

    expect(scoped.coverage.deferredContent).toEqual([deferredTarget]);
    expect(scoped.methodBriefing.personalization.join(" ")).not.toMatch(/Mitosis/i);
  });

  it("rejects missing, inactive, and unrelated stable target assignments", async () => {
    const {
      validateStreamedTargetAssignments,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "European alliances divided major powers into rival blocs before 1914.",
      "Rival European alliances made a local diplomatic crisis harder to contain.",
      "Basic chronology from 1914 to 1918 runs from the outbreak through the armistice.",
    ];
    const scope = { activeTargets: targets, deferredTargets: [] };

    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: ideas,
      targetAssignments: ideas.slice(0, 2).map((essentialIdea) => ({
        essentialIdea,
        targetId: "target_1",
      })),
      currentSessionScope: scope,
    })).toThrow(/exactly one stable target assignment/i);

    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [ideas[0]!],
      targetAssignments: [{ essentialIdea: ideas[0]!, targetId: "target_4" }],
      currentSessionScope: {
        activeTargets: [targets[0]!],
        deferredTargets: targets.slice(1),
      },
    })).toThrow(/target id target_4 is not active/i);

    const unrelatedIdea = "European photosynthesis research captures light energy and stores it in chemical bonds.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [unrelatedIdea],
      targetAssignments: [{ essentialIdea: unrelatedIdea, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [targets[0]!],
        deferredTargets: targets.slice(1),
      },
    })).toThrow(/does not preserve that target's subject terms/i);

    const boundedPhotosynthesisIdea = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [boundedPhotosynthesisIdea],
      targetAssignments: [{ essentialIdea: boundedPhotosynthesisIdea, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Photosynthesis"], deferredTargets: [] },
    })).toHaveLength(1);

    const productRuleParaphrase = "Differentiate a product by differentiating each factor once while holding the other factor unchanged.";
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [productRuleParaphrase],
      targetAssignments: [{ essentialIdea: productRuleParaphrase, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Product rule"], deferredTargets: [] },
    })).toHaveLength(1);

    const scatteringParaphrase = "Air molecules redirect incoming sunlight in many directions, with the shorter wavelengths redirected more strongly.";
    const scatteringTarget = "Light scattering in the atmosphere";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [scatteringParaphrase],
      targetAssignments: [{ essentialIdea: scatteringParaphrase, targetId: "target_1" }],
      currentSessionScope: { activeTargets: [scatteringTarget], deferredTargets: [] },
    })).toThrow(/does not preserve that target's subject terms/i);
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [scatteringParaphrase],
      targetAssignments: [{ essentialIdea: scatteringParaphrase, targetId: "target_1" }],
      currentSessionScope: { activeTargets: [scatteringTarget], deferredTargets: [] },
      targetSubjectReferences: {
        target_1: [
          "How sunlight interacts with air molecules and gets redirected in different directions.",
        ],
      },
    })).toHaveLength(1);

    const unrelatedScatteringClaim = "Mitosis separates duplicated chromosomes into two daughter cells.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [unrelatedScatteringClaim],
      targetAssignments: [{ essentialIdea: unrelatedScatteringClaim, targetId: "target_1" }],
      currentSessionScope: { activeTargets: [scatteringTarget], deferredTargets: [] },
      targetSubjectReferences: {
        target_1: [
          "How sunlight interacts with air molecules and gets redirected in different directions.",
        ],
      },
    })).toThrow(/does not preserve that target's subject terms/i);

    const scatteringClaimWithDeferredLeak = "Air molecules redirect sunlight in many directions before the Calvin cycle stores carbon.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [scatteringClaimWithDeferredLeak],
      targetAssignments: [{ essentialIdea: scatteringClaimWithDeferredLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [scatteringTarget],
        deferredTargets: ["Calvin cycle carbon fixation"],
      },
      targetSubjectReferences: {
        target_1: [
          "How sunlight interacts with air molecules and gets redirected in different directions.",
        ],
      },
    })).toThrow(/deferred-session substance/i);

    const unrelatedProductRuleClaim = "Photosynthesis stores light energy in glucose for later cellular work.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [unrelatedProductRuleClaim],
      targetAssignments: [{ essentialIdea: unrelatedProductRuleClaim, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Product rule"], deferredTargets: [] },
    })).toThrow(/does not preserve that target's subject terms/i);

    const broadPhotosynthesisSurvey = "Photosynthesis and cellular respiration exchange gases while ecosystems recycle matter and energy.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [broadPhotosynthesisSurvey],
      targetAssignments: [{ essentialIdea: broadPhotosynthesisSurvey, targetId: "target_1" }],
      currentSessionScope: { activeTargets: ["Photosynthesis"], deferredTargets: [] },
    })).toThrow(/does not preserve that target's subject terms/i);

    const lightTarget = "Light reactions of photosynthesis";
    const lightParaphrase = "In photosynthesis, light-absorbing pigments transfer excited electrons through carriers to make ATP and NADPH.";
    expect(validateStreamedTargetAssignments({
      essentialIdeas: [lightParaphrase],
      targetAssignments: [{ essentialIdea: lightParaphrase, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toHaveLength(1);

    const calvinLeak = "Photosynthesis light enables the Calvin cycle.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [calvinLeak],
      targetAssignments: [{ essentialIdea: calvinLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toThrow(/deferred-session substance/i);

    const singleDistinctiveCalvinLeak = "Light reactions supply energy to the Calvin process.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [singleDistinctiveCalvinLeak],
      targetAssignments: [{ essentialIdea: singleDistinctiveCalvinLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: [lightTarget],
        deferredTargets: ["Calvin cycle in photosynthesis"],
      },
    })).toThrow(/deferred-session substance/i);

    const timeBoundaryLeak = "European alliances before and after the war shaped military commitments.";
    expect(() => validateStreamedTargetAssignments({
      essentialIdeas: [timeBoundaryLeak],
      targetAssignments: [{ essentialIdea: timeBoundaryLeak, targetId: "target_1" }],
      currentSessionScope: {
        activeTargets: ["European alliances before the war"],
        deferredTargets: ["European alliances after the war"],
      },
    })).toThrow(/deferred-session substance/i);
  });

  it("accepts an output-valid typed knowledge check before strict final parsing", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const target = "Prewar European alliances and tensions";
    const idea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const concept = "Prewar alliance pressure";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [idea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const outputParsed = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Teach one bounded prewar relationship and require the learner to explain it from memory.",
      coverage: {
        focus: "Explain why prewar alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [idea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: idea, activityConcept: concept }],
        deferredContent: ["Basic chronology from 1914 to 1918"],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Producing the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested the July Crisis first, so later chronology remains deferred."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 8,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before explaining the active relationship from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the prewar pressure",
          body: "Explain how prewar alliances made the July Crisis more likely to widen across Europe.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept,
          choices: [],
          correctAnswer: "Alliance commitments connected several powers, so a local crisis could draw in multiple states.",
          feedback: "Connect the existing alliance commitments directly to the risk that a local crisis would widen.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check this relationship again",
          body: "YOVA will bring this relationship back later for a short retrieval check without reopening the lesson.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(outputParsed.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(outputParsed.activities.some((activity) => activity.type === "free_response")).toBe(true);

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft: outputParsed,
      plannedTargets: [target],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });

    expect(scoped.activities.filter((activity) => activity.type === "free_response")).toHaveLength(1);
    expect(scoped.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();

    const secondTarget = "Sequence from the Sarajevo assassination to declarations of war";
    const secondIdea = "The Sarajevo assassination triggered a crisis that escalated into declarations of war.";
    const secondConcept = "Sarajevo escalation sequence";
    const multiBlockDraft = StreamedGeneratedSessionDraftOutputSchema.parse({
      ...outputParsed,
      coverage: {
        ...outputParsed.coverage,
        essentialIdeas: [idea, secondIdea],
        completionEvidence: [
          ...outputParsed.coverage.completionEvidence,
          "Explain how the assassination escalated into declarations of war",
        ],
        evidenceMap: [
          ...outputParsed.coverage.evidenceMap,
          { essentialIdea: secondIdea, activityConcept: secondConcept },
        ],
      },
      activities: [
        {
          ...outputParsed.activities[0],
          estimatedMinutes: 4,
          title: "Build the prewar pressure model",
          body: "Connect alliance pressure to the risk that a local crisis would spread.",
        },
        {
          ...outputParsed.activities[0],
          estimatedMinutes: 4,
          title: "Trace the Sarajevo escalation",
          body: "Follow the crisis from the assassination to the declarations of war.",
          lessonBrief: { ...lessonBrief, essentialIdeas: [secondIdea] },
        },
        {
          ...outputParsed.activities[1],
          estimatedMinutes: 2,
        },
        {
          ...outputParsed.activities[1],
          estimatedMinutes: 2,
          concept: secondConcept,
          title: "Explain the Sarajevo escalation",
          body: "Explain how the assassination escalated into declarations of war.",
          correctAnswer: secondIdea,
          feedback: "Connect the assassination, escalation, and declarations in order.",
        },
        outputParsed.activities[2],
      ],
    });
    const scopedMultiBlock = scopeStreamedSkeletonToCurrentWindow({
      draft: multiBlockDraft,
      plannedTargets: [target, secondTarget, "Basic chronology from 1914 to 1918"],
      estimatedMinutes: 15,
      learnerDirection: null,
    });
    const teachingSurfaces = scopedMultiBlock.activities
      .filter((activity) => activity.type === "instruction")
      .map((activity) => `${activity.title} ${activity.body}`);

    expect(teachingSurfaces).toEqual([
      `Learn ${idea} Focus on this relationship: ${idea}`,
      `Learn ${secondIdea} Focus on this relationship: ${secondIdea}`,
    ]);
    expect(new Set(teachingSurfaces).size).toBe(teachingSurfaces.length);
  });

  it("keeps a truly questionless intermediate skeleton invalid after scoping", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const idea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [idea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const outputParsed = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "This malformed provider shape has teaching but no learner knowledge-producing attempt.",
      coverage: {
        focus: "Explain why alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [idea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: idea, activityConcept: "Prewar alliance pressure" }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Producing the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested the July Crisis first."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 8,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before explaining the active relationship from memory.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: null,
          methodPhase: "reflect",
          estimatedMinutes: 2,
          requiredForCompletion: false,
          label: "Reflect",
          title: "Notice the relationship",
          body: "Notice which alliance commitment makes the local crisis more likely to involve another power.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check this relationship again",
          body: "YOVA will bring this relationship back later for a short retrieval check without reopening the lesson.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: outputParsed,
      plannedTargets: ["Prewar European alliances and tensions"],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first.",
    })).toThrow(/did not map any required knowledge check to an active essential idea/i);
  });

  it("replaces the sole active recognition check with bounded typed recall", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const activeTarget = "Prewar European alliances and tensions";
    const activeIdea = "Prewar European alliances and tensions made a local crisis more dangerous.";
    const laterTargets = [
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const activeBody = "Which condition made a local diplomatic crisis more likely to involve several powers?";
    const activeAnswer = "Alliance commitments";
    const activeFeedback = "Alliance commitments connected several powers before the assassination triggered the immediate crisis.";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [activeIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [topicId],
      rationale: "Teach only today's active relationships within the available time window.",
      coverage: {
        focus: "Explain why prewar alliance pressure made the July Crisis dangerous.",
        essentialIdeas: [activeIdea],
        completionEvidence: ["Explain how alliances increased escalation risk"],
        evidenceMap: [{ essentialIdea: activeIdea, activityConcept: "Prewar alliance pressure" }],
        deferredContent: laterTargets,
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain the important relationship.",
        why: "Explaining the relationship reveals whether the learner understands the escalation mechanism.",
        how: ["Study the short model once.", "Explain the relationship without reopening it."],
        completion: "Explain why alliance commitments increased escalation risk without notes.",
        personalization: ["The learner requested a bounded opening focus; remaining plan content stays scheduled."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 8,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the prewar pressure model",
          body: "Study the bounded prewar model before completing the active check that follows.",
          lessonBrief,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: "Prewar alliance pressure",
          label: "Check",
          title: "Identify the prewar pressure",
          body: activeBody,
          choices: [activeAnswer, "A completed peace treaty", "A neutral trade agreement"],
          correctAnswer: activeAnswer,
          feedback: activeFeedback,
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "free_response",
          concept: "Later-war chronology",
          label: "Explain",
          title: "Explain the later-war chronology",
          body: "Explain how U.S. entry in 1917 relates to the armistice in 1918.",
          choices: [],
          correctAnswer: "U.S. entry strengthened the Allies before the 1918 armistice ended the fighting.",
          feedback: "Connect U.S. entry to the later Allied position and the armistice.",
        },
        {
          ...activityBase,
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          type: "reflection",
          concept: null,
          label: "Return",
          title: "Check the prewar relationship later",
          body: "YOVA will bring the active relationship back after a delay for a short retrieval check.",
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: [activeTarget, ...laterTargets],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    const retainedChecks = scoped.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    ));

    expect(retainedChecks).toHaveLength(1);
    expect(retainedChecks[0]).toMatchObject({
      type: "free_response",
      methodPhase: "guided_practice",
      concept: "Prewar alliance pressure",
      choices: [],
      estimatedMinutes: 3,
    });
    expect(retainedChecks[0]?.body).toBe(
      "Without notes, explain Prewar alliance pressure in one or two sentences.",
    );
    expect(retainedChecks[0]?.correctAnswer).toContain(activeIdea);
    expect(retainedChecks[0]?.feedback).toContain(activeIdea);
    expect(retainedChecks[0]?.feedback).not.toBe(activeFeedback);
    expect(retainedChecks.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(scoped.activities
      .filter((activity) => activity.requiredForCompletion)
      .reduce((total, activity) => total + activity.estimatedMinutes, 0))
      .toBeLessThanOrEqual(15);
    expect(scoped.coverage.essentialIdeas).toEqual([activeIdea]);
    expect(scoped.coverage.deferredContent).toEqual(expect.arrayContaining(laterTargets));
    expect(JSON.stringify(scoped.activities)).not.toMatch(/U\.S\. entry|later-war chronology|armistice in 1918/i);
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();

    const scopedAgain = scopeStreamedSkeletonToCurrentWindow({
      draft: scoped,
      plannedTargets: [activeTarget, ...laterTargets],
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    expect(scopedAgain.activities).toEqual(scoped.activities);
  });

  it("keeps a shortened World War I lesson inside 15 minutes without losing later plan targets", async () => {
    const {
      coverageTargetsMatch,
      validateSessionCoverageFidelity,
    } = await import("@/lib/openai/session-generator");
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      enrichStreamedLessonBriefs,
      validateStreamedLessonScope,
    } = await import("@/lib/session-generation/lesson-brief");
    const {
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      buildStatedPreferenceLessonDelivery,
    } = await import("@/lib/personalization/session-delivery-policy");
    const {
      buildSessionEvaluationCases,
    } = await import("@/evals/session-cases");

    const learnerDirection = "Teach the July Crisis cause chain first. Keep this session within 15 minutes and leave later-war topics for later sessions.";
    const evaluationCase = buildSessionEvaluationCases().find((candidate) => (
      candidate.id === "world_war_one_mapped_45_min"
    ));
    expect(evaluationCase).toBeDefined();
    const originalContext = evaluationCase!.context;
    const adjustedContext: SessionGenerationContext = {
      ...originalContext,
      session: {
        ...originalContext.session,
        estimatedMinutes: 15,
      },
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 15,
        knownTargets: [],
        note: learnerDirection,
      },
    };
    const topicId = adjustedContext.session.topicIds[0]!;
    const plannedTargets = adjustedContext.session.contentTargets ?? [];
    expect(plannedTargets).toEqual([
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ]);
    // Put the later chronology first to reproduce the provider ordering that
    // previously overrode the learner's explicit July-Crisis-first direction.
    const ideas = [
      "World War I moved through a basic chronology from 1914 to the 1918 armistice",
      "Prewar alliance tensions made the July Crisis easier to widen",
      "The Sarajevo assassination triggered alliance commitments, mobilization, and declarations of war",
    ];
    const concepts = ["1914 to 1918 chronology", "Prewar alliance tensions", "July Crisis sequence"];
    expect(coverageTargetsMatch(ideas[0]!, learnerDirection)).toBe(false);
    expect(coverageTargetsMatch(ideas[1]!, learnerDirection)).toBe(true);
    expect(coverageTargetsMatch(ideas[2]!, learnerDirection)).toBe(false);
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 2,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: null,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftSchema.parse({
      topicIds: [topicId],
      rationale: "Teach only today's bounded causal chain within the available time window.",
      coverage: {
        focus: "Build the prewar pressure and opening July Crisis cause chain.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Identify how prewar alliances increased escalation risk",
          "Explain the sequence from Sarajevo through declarations of war",
          "Place the major war years in chronological order",
        ],
        evidenceMap: ideas.map((essentialIdea, index) => ({
          essentialIdea,
          activityConcept: concepts[index]!,
        })),
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study a bounded causal model and then explain why each event led to the next.",
        why: "Reconstructing the bounded causal chain checks current understanding.",
        how: ["Study the short model once.", "Explain the causal chain without reopening it."],
        completion: "Identify the escalation mechanism and explain the July Crisis sequence without notes.",
        personalization: ["The learner requested a bounded opening focus; remaining plan content stays scheduled."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 8,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the July Crisis cause chain",
          body: "Study the bounded opening-war model before answering the two checks that follow.",
          lessonBrief,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: concepts[1],
          label: "Check",
          title: "Identify the prewar pressure",
          body: "Which condition made a local diplomatic crisis more likely to involve several powers?",
          choices: ["Alliance commitments", "A completed peace treaty", "The 1918 armistice"],
          correctAnswer: "Alliance commitments",
          feedback: "Alliance commitments connected several powers before the assassination triggered the immediate crisis.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          estimatedMinutes: 3,
          type: "free_response",
          concept: concepts[2],
          label: "Explain",
          title: "Explain the July Crisis sequence",
          body: "Explain how the Sarajevo assassination led through alliance commitments and mobilization to declarations of war.",
          choices: [],
          correctAnswer: "The assassination triggered an ultimatum and alliance commitments, while mobilization escalated the crisis into declarations of war.",
          feedback: "A complete explanation connects the assassination, alliance commitments, mobilization, and declarations of war in order.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "multiple_choice",
          concept: concepts[0],
          label: "Later",
          title: "Check the later-war chronology",
          body: "Which event marked the end of fighting in 1918?",
          choices: ["The armistice", "The Sarajevo assassination", "The July ultimatum"],
          correctAnswer: "The armistice",
          feedback: "The November 1918 armistice ended the fighting and belongs in a later-war session.",
        },
      ],
    });

    // This is the exact paid-evaluation regression: the provider emitted only
    // whole-war chronology, even though today's authoritative 15-minute scope
    // is the prewar pressure and July Crisis sequence. Never accept it as the
    // active lesson. The repair attempt must receive both exact lists.
    const chronologyOnlyDraft = {
      ...draft,
      coverage: {
        ...draft.coverage,
        essentialIdeas: [ideas[0]!],
        completionEvidence: ["Place the major war years in chronological order"],
        evidenceMap: [{
          essentialIdea: ideas[0]!,
          activityConcept: concepts[0]!,
        }],
        deferredContent: [],
      },
      activities: draft.activities.filter((activity) => (
        activity.type === "instruction" || activity.concept === concepts[0]
      )),
    };

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft: chronologyOnlyDraft,
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection,
    })).toThrow(new RegExp(
      "Active targets that must be taught and checked now:.*Prewar European alliances and tensions.*Sequence from the Sarajevo assassination to declarations of war.*Later targets that must remain exact entries in deferredContent:.*Basic chronology from 1914 to 1918",
      "i",
    ));

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets,
      estimatedMinutes: 15,
      learnerDirection,
    });
    const delivery = buildStatedPreferenceLessonDelivery({
      learnerProfile: null,
      estimatedMinutes: 15,
      taskType: "conceptual_learning",
    });
    const finalized = enrichStreamedLessonBriefs(scoped, {
      sessionTopicIds: [topicId],
      materials: [],
      knowledgeTopics: adjustedContext.knowledgeTopics,
      conceptSignals: [],
      taskType: "conceptual_learning",
      deliveryInstructions: delivery.instructions,
    });
    const session = {
      ...adjustedContext.session,
      completionEvidence: adjustedContext.session.completionEvidence,
    };

    expect(finalized.coverage.essentialIdeas).toHaveLength(2);
    expect(finalized.coverage.essentialIdeas.join(" ")).toMatch(/Sarajevo|July Crisis/i);
    expect(finalized.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    )).length).toBeLessThanOrEqual(2);
    expect(finalized.activities.some((activity) => activity.type === "multiple_choice")).toBe(false);
    expect(finalized.activities.some((activity) => activity.type === "free_response")).toBe(true);
    expect(finalized.activities
      .filter((activity) => activity.requiredForCompletion)
      .reduce((total, activity) => total + activity.estimatedMinutes, 0))
      .toBeLessThanOrEqual(15);
    for (const target of plannedTargets) {
      expect([
        ...finalized.coverage.essentialIdeas,
        ...finalized.coverage.deferredContent,
      ].some((item) => coverageTargetsMatch(item, target))).toBe(true);
    }
    expect(finalized.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
    expect(finalized.coverage.completionEvidence.join(" ")).not.toMatch(/1914 to 1918|later-war|armistice/i);
    expect(JSON.stringify(finalized.activities)).not.toMatch(/later-war chronology|1914 to 1918 chronology|end of fighting in 1918/i);
    expect(validateSessionCoverageFidelity(finalized, session)).toBeNull();
    expect(validateStreamedLessonScope(finalized, {
      sessionTopicIds: [topicId],
      sessionObjective: session.objective,
      sessionContentTargets: plannedTargets,
      sessionEstimatedMinutes: 15,
      learnerDirection,
    })).toBeNull();
  });

  it("canonicalizes deferred World War I facts out of metadata, choices, and the scheduled return", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
      StreamedGeneratedSessionDraftSchema,
    } = await import("@/lib/session-generation/schema");
    const {
      validateSessionCompletionContract,
    } = await import("@/lib/session-generation/completion-contract");
    const {
      validateStreamedLessonScope,
    } = await import("@/lib/session-generation/lesson-brief");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const ideas = [
      "Prewar European alliances and tensions made a local crisis more dangerous.",
      "The Sarajevo assassination triggered mobilization and declarations of war.",
      "U.S. entry in 1917 preceded the 1918 armistice in the full World War I chronology.",
    ];
    const concepts = ["Prewar escalation pressure", "July Crisis sequence", "Later-war chronology"];
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: ideas,
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const activityBase = {
      topicId,
      estimatedMinutes: 3,
      requiredForCompletion: true,
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
    };
    const draft = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Survey the full chronology through U.S. entry and the 1918 armistice before checking the whole war.",
      coverage: {
        focus: "Explain the prewar pressure, U.S. entry, and the 1918 armistice in one whole-war chronology.",
        essentialIdeas: ideas,
        completionEvidence: [
          "Explain prewar escalation pressure without notes",
          "Explain the July Crisis sequence, then add one 1914 to 1918 landmark from memory",
        ],
        evidenceMap: ideas.map((essentialIdea, index) => ({
          essentialIdea,
          activityConcept: concepts[index]!,
        })),
        deferredContent: [targets[2]],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Whole-war self-explanation",
        what: "Study the full World War I chronology through U.S. entry and the armistice.",
        why: "Explaining the later-war chronology checks understanding of U.S. entry and the armistice.",
        how: ["Review U.S. entry in 1917.", "Explain how the 1918 armistice ended the later war."],
        completion: "Explain U.S. entry, the armistice, and the full 1914 to 1918 chronology.",
        personalization: ["The session surveys U.S. entry and the armistice before returning to the July Crisis."],
      },
      sourceGrounding: null,
      activities: [
        {
          ...activityBase,
          methodPhase: "model",
          estimatedMinutes: 7,
          type: "instruction",
          concept: null,
          label: "Learn",
          title: "Build the World War I opening map",
          body: "Study the bounded opening-war model before answering the two checks that follow.",
          lessonBrief,
          practiceIntent: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          ...activityBase,
          methodPhase: "guided_practice",
          type: "multiple_choice",
          concept: concepts[0],
          label: "Check",
          title: "Identify the prewar pressure",
          body: "Which condition made a local crisis more likely to involve several powers?",
          choices: ["Imperial competition", "Armistice", "Sarajevo assassination", "Mobilization"],
          correctAnswer: "Imperial competition",
          feedback: "Competition and alliance commitments increased pressure before the immediate crisis.",
        },
        {
          ...activityBase,
          methodPhase: "explain",
          type: "multiple_choice",
          concept: concepts[1],
          label: "Check",
          title: "Identify the immediate trigger",
          body: "Which event triggered the July Crisis?",
          choices: ["Sarajevo assassination", "U.S. entry", "Armistice", "Ultimatum crisis"],
          correctAnswer: "Sarajevo assassination",
          feedback: "The assassination triggered the ultimatum crisis and the escalation that followed.",
        },
        {
          ...activityBase,
          methodPhase: "independent_practice",
          type: "multiple_choice",
          concept: concepts[2],
          label: "Later",
          title: "Identify the later-war ending",
          body: "Which event ended the fighting in 1918 after U.S. entry?",
          choices: ["The armistice", "The Battle of the Somme", "The Treaty of Brest-Litovsk"],
          correctAnswer: "The armistice",
          feedback: "The 1918 armistice ended the fighting after U.S. entry in 1917.",
        },
        {
          ...activityBase,
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          type: "reflection",
          concept: null,
          label: "Return",
          title: "Return to the timeline",
          body: "Then add one 1914 to 1918 landmark from memory.",
          practiceIntent: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    const scoped = scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: targets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis cause chain first and leave later-war topics for later sessions.",
    });
    const activeSurface = JSON.stringify({
      activities: scoped.activities,
      completionEvidence: scoped.coverage.completionEvidence,
    });

    expect(scoped.activities.filter((activity) => (
      activity.requiredForCompletion
      && (activity.type === "multiple_choice" || activity.type === "free_response")
    )).every((activity) => activity.type === "free_response")).toBe(true);
    expect(activeSurface).not.toMatch(/U\.S\. entry|armistice|1914 to 1918 landmark/i);
    expect(scoped.activities.find((activity) => activity.methodPhase === "schedule_return")?.body)
      .toBe("YOVA will bring today's active ideas back after a delay for a short retrieval check.");
    expect(scoped.coverage.completionEvidence).toEqual([
      "Demonstrate Prewar escalation pressure",
      "Demonstrate July Crisis sequence",
    ]);
    expect(scoped.coverage.deferredContent).toContain("Basic chronology from 1914 to 1918");
    expect(scoped.rationale).toContain("Prewar European alliances and tensions");
    expect(scoped.rationale).toContain("Sequence from the Sarajevo assassination to declarations of war");
    expect(scoped.rationale).toContain("Later plan topics remain deferred");
    expect(scoped.methodBriefing.name).toBe("Self-explanation");
    expect(JSON.stringify({
      rationale: scoped.rationale,
      focus: scoped.coverage.focus,
      methodBriefing: scoped.methodBriefing,
    })).not.toMatch(/U\.S\. entry|armistice|full (?:World War I|1914 to 1918) chronology/i);
    expect(validateSessionCompletionContract({
      essentialIdeas: scoped.coverage.essentialIdeas,
      evidenceMap: scoped.coverage.evidenceMap,
      activities: scoped.activities,
    })).toBeNull();
    expect(validateStreamedLessonScope(scoped, {
      sessionTopicIds: [topicId],
      sessionObjective: "Explain how alliances and mobilization widened the July Crisis.",
      sessionContentTargets: targets,
      sessionEstimatedMinutes: 15,
      learnerDirection: "Teach the July Crisis first and leave later-war topics for later sessions.",
    })).toBeNull();
    expect(() => StreamedGeneratedSessionDraftSchema.parse(scoped)).not.toThrow();
  });

  it("rejects an active idea contaminated by facts fingerprinted from removed content", async () => {
    const {
      scopeStreamedSkeletonToCurrentWindow,
    } = await import("@/lib/openai/streamed-teaching-generator");
    const {
      StreamedGeneratedSessionDraftOutputSchema,
    } = await import("@/lib/session-generation/schema");

    const topicId = "10000000-0000-4000-8000-000000000001";
    const targets = [
      "Prewar European alliances and tensions",
      "Sequence from the Sarajevo assassination to declarations of war",
      "Basic chronology from 1914 to 1918",
    ];
    const contaminatedActiveIdea = "Prewar alliances and tensions shaped U.S. entry and the armistice.";
    const removedDeferredIdea = "U.S. entry in 1917 preceded the 1918 armistice in the later war.";
    const activeConcept = "Prewar escalation pressure";
    const deferredConcept = "Later-war turning points";
    const lessonBrief = {
      version: 1 as const,
      topicIds: [topicId],
      essentialIdeas: [contaminatedActiveIdea],
      sourceChunks: [],
      knowledgeSource: "model_knowledge" as const,
      evidenceContext: { confirmedGaps: [], secureKnowledge: [], priorMisconceptions: [] },
      contentRequirements: {
        teachEveryEssentialIdea: true as const,
        includeConcreteExample: true,
        includeCommonMixup: true as const,
        preservePrerequisiteOrder: true as const,
      },
    };
    const draft = StreamedGeneratedSessionDraftOutputSchema.parse({
      topicIds: [topicId],
      rationale: "Teach and check only the bounded current-session relationship.",
      coverage: {
        focus: "Explain the prewar escalation pressure.",
        essentialIdeas: [contaminatedActiveIdea, removedDeferredIdea],
        completionEvidence: ["Explain prewar escalation pressure"],
        evidenceMap: [
          { essentialIdea: contaminatedActiveIdea, activityConcept: activeConcept },
          { essentialIdea: removedDeferredIdea, activityConcept: deferredConcept },
        ],
        deferredContent: [targets[2]],
      },
      methodBriefing: {
        learningMode: "learn",
        taskType: "conceptual_learning",
        methodId: "self_explanation",
        name: "Self-explanation",
        what: "Study one bounded relationship and explain it without notes.",
        why: "Producing the relationship makes current understanding visible.",
        how: ["Study the short model once.", "Explain the active relationship from memory."],
        completion: "Explain the active relationship accurately without notes.",
        personalization: ["The session keeps the current work bounded to the available time."],
      },
      sourceGrounding: null,
      activities: [
        {
          topicId,
          methodPhase: "model",
          estimatedMinutes: 7,
          requiredForCompletion: true,
          label: "Learn",
          title: "Build the active relationship",
          body: "Study the bounded explanation before completing the active check.",
          teaching: null,
          lessonBrief,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "instruction",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
        {
          topicId,
          methodPhase: "explain",
          estimatedMinutes: 4,
          requiredForCompletion: true,
          label: "Explain",
          title: "Explain the prewar pressure",
          body: "Explain the active relationship from memory in one or two sentences.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "supported_recheck",
          misconceptionSummary: null,
          type: "free_response",
          concept: activeConcept,
          choices: [],
          correctAnswer: contaminatedActiveIdea,
          feedback: `Connect your response to this relationship: ${contaminatedActiveIdea}`,
        },
        {
          topicId,
          methodPhase: "independent_practice",
          estimatedMinutes: 3,
          requiredForCompletion: true,
          label: "Check",
          title: "Explain the later turning points",
          body: "Explain how entry in 1917 relates to the end of fighting in 1918.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: "independent_transfer",
          misconceptionSummary: null,
          type: "free_response",
          concept: deferredConcept,
          choices: [],
          correctAnswer: removedDeferredIdea,
          feedback: "Connect the 1917 entry to the later end of fighting in 1918.",
        },
        {
          topicId: null,
          methodPhase: "schedule_return",
          estimatedMinutes: 1,
          requiredForCompletion: false,
          label: "Return",
          title: "Check today's idea later",
          body: "YOVA will bring today's active relationship back after a delay.",
          teaching: null,
          lessonBrief: null,
          practiceIntent: null,
          misconceptionSummary: null,
          type: "reflection",
          concept: null,
          choices: [],
          correctAnswer: null,
          feedback: null,
        },
      ],
    });

    expect(() => scopeStreamedSkeletonToCurrentWindow({
      draft,
      plannedTargets: targets,
      estimatedMinutes: 15,
      learnerDirection: "Teach the opening cause chain first and keep later content for later sessions.",
    })).toThrow(/deferred content remained in active essential idea 1/i);
  });
});

describe("streamed free-response reference-answer repair", () => {
  it("replaces a grading rubric with the mapped World War I subject answer", async () => {
    const { repairRubricLikeFreeResponseAnswers } = await import("@/lib/openai/streamed-teaching-generator");
    const activities = [{
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Explain",
      title: "Explain the outbreak in your own words",
      body: "Explain how a local crisis widened into a European war.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept: "World War I outbreak chain",
      choices: [],
      correctAnswer: "A strong response should mention the assassination, alliances, mobilization, and declarations of war.",
      feedback: "Connect the Sarajevo assassination to alliance commitments and mobilization.",
    }];

    const repaired = repairRubricLikeFreeResponseAnswers({
      activities,
      evidenceMap: [{
        activityConcept: "World War I outbreak chain",
        essentialIdea: "The assassination of Franz Ferdinand triggered alliance commitments and mobilization, widening the conflict",
      }],
    });

    expect(repaired.repairedCount).toBe(1);
    expect(repaired.activities[0]?.correctAnswer).toBe(
      "The assassination of Franz Ferdinand triggered alliance commitments and mobilization, widening the conflict.",
    );
  });

  it("turns a mapped subject phrase into a concrete answer without relaxing validation", async () => {
    const { repairRubricLikeFreeResponseAnswers } = await import("@/lib/openai/streamed-teaching-generator");
    const activities = [{
      topicId: TOPIC_ID,
      methodPhase: "explain" as const,
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Explain",
      title: "Explain the outbreak in your own words",
      body: "Explain how a local crisis widened into a European war.",
      teaching: null,
      lessonBrief: null,
      practiceIntent: "supported_recheck" as const,
      misconceptionSummary: null,
      type: "free_response" as const,
      concept: "World War I outbreak chain",
      choices: [],
      correctAnswer: "The learner should name the relevant events in order.",
      feedback: "Connect the Sarajevo assassination to alliance commitments and mobilization.",
    }];

    const repaired = repairRubricLikeFreeResponseAnswers({
      activities,
      evidenceMap: [{
        activityConcept: "World War I outbreak chain",
        essentialIdea: "Sequence from the Sarajevo assassination through alliance commitments to declarations of war",
      }],
    });

    expect(repaired.activities[0]?.correctAnswer).toBe(
      "For World War I outbreak chain, the key idea is sequence from the Sarajevo assassination through alliance commitments to declarations of war.",
    );
  });
});

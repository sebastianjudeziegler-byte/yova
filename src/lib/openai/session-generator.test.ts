import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import {
  GeneratedSessionDraftOutputSchema,
  GeneratedSessionDraftProviderOutputSchema,
  materializeGeneratedSessionProviderOutput,
  type FilledGeneratedSessionDraft,
  type GeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());
const TEST_TOPIC_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

function learningDraft(firstPhase: "orient" | "model") {
  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: [TEST_TOPIC_ID],
    methodBriefing: {
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "self_explanation",
      name: "Self-explanation",
      what: "Build the relationship, then explain it without the model visible.",
      why: "A connected explanation gives a new learner an accurate model before an independent check.",
      how: ["Study the connected model.", "Explain the relationship in your own words."],
      completion: "Explain the relationship and answer one new question without the model visible.",
      personalization: ["You asked for a connected example before independent practice, so the session begins with one complete model."],
    },
    coverage: {
      focus: "How startup funding changes ownership and investor rights.",
      essentialIdeas: ["Funding exchanges resources now for financial rights later"],
      completionEvidence: ["Explain the tradeoff without the model visible"],
      evidenceMap: [{
        essentialIdea: "Funding exchanges resources now for financial rights later",
        activityConcept: "Funding tradeoff",
      }],
      deferredContent: [],
    },
    rationale: "Teach one connected model, then reduce support for a short explanation and application.",
    activities: [
      {
        topicId: null,
        methodPhase: firstPhase,
        concept: null,
        estimatedMinutes: 4,
        requiredForCompletion: true,
        label: "Learn",
        title: "Build the funding model",
        body: "Read the model, then close it before the next step.",
        teaching: {
          keyIdea: "Startup funding exchanges resources now for financial rights later.",
          explanation: "Investors provide money that lets a company reach milestones before its own revenue can pay for the work. In return, the company may give ownership, repayment rights, or a future claim that can convert into ownership.",
          example: null,
          commonMistake: {
            mistake: "Every funding instrument immediately gives an investor company shares.",
            correction: "Debt expects repayment, while convertible instruments may become equity later under defined terms.",
          },
        },
        type: "instruction",
        choices: [],
        correctAnswer: null,
        feedback: null,
      },
      {
        topicId: TEST_TOPIC_ID,
        methodPhase: "independent_practice",
        concept: "Funding tradeoff",
        estimatedMinutes: 4,
        requiredForCompletion: true,
        label: "Explain",
        title: "Explain the exchange",
        body: "Explain what a startup receives and what an investor may receive in return.",
        teaching: null,
        type: "free_response",
        choices: [],
        correctAnswer: "The startup receives capital now, while the investor receives ownership, repayment rights, or a future equity claim.",
        feedback: "A strong answer names both the immediate capital and the financial right given in return.",
      },
      {
        topicId: TEST_TOPIC_ID,
        methodPhase: "transfer",
        concept: "Funding tradeoff application",
        estimatedMinutes: 3,
        requiredForCompletion: true,
        label: "Apply",
        title: "Identify the investor right",
        body: "A lender gives a startup money that must be repaid with interest. What did the lender receive?",
        teaching: null,
        type: "multiple_choice",
        choices: ["A repayment right", "Immediate founder control", "A guaranteed equity stake"],
        correctAnswer: "A repayment right",
        feedback: "Debt funding gives the lender a contractual right to repayment rather than automatic ownership.",
      },
    ],
    sourceGrounding: null,
  }) as FilledGeneratedSessionDraft;
}

function appendSelfExplanationReexplain(draft: FilledGeneratedSessionDraft) {
  draft.activities.push({
    topicId: TEST_TOPIC_ID,
    methodPhase: "reexplain",
    concept: "Funding tradeoff",
    estimatedMinutes: 2,
    requiredForCompletion: true,
    label: "Explain again",
    title: "Explain the corrected exchange",
    body: "With the model closed, explain the funding exchange again after repairing the missing relationship.",
    teaching: null,
    type: "free_response",
    choices: [],
    correctAnswer: "The startup receives capital now, while the investor receives ownership, repayment rights, or a future equity claim.",
    feedback: "The second explanation should preserve both the immediate capital and the financial right given in return.",
    practiceIntent: "baseline",
    misconceptionSummary: null,
  });
}

function validStartupSelfExplanationDraft() {
  const draft = learningDraft("model");
  draft.activities[1]!.methodPhase = "explain";
  draft.activities.push({
    topicId: null,
    methodPhase: "repair",
    concept: null,
    estimatedMinutes: 1,
    requiredForCompletion: false,
    label: "Repair",
    title: "Repair the missing relationship",
    body: "Compare the explanation with the model and correct only the relationship that was missing.",
    teaching: null,
    type: "instruction",
    choices: [],
    correctAnswer: null,
    feedback: null,
    practiceIntent: null,
    misconceptionSummary: null,
  });
  appendSelfExplanationReexplain(draft);
  return draft;
}

function conceptMappingStudyContext(): SessionGenerationContext {
  const base = buildSessionEvaluationCases()
    .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
  return {
    ...base,
    learningGoal: {
      ...base.learningGoal,
      learningIntent: "study",
      studyMode: "inside_yova",
      sourceMode: "yova_generated",
    },
    session: {
      ...base.session,
      learningMode: "study",
      method: "Concept Mapping",
      methodReason: "Connect the named funding concepts with explicit factual relationships.",
      estimatedMinutes: 15,
    },
    personalization: {
      decisions: [],
      preferredMethodIds: ["concept_mapping"],
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

function conceptMappingDraft() {
  const firstRelationship = "Capital flows from the investor to the startup in exchange for a financial claim";
  const secondRelationship = "An equity claim gives the investor an ownership interest in the startup";
  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: [TEST_TOPIC_ID],
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "concept_mapping",
      name: "Concept Mapping",
      what: "Retrieve the important concepts, connect them with factual relationship phrases, and verify each link.",
      why: "Building the links makes the direction of the funding exchange visible before a separate evidence check.",
      how: ["Retrieve the concepts without notes.", "Build each named connection.", "Check and repair the links."],
      completion: "Construct both funding relationships and verify them against a separate evidence check.",
      personalization: ["The session begins with a bounded unsupported attempt before showing corrective subject content."],
    },
    coverage: {
      focus: "How startup funding connects capital, investors, and ownership claims.",
      essentialIdeas: ["Funding exchanges resources now for financial rights later"],
      completionEvidence: ["Build and verify the two factual funding relationships"],
      evidenceMap: [{
        essentialIdea: "Funding exchanges resources now for financial rights later",
        activityConcept: "Funding relationship map",
      }],
      deferredContent: [],
    },
    rationale: "Retrieve the component concepts, construct their relationships, verify the map, and repair any mismatch.",
    activities: [{
      topicId: TEST_TOPIC_ID,
      methodPhase: "retrieve",
      concept: "Funding components",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      label: "Retrieve",
      title: "Recall the funding components",
      body: "Without notes, which item is the resource a startup receives from an investor?",
      teaching: null,
      type: "multiple_choice",
      choices: ["Capital", "Ownership control", "A customer contract", "A tax refund"],
      correctAnswer: "Capital",
      feedback: "Capital is the resource supplied now; the investor receives a defined financial claim in return.",
    }, {
      topicId: TEST_TOPIC_ID,
      methodPhase: "connect",
      concept: "Funding relationship map",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Connect",
      title: "Build the funding map",
      body: "Connect the named concepts by writing the relationship requested for each link.",
      teaching: null,
      type: "free_response",
      choices: [],
      correctAnswer: `${firstRelationship}. ${secondRelationship}.`,
      feedback: "A complete map states the direction of the capital flow and identifies ownership as the equity claim.",
      methodRuntime: {
        kind: "concept_map",
        instructions: "Connect each named concept with the factual relationship phrase that answers the link prompt.",
        nodes: [
          { id: "investor", label: "Investor" },
          { id: "capital", label: "Capital" },
          { id: "startup", label: "Startup" },
          { id: "equity", label: "Equity claim" },
        ],
        connections: [{
          fromId: "investor",
          toId: "startup",
          prompt: "What flows from the investor, and what is received in return?",
          expectedRelationship: firstRelationship,
        }, {
          fromId: "equity",
          toId: "startup",
          prompt: "What factual right does an equity claim represent?",
          expectedRelationship: secondRelationship,
        }],
      },
    }, {
      topicId: TEST_TOPIC_ID,
      methodPhase: "evidence_match",
      concept: "Funding map evidence",
      estimatedMinutes: 3,
      requiredForCompletion: true,
      label: "Verify",
      title: "Verify the ownership link",
      body: "Which statement supplies evidence that the equity link in the map is correct?",
      teaching: null,
      type: "multiple_choice",
      choices: [
        "Equity represents an ownership interest",
        "Equity is a required loan repayment",
        "Equity is customer revenue",
        "Equity removes every investor right",
      ],
      correctAnswer: "Equity represents an ownership interest",
      feedback: "An equity claim represents ownership, so it supports the map link between the investor claim and the startup.",
    }, {
      topicId: null,
      methodPhase: "repair",
      concept: null,
      estimatedMinutes: 2,
      requiredForCompletion: false,
      label: "Repair",
      title: "Repair one mismatched link",
      body: "Compare each link with the checked relationship and replace only a direction or claim that differs.",
      teaching: null,
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
    }],
    sourceGrounding: null,
  });
}

function pretestingLearnContext(): SessionGenerationContext {
  const base = buildSessionEvaluationCases()
    .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
  return {
    ...base,
    sessionArchitectureVersion: "filled_teaching_v1",
    session: {
      ...base.session,
      method: "Pretesting",
      methodReason: "Use one low-stakes prediction before the complete model, then check transfer on a different case.",
      estimatedMinutes: 15,
      learningMode: "learn",
    },
    personalization: {
      decisions: [],
      preferredMethodIds: ["pretesting"],
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

function pretestingDraft() {
  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: [TEST_TOPIC_ID],
    methodBriefing: {
      learningMode: "learn",
      taskType: "conceptual_learning",
      methodId: "pretesting",
      name: "Pretesting",
      what: "Make one low-stakes prediction before instruction, study the complete model, and answer a different transfer prompt.",
      why: "The prediction activates relevant prior knowledge without treating an uninstructed answer as evidence of mastery.",
      how: ["Make one diagnostic prediction.", "Study the complete subject model.", "Apply it to a different case."],
      completion: "Complete the diagnostic prediction and explain the funding exchange in a different transfer case.",
      personalization: ["YOVA is using the current task and session objective as the starting point until your completed work provides more evidence."],
    },
    coverage: {
      focus: "How startup funding exchanges immediate capital for a defined financial claim.",
      essentialIdeas: ["Funding exchanges resources now for financial rights later"],
      completionEvidence: ["Explain the funding exchange in a different case after studying the model"],
      evidenceMap: [{
        essentialIdea: "Funding exchanges resources now for financial rights later",
        activityConcept: "Funding transfer",
      }],
      deferredContent: [],
    },
    rationale: "Use a diagnostic prediction only to activate prior knowledge, then teach the model and require transfer on a different case.",
    activities: [{
      topicId: TEST_TOPIC_ID,
      methodPhase: "pretest",
      concept: "Funding prediction",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      label: "Predict",
      title: "Make a low-stakes diagnostic prediction",
      body: "Before instruction, predict what an investor most commonly receives when providing equity capital to a startup.",
      teaching: null,
      type: "multiple_choice",
      choices: ["An ownership interest", "A guaranteed customer contract", "Automatic founder control", "A tax refund"],
      correctAnswer: "An ownership interest",
      feedback: "This diagnostic prediction activates the relationship; it is not prior-mastery evidence, and the complete model follows next.",
    }, {
      topicId: null,
      methodPhase: "model",
      concept: null,
      estimatedMinutes: 5,
      requiredForCompletion: true,
      label: "Learn",
      title: "Study the complete funding model",
      body: "Study the exchange, then close the model before applying it to a different case.",
      teaching: {
        keyIdea: "Startup funding exchanges resources now for a defined financial claim later.",
        explanation: "An investor supplies capital that lets a startup pay for work before its own revenue covers the cost. In return, the startup grants a defined financial claim, such as an ownership interest, a repayment right, or a future right that can convert into equity.",
        example: {
          setup: "An investor provides USD 100,000 in exchange for newly issued shares.",
          steps: [
            "The capital moves from the investor to the startup.",
            "The shares give the investor an ownership interest in return.",
          ],
          takeaway: "The resource and the financial claim move in opposite directions as part of one exchange.",
        },
        commonMistake: null,
      },
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
    }, {
      topicId: TEST_TOPIC_ID,
      methodPhase: "transfer",
      concept: "Funding recognition",
      estimatedMinutes: 2,
      requiredForCompletion: true,
      label: "Recall",
      title: "Recognize the exchange in a new case",
      body: "After studying the model, identify the financial claim created when a lender supplies capital under a loan agreement.",
      teaching: null,
      type: "multiple_choice",
      choices: ["A repayment right", "Automatic ownership control", "A customer contract", "A tax refund"],
      correctAnswer: "A repayment right",
      feedback: "Debt funding creates a contractual repayment claim rather than an ownership interest or operating contract.",
    }, {
      topicId: TEST_TOPIC_ID,
      methodPhase: "transfer",
      concept: "Funding transfer",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Apply",
      title: "Transfer the model to debt funding",
      body: "A lender supplies capital under a loan agreement. Explain what moves to the startup and what financial claim moves to the lender.",
      teaching: null,
      type: "free_response",
      choices: [],
      correctAnswer: "Capital moves to the startup, while a contractual repayment right moves to the lender.",
      feedback: "A complete transfer answer names the immediate capital and the lender's repayment claim without turning it into ownership.",
    }],
    sourceGrounding: null,
  });
}

function oversizedStudyDraft() {
  return GeneratedSessionDraftOutputSchema.parse({
    topicIds: [TEST_TOPIC_ID],
    methodBriefing: {
      learningMode: "study",
      taskType: "conceptual_learning",
      methodId: "spaced_retrieval",
      name: "Spaced retrieval",
      what: "Retrieve the target now, inspect the exposed gap, and return after a delay.",
      why: "Unsupported retrieval makes current understanding visible before a bounded correction and delayed return.",
      how: ["Answer without notes.", "Repair the exposed relationship.", "Return after a delay."],
      completion: "Complete the unsupported checks and schedule the delayed retrieval return.",
      personalization: ["The session begins with a bounded unsupported attempt before showing corrective subject content."],
    },
    coverage: {
      focus: "A deliberately oversized but structurally valid study response.",
      essentialIdeas: ["A complete subject relationship that the required retrieval question assesses"],
      completionEvidence: ["Complete the unsupported explanation"],
      evidenceMap: [{
        essentialIdea: "A complete subject relationship that the required retrieval question assesses",
        activityConcept: "Subject relationship",
      }],
      deferredContent: [],
    },
    rationale: "This fixture is structurally valid but deliberately exceeds the time budget so semantic repair is required.",
    activities: [{
      topicId: TEST_TOPIC_ID,
      methodPhase: "retrieve",
      concept: "Subject relationship",
      estimatedMinutes: 20,
      requiredForCompletion: true,
      label: "Retrieve",
      title: "Explain the relationship",
      body: "Without notes, explain the complete subject relationship and why it holds.",
      teaching: null,
      type: "free_response",
      choices: [],
      correctAnswer: "The complete subject relationship connects the relevant cause to its subject-specific effect.",
      feedback: "A complete response names both sides of the relationship and explains the causal connection between them.",
    }, {
      topicId: TEST_TOPIC_ID,
      methodPhase: "retrieve",
      concept: "Subject distinction",
      estimatedMinutes: 20,
      requiredForCompletion: true,
      label: "Check",
      title: "Distinguish the relationship",
      body: "Which option correctly states the complete subject relationship described in this session?",
      teaching: null,
      type: "multiple_choice",
      choices: ["The correct subject relationship", "A reversed relationship", "An unrelated relationship", "No relationship exists"],
      correctAnswer: "The correct subject relationship",
      feedback: "The correct choice preserves the causal direction and the subject-specific relationship required by the objective.",
    }, {
      topicId: null,
      methodPhase: "repair",
      concept: null,
      estimatedMinutes: 20,
      requiredForCompletion: true,
      label: "Repair",
      title: "Repair the relationship",
      body: "Compare the attempt with the corrected relationship and replace only the exposed gap.",
      teaching: {
        keyIdea: "The subject relationship has a specific causal direction.",
        explanation: "The corrected model identifies the relevant cause, the resulting effect, and the mechanism that connects them within the bounded subject relationship.",
        example: null,
        commonMistake: {
          mistake: "Reversing the cause and effect in the relationship.",
          correction: "Keep the cause first and connect it explicitly to the resulting subject effect.",
        },
      },
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
    }, {
      topicId: null,
      methodPhase: "schedule_return",
      concept: null,
      estimatedMinutes: 1,
      requiredForCompletion: false,
      label: "Return",
      title: "Return after a delay",
      body: "YOVA will bring this relationship back after a delay for another unsupported retrieval.",
      teaching: null,
      type: "reflection",
      choices: [],
      correctAnswer: null,
      feedback: null,
    }],
    sourceGrounding: null,
  });
}

function completedProviderResponse(id: string, output_parsed: unknown) {
  return {
    id,
    model: "gpt-yova-test",
    status: "completed",
    output_parsed: fullProviderWireFixture(output_parsed),
    usage: {
      input_tokens: 600,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 300,
    },
  };
}

function fullProviderWireFixture(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { activities?: unknown }).activities)) {
    return value;
  }
  return {
    ...value,
    activities: (value as { activities: unknown[] }).activities.map((candidate) => {
      if (!candidate || typeof candidate !== "object") return candidate;
      const activity = candidate as Record<string, unknown>;
      if (activity.type !== "multiple_choice" || !Array.isArray(activity.choices)) return activity;
      if (typeof activity.correctChoiceIndex === "number") return activity;
      if (typeof activity.correctAnswer !== "string") return activity;
      const suppliedChoices = activity.choices.filter((choice): choice is string => typeof choice === "string");
      const suppliedCorrectIndex = suppliedChoices.indexOf(activity.correctAnswer);
      if (suppliedCorrectIndex < 0) return activity;
      const choices = suppliedChoices.length <= 4
        ? [...suppliedChoices, ...Array.from(
          { length: 4 - suppliedChoices.length },
          (_, index) => `A distinct incorrect alternative ${index + 1}`,
        )]
        : suppliedCorrectIndex < 4
          ? suppliedChoices.slice(0, 4)
          : [...suppliedChoices.slice(0, 3), activity.correctAnswer];
      const correctChoiceIndex = choices.indexOf(activity.correctAnswer);
      const wireActivity = { ...activity };
      delete wireActivity.correctAnswer;
      return { ...wireActivity, choices, correctChoiceIndex };
    }),
  };
}

function scheduledCalculusQuestionSet() {
  return {
    questions: [{
      targetIndex: 0,
      title: "Estimate from a nearby interval",
      body: "For $f(x)=x^2$, which difference quotient estimates the instantaneous rate at $x=2$ using $x=2.1$?",
      choices: ["$(f(2.1)-f(2))/(2.1-2)$", "$f(2.1)-f(2)$", "$f(2)/2$", "$(2.1-2)/f(2)$"],
      correctChoiceIndex: 0,
      feedback: "The difference quotient divides the nearby output change by the corresponding input change.",
    }, {
      targetIndex: 0,
      title: "Interpret the estimate",
      body: "For $f(x)=x^2$, a nearby-interval slope at $x=2$ is about $4.1$. What does it estimate?",
      choices: ["Instantaneous rate near $x=2$", "The value $f(2)$", "The interval width", "Average output"],
      correctChoiceIndex: 0,
      feedback: "A secant slope over a small interval estimates the tangent slope at the target input.",
    }, {
      targetIndex: 0,
      title: "Use a closer interval",
      body: "For $f(x)=x^2$, which nearby input would usually refine the rate estimate at $x=2$?",
      choices: ["$2.01$", "$3$", "$10$", "$-2$"],
      correctChoiceIndex: 0,
      feedback: "A closer input creates a smaller interval and usually a better tangent-slope estimate.",
    }],
  };
}

function compactBioRecoveryContent() {
  return {
    targetClaims: [
      "Cells transfer energy by coupling energy-releasing reactions to energy-requiring cellular work.",
      "ATP hydrolysis can make a coupled cellular process favorable without creating new energy.",
    ],
    topicChecks: [{
      title: "Explain cellular energy transfer",
      prompt: "Without notes, explain how cells transfer usable energy into energy-requiring work.",
      choices: [
        "Cells couple energy-releasing reactions to energy-requiring work",
        "Cells create new energy whenever work is required",
        "Cells use only heat released by spontaneous reactions",
        "Cells permanently store all usable energy in glucose",
      ],
      correctChoiceIndex: 0,
      referenceAnswer: "Cells couple energy released by favorable reactions to specific energy-requiring cellular work.",
      feedback: "A complete explanation connects a favorable reaction to the cellular process it drives.",
    }, {
      title: "Check ATP coupling",
      prompt: "Which statement correctly explains how ATP hydrolysis can drive an energy-requiring reaction?",
      choices: [
        "The reactions are coupled so the combined free-energy change is favorable",
        "ATP hydrolysis raises activation energy until the reaction proceeds",
        "ATP stores heat that directly becomes cellular work",
        "ATP hydrolysis creates energy that did not previously exist",
      ],
      correctChoiceIndex: 0,
      referenceAnswer: "Coupling ATP hydrolysis to an energy-requiring reaction can make the combined free-energy change favorable.",
      feedback: "Coupling transfers usable free energy; it does not create energy or raise activation energy.",
    }],
    independentExtension: null,
    subjectModel: {
      keyIdea: "Cells transfer usable energy by coupling reactions, often through ATP hydrolysis.",
      explanation: "A favorable reaction such as ATP hydrolysis can be chemically coupled to energy-requiring cellular work so the combined process is favorable.",
      commonMistake: "ATP hydrolysis creates new energy for the cell.",
      correction: "ATP transfers usable free energy through a coupled reaction; it does not create energy.",
    },
    modelExample: null,
  };
}

function economicsLearnContext(): SessionGenerationContext {
  const base = buildSessionEvaluationCases()
    .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
  const topicIds = [
    "61111111-1111-4111-8111-111111111111",
    "62222222-2222-4222-8222-222222222222",
    "63333333-3333-4333-8333-333333333333",
  ];
  const targets = [
    "Own-price movement along a demand curve",
    "Own-price movement along a supply curve",
    "Non-price determinants that shift demand or supply",
  ];
  return {
    ...base,
    sessionArchitectureVersion: "filled_teaching_v1",
    learningGoal: {
      ...base.learningGoal,
      title: "Understand supply and demand curve changes",
      topic: "Explain movements along demand and supply curves and shifts caused by non-price determinants",
      sourceMode: "yova_generated",
      studyMode: "outside_yova",
      learningIntent: "learn",
    },
    materials: [],
    knowledgeTopics: targets.map((target, index) => ({
      id: topicIds[index]!,
      title: target,
      description: target,
      subtopics: [],
      prerequisiteTopicIds: index === 0 ? [] : [topicIds[index - 1]!],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
    })),
    session: {
      ...base.session,
      title: "Explain curve movements and shifts",
      objective: "Learn and explain own-price movements along demand and supply curves, then predict shifts from income and input costs.",
      method: "Self-explanation",
      methodReason: "Build an accurate causal model before independent explanation.",
      estimatedMinutes: 25,
      learningMode: "learn",
      topicIds,
      contentTargets: targets,
      deferredContentTargets: [],
      completionEvidence: [
        "Explain an own-price movement along demand.",
        "Explain an own-price movement along supply.",
        "Predict one demand shift and one supply shift.",
      ],
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

async function expectCompleteValidatorPass(
  draft: GeneratedSessionDraft,
  context: SessionGenerationContext,
  expectedSuggestedMethod: "retrieval_practice" | "self_explanation" | "spaced_retrieval" | "worked_example_fading" = "retrieval_practice",
) {
  const { buildLearningScienceRoutingBrief } = await import("@/lib/learning/method-router");
  const { sessionRoutingInput } = await import("@/lib/learning/session-routing-input");
  const {
    applyPersonalizedMethodTieToRouting,
    personalizationDecisions,
  } = await import("@/lib/personalization/personalization-generation");
  const { buildSessionDeliveryPolicy } = await import("@/lib/personalization/session-delivery-policy");
  const { validateGeneratedSessionWithCode } = await import("@/lib/openai/session-generator");
  const routing = applyPersonalizedMethodTieToRouting(
    buildLearningScienceRoutingBrief(sessionRoutingInput(context)),
    context.personalization,
    context.studyRoute?.approach.primaryMethodId,
  );
  const deliveryPolicy = buildSessionDeliveryPolicy({
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    recentInterruptions: context.recentInterruptions,
    learningMode: context.session.learningMode,
    estimatedMinutes: context.session.estimatedMinutes,
    personalizationDecisions: personalizationDecisions(context.personalization, routing),
  });
  const authoritativeTargets = draft.coverage.essentialIdeas.map((essentialIdea, index) => ({
    essentialIdea,
    target: context.session.contentTargets![index]!,
  }));

  expect(routing.suggestedPrimaryMethodId).toBe(expectedSuggestedMethod);
  expect(routing.allowedMethodIds).toContain(draft.methodBriefing.methodId);
  expect(validateGeneratedSessionWithCode(
    draft,
    context,
    routing,
    [],
    [],
    [],
    deliveryPolicy,
    authoritativeTargets,
  )).toBeNull();
}

describe("substantive teaching validation", () => {
  it("materializes provider-owned choice indexes into exact canonical answers", () => {
    const canonical = learningDraft("model");
    const wire = GeneratedSessionDraftProviderOutputSchema.parse(fullProviderWireFixture(canonical));
    const wireAnswer = wire.activities.find((activity) => activity.type === "multiple_choice");
    expect(wireAnswer?.type).toBe("multiple_choice");
    if (wireAnswer?.type !== "multiple_choice") return;
    const materialized = materializeGeneratedSessionProviderOutput(wire);
    const answer = materialized.activities.find((activity) => activity.type === "multiple_choice");

    expect(answer).toMatchObject({
      type: "multiple_choice",
      choices: expect.any(Array),
    });
    expect(answer?.type === "multiple_choice" ? answer.correctAnswer : null).toBe(
      wireAnswer?.type === "multiple_choice" ? wireAnswer.choices[wireAnswer.correctChoiceIndex] : null,
    );
    expect(answer).not.toHaveProperty("correctChoiceIndex");
    expect(GeneratedSessionDraftOutputSchema.safeParse(materialized).success).toBe(true);

    for (const correctChoiceIndex of [0, 1, 2, 3]) {
      const indexedWire = structuredClone(wire);
      const indexedAnswer = indexedWire.activities.find((activity) => activity.type === "multiple_choice");
      expect(indexedAnswer?.type).toBe("multiple_choice");
      if (indexedAnswer?.type !== "multiple_choice") continue;
      indexedAnswer.correctChoiceIndex = correctChoiceIndex;
      const indexedCanonical = materializeGeneratedSessionProviderOutput(indexedWire);
      const canonicalAnswer = indexedCanonical.activities.find((activity) => activity.type === "multiple_choice");
      expect(canonicalAnswer?.type === "multiple_choice" ? canonicalAnswer.correctAnswer : null)
        .toBe(indexedAnswer.choices[correctChoiceIndex]);
    }

    const invalidIndex = structuredClone(wire) as unknown as Record<string, unknown>;
    const invalidActivities = invalidIndex.activities as Array<Record<string, unknown>>;
    const invalidAnswer = invalidActivities.find((activity) => activity.type === "multiple_choice");
    if (invalidAnswer) invalidAnswer.correctChoiceIndex = 4;
    expect(GeneratedSessionDraftProviderOutputSchema.safeParse(invalidIndex).success).toBe(false);
  });

  it("keeps cross-field misses out of the provider parser and in YOVA's final validator", () => {
    const draft = structuredClone(learningDraft("model"));
    draft.activities[0]!.teaching = null;
    draft.activities[0]!.methodRuntime = {
      kind: "retrieval_round",
      sourceClosedReminder: "Close the source before recalling the idea.",
      prompts: [
        {
          prompt: "Recall the central relationship.",
          expectedAnswer: "The central relationship in a complete sentence.",
          hint: "Use the relationship named in the lesson.",
        },
        {
          prompt: "Explain why the relationship matters.",
          expectedAnswer: "It connects the mechanism to the observed result.",
          hint: null,
        },
      ],
    };
    const providerCandidate = GeneratedSessionDraftProviderOutputSchema.safeParse(fullProviderWireFixture(draft));
    expect(providerCandidate.success).toBe(true);
    if (!providerCandidate.success) return;
    const finalCandidate = materializeGeneratedSessionProviderOutput(providerCandidate.data);
    const multipleChoice = finalCandidate.activities.find((activity) => activity.type === "multiple_choice");
    expect(multipleChoice).toBeDefined();
    if (multipleChoice?.type === "multiple_choice") {
      multipleChoice.correctAnswer = "An answer omitted from the choices";
    }
    const final = GeneratedSessionDraftOutputSchema.safeParse(finalCandidate);

    expect(final.success).toBe(false);
    if (final.success) return;
    expect(final.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "custom",
        path: ["activities", 0, "teaching"],
        message: "Model activities need a structured teaching block.",
      }),
      expect.objectContaining({
        code: "custom",
        path: ["activities", 0, "methodRuntime", "prompts"],
        message: "The legacy retrieval prompt set requires 3 to 10 prompts.",
      }),
      expect.objectContaining({
        code: "custom",
        path: ["activities", 2, "correctAnswer"],
        message: "The correct answer must exactly match one choice.",
      }),
    ]));
  });

  it("accepts a substantive opening teaching block tagged as orientation", async () => {
    const { validateSubstantiveTeaching } = await import("@/lib/openai/session-generator");
    expect(validateSubstantiveTeaching(learningDraft("orient"))).toBeNull();
  });

  it("accepts the same teaching block when the method tags it as a model", async () => {
    const { validateSubstantiveTeaching } = await import("@/lib/openai/session-generator");
    expect(validateSubstantiveTeaching(learningDraft("model"))).toBeNull();
  });

  it("rejects a model phase attached to a question before normalization can discard its teaching", () => {
    const draft = structuredClone(learningDraft("model"));
    draft.activities[0]!.methodPhase = "orient";
    draft.activities[1]!.methodPhase = "model";
    draft.activities[1]!.teaching = structuredClone(draft.activities[0]!.teaching);

    const parsed = GeneratedSessionDraftOutputSchema.safeParse(draft);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: ["activities", 1, "methodPhase"],
        message: "Only instruction activities may use the model phase.",
      }),
      expect.objectContaining({
        path: ["activities", 1, "teaching"],
        message: "Only instruction activities may carry a teaching block.",
      }),
    ]));
  });
});

describe("full guided-session structural repair failures", () => {
  it("never leaks a raw SDK ZodError when both the first response and its repair fail parsing", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const fullGeneratorContext = {
      ...context!,
      learningGoal: { ...context!.learningGoal, studyMode: "outside_yova" as const },
    };
    const invalidResponse = GeneratedSessionDraftProviderOutputSchema.safeParse({});
    expect(invalidResponse.success).toBe(false);
    if (invalidResponse.success) return;
    parseResponse
      .mockRejectedValueOnce(invalidResponse.error)
      .mockRejectedValueOnce(invalidResponse.error);

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(fullGeneratorContext)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        firstAttemptPassed: false,
        failedValidator: "session_structure",
        repairAttempted: true,
        repairSucceeded: false,
        repairReason: "structured_output",
        inputTokens: 0,
        outputTokens: 0,
        validationIssueCode: "session_full_structure",
      },
      structuralDiagnostic: {
        stage: "provider_repair_parse",
        issueCount: invalidResponse.error.issues.length,
        issues: expect.arrayContaining([
          { code: "invalid_type", path: ["topicIds"] },
        ]),
        truncated: invalidResponse.error.issues.length > 12,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("preserves completed-attempt usage when the repair response throws an SDK ZodError", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const fullGeneratorContext = {
      ...context!,
      learningGoal: { ...context!.learningGoal, studyMode: "outside_yova" as const },
    };
    const invalidRepair = GeneratedSessionDraftProviderOutputSchema.safeParse({});
    expect(invalidRepair.success).toBe(false);
    if (invalidRepair.success) return;
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-full-study", {}))
      .mockRejectedValueOnce(invalidRepair.error);

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(fullGeneratorContext)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        firstAttemptPassed: false,
        failedValidator: "session_structure",
        repairAttempted: true,
        repairSucceeded: false,
        repairReason: "structured_output",
        inputTokens: 600,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 300,
        validationIssueCode: "session_full_structure",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("preserves the final strict-parse issue paths after bounded repairs fail", async () => {
    parseResponse.mockReset();
    const context: SessionGenerationContext = {
      ...economicsLearnContext(),
      sessionAdjustment: {
        familiarity: "as_planned",
        availableMinutes: 15,
        knownTargets: [],
        note: "Keep this fixture ineligible for bounded recovery.",
      },
    };
    const invalidDraft = learningDraft("model");
    invalidDraft.activities[0]!.teaching = null;
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("strict-initial", invalidDraft))
      .mockResolvedValueOnce(completedProviderResponse("strict-repair", invalidDraft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        failedValidator: "session_structure",
        repairAttempted: true,
        repairSucceeded: false,
        repairReason: "structured_output",
        stage: "validation",
        cause: "invalid_structure",
        validationIssueCode: "session_full_structure",
      },
      structuralDiagnostic: {
        stage: "draft_repair_parse",
        issueCount: expect.any(Number),
        issues: expect.arrayContaining([
          { code: "custom", path: ["activities", 0, "teaching"] },
        ]),
        truncated: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });
});

describe("concept-mapping full generation", () => {
  it("keeps the dedicated connect runtime and its exact relationships in a cache-safe output", async () => {
    parseResponse.mockReset();
    const draft = conceptMappingDraft();
    parseResponse.mockResolvedValueOnce(completedProviderResponse("concept-map-valid", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(conceptMappingStudyContext());
    const cachedDraft = GeneratedSessionDraftOutputSchema.parse(
      JSON.parse(JSON.stringify(result.draft)),
    );
    const mapActivity = cachedDraft.activities.find((activity) => activity.methodRuntime?.kind === "concept_map");

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.generationStats.attempts).toBe(1);
    expect(mapActivity).toMatchObject({ type: "free_response", methodPhase: "connect" });
    expect(mapActivity?.methodRuntime?.kind).toBe("concept_map");
    if (mapActivity?.methodRuntime?.kind !== "concept_map") return;
    for (const connection of mapActivity.methodRuntime.connections) {
      expect(mapActivity.correctAnswer).toContain(connection.expectedRelationship);
    }
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).toMatch(
      /concept_map runtime belongs only on the free_response activity tagged methodPhase connect/i,
    );
  });

  it.each(["missing", "mismatched"] as const)(
    "routes a %s concept-map runtime through one bounded repair",
    async (invalidKind) => {
      parseResponse.mockReset();
      const invalid = conceptMappingDraft();
      const connectActivity = invalid.activities.find((activity) => activity.methodPhase === "connect")!;
      connectActivity.methodRuntime = invalidKind === "missing"
        ? null
        : {
          kind: "error_repair",
          observedError: "The learner reversed the direction of the funding exchange.",
          whyItSeemedReasonable: "Both parties receive something, so the direction can look interchangeable.",
          incorrectRule: "Capital and ownership always move in the same direction.",
          correctRule: "Capital and the financial claim move in opposite directions.",
          warningSign: "The map gives both resources to the same party.",
          correctedExample: "An investor gives capital to a startup and receives an equity claim in return.",
          parallelPrompt: "Map the direction of capital and the financial claim in a new funding example.",
          parallelAnswer: "Capital moves to the startup, while the financial claim moves to the investor.",
        };
      const repaired = conceptMappingDraft();
      parseResponse
        .mockResolvedValueOnce(completedProviderResponse(`concept-map-${invalidKind}`, invalid))
        .mockResolvedValueOnce(completedProviderResponse(`concept-map-${invalidKind}-repair`, repaired));

      const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
      const result = await generateSessionWithOpenAI(conceptMappingStudyContext());

      expect(parseResponse).toHaveBeenCalledTimes(2);
      expect(parseResponse.mock.calls[1]?.[0]?.instructions).toMatch(
        invalidKind === "missing"
          ? /dedicated relationship-building runtime/i
          : /uses concept_map/i,
      );
      expect(result.generationStats).toMatchObject({
        attempts: 2,
        firstAttemptPassed: false,
        failedValidator: "session_method_runtime",
        repairAttempted: true,
        repairSucceeded: true,
        repairReason: "semantic_validation",
      });
    },
  );
});

describe("pretesting full generation", () => {
  it("keeps the diagnostic pretest before the complete model in a cache-safe output", async () => {
    parseResponse.mockReset();
    parseResponse.mockResolvedValueOnce(completedProviderResponse("pretesting-valid", pretestingDraft()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(pretestingLearnContext());
    const cachedDraft = GeneratedSessionDraftOutputSchema.parse(
      JSON.parse(JSON.stringify(result.draft)),
    );

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(cachedDraft.methodBriefing.methodId).toBe("pretesting");
    expect(cachedDraft.activities.map((activity) => activity.methodPhase)).toEqual([
      "pretest",
      "model",
      "transfer",
      "transfer",
    ]);
    expect(cachedDraft.activities[0]).toMatchObject({
      type: "multiple_choice",
      teaching: null,
      methodPhase: "pretest",
    });
    expect(cachedDraft.activities[1]).toMatchObject({
      type: "instruction",
      methodPhase: "model",
      teaching: expect.objectContaining({ keyIdea: expect.any(String) }),
    });
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).toMatch(
      /Pretesting is the sole exception.*low-stakes diagnostic pretest before the complete model/i,
    );
  });

  it("repairs a pretest whose required model has no structured teaching instead of accepting it raw", async () => {
    parseResponse.mockReset();
    const invalid = pretestingDraft();
    invalid.activities[1]!.teaching = null;
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("pretesting-missing-model", invalid))
      .mockResolvedValueOnce(completedProviderResponse("pretesting-model-repair", pretestingDraft()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(pretestingLearnContext());

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(parseResponse.mock.calls[1]?.[0]?.instructions).toMatch(
      /model-phase subject lesson|model activities need a structured teaching block/i,
    );
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      failedValidator: "session_structure",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "structured_output",
    });
  });

  it("preserves pretest, model plus outside action, and changed transfer for an outside-YOVA Learn route", async () => {
    parseResponse.mockReset();
    const base = pretestingLearnContext();
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: { ...base.learningGoal, studyMode: "outside_yova" },
    };
    const draft = pretestingDraft();
    draft.activities[1]!.body = "Study YOVA's model, then open your textbook and identify one funding exchange there. Return to YOVA for a different transfer check.";
    parseResponse.mockResolvedValueOnce(completedProviderResponse("pretesting-outside-valid", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as {
      outsideAppContract?: { learningSequence?: string; instructionTemplate?: string };
    };

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "pretest",
      "model",
      "transfer",
      "transfer",
    ]);
    expect(prompt.outsideAppContract?.learningSequence).toMatch(
      /begin with one brief, low-stakes.*diagnostic pretest.*complete YOVA model.*different transfer check/i,
    );
    expect(prompt.outsideAppContract?.instructionTemplate).toMatch(
      /First make the brief diagnostic prediction.*study YOVA's subject explanation.*different transfer check/i,
    );
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).toMatch(
      /For a learn session other than Pretesting.*Pretesting is the sole exception: open with the brief diagnostic, then provide the complete YOVA model before the external action and transfer check/i,
    );
    expect(parseResponse.mock.calls[0]?.[0]?.instructions).not.toMatch(
      /For a learn session, YOVA must still provide substantive subject teaching in the opening model instruction/i,
    );
  });
});

describe("guided-session active-recall validation", () => {
  it("does not let an optional free response satisfy the completion contract", async () => {
    const { validateStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const freeResponse = draft.activities.find((activity) => activity.type === "free_response");
    expect(freeResponse).toBeDefined();
    freeResponse!.requiredForCompletion = false;

    expect(validateStandardGuidedSessionActivityMix(draft)).toMatch(
      /completion-required typed active-recall attempt/i,
    );
    freeResponse!.requiredForCompletion = true;
    expect(validateStandardGuidedSessionActivityMix(draft)).toBeNull();
  });

  it("converts one safe required recognition check without changing its learning evidence", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    const original = draft.activities[1]!;
    draft.activities[1] = {
      ...original,
      methodPhase: "explain",
      type: "multiple_choice",
      choices: [
        original.correctAnswer!,
        "The startup receives permanent revenue without giving any financial right.",
        "The investor receives operational control without supplying resources.",
      ],
    };

    const normalized = normalizeStandardGuidedSessionActivityMix(draft, base.session);

    expect(normalized).not.toBe(draft);
    expect(normalized.activities[1]).toEqual({
      ...draft.activities[1],
      type: "free_response",
      choices: [],
      methodRuntime: null,
    });
    expect(normalized.activities[2]).toEqual(draft.activities[2]);
  });

  it("converts an explain-phase MCQ even when another typed response already exists", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    draft.activities[1]!.methodPhase = "independent_practice";
    draft.activities[2] = {
      ...draft.activities[2]!,
      methodPhase: "explain",
      title: "Explain the lender's right",
      body: "Explain what financial right the lender receives and why it is not automatic ownership.",
    };
    draft.activities.push({
      ...draft.activities[2]!,
      methodPhase: "transfer",
      requiredForCompletion: false,
      title: "Check a second funding case",
      body: "A new lender requires repayment with interest. What financial right does that arrangement create?",
    });

    const normalized = normalizeStandardGuidedSessionActivityMix(draft, base.session);

    expect(normalized.activities[1]!.type).toBe("free_response");
    expect(normalized.activities[2]).toMatchObject({
      methodPhase: "explain",
      type: "free_response",
      choices: [],
    });
    expect(normalized.activities[3]!.type).toBe("multiple_choice");
  });

  it("does not delete choices from an option-dependent prompt", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    const original = draft.activities[1]!;
    draft.activities[1] = {
      ...original,
      methodPhase: "explain",
      type: "multiple_choice",
      title: "Choose the correct statement",
      body: "Select the best answer from the choices before viewing the explanation.",
      choices: [original.correctAnswer!, "No financial exchange occurs", "The investor supplies no resources"],
    };
    draft.activities[2]!.requiredForCompletion = false;

    expect(normalizeStandardGuidedSessionActivityMix(draft, base.session)).toBe(draft);

    const answerDependent = structuredClone(draft);
    answerDependent.activities[1] = {
      ...answerDependent.activities[1]!,
      title: "Explain the funding result",
      body: "State what the startup and investor exchange in this funding arrangement.",
      choices: ["All of the above", "Capital only", "Control only"],
      correctAnswer: "All of the above",
    };
    expect(normalizeStandardGuidedSessionActivityMix(answerDependent, base.session)).toBe(answerDependent);
  });

  it.each([
    ["Which scenario best demonstrates the funding exchange?", "Which scenario best demonstrates capital exchanged for a financial right?"],
    ["Which example applies?", "Which example applies the funding relationship accurately?"],
    ["Find the explanation", "What is the best explanation of the investor's financial right?"],
    ["Check the statement", "What is the correct statement about repayment rights?"],
    ["Continue", "What happens next?"],
    ["Find the outcome", "What is the result?"],
    ["Explain", "Explain your choice."],
    ["Reason", "Explain your reasoning."],
    ["Outcome", "Describe the outcome."],
    ["Solve", "How would you solve it?"],
    ["Conclusion", "What do you conclude?"],
    ["Respond", "If this happens, what should you do?"],
    ["Continue", "Suppose this occurs. What happens?"],
    ["Situation", "Given this situation. Explain what occurs."],
  ])("fails closed for a recognition stem that still needs its choices: %s", async (title, body) => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    draft.activities[1] = {
      ...draft.activities[1]!,
      methodPhase: "explain",
      type: "multiple_choice",
      title,
      body,
      choices: [
        draft.activities[1]!.correctAnswer!,
        "The startup receives no resources.",
        "The investor receives no financial right.",
      ],
    };
    draft.activities[2]!.requiredForCompletion = false;

    expect(normalizeStandardGuidedSessionActivityMix(draft, base.session)).toBe(draft);
  });

  it("converts a contextual check only when its body ends in a self-contained open prompt", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    draft.activities[1] = {
      ...draft.activities[1]!,
      methodPhase: "explain",
      type: "multiple_choice",
      title: "Explain a lender's financial right",
      body: "A lender supplies capital that must be repaid with interest. Explain what financial right the lender receives and why it is not automatic ownership.",
      choices: [
        draft.activities[1]!.correctAnswer!,
        "The lender receives automatic ownership.",
        "The lender receives no enforceable financial right.",
      ],
    };

    expect(normalizeStandardGuidedSessionActivityMix(draft, base.session).activities[1]).toMatchObject({
      type: "free_response",
      choices: [],
    });
  });

  it("keeps scheduled retrievals multiple-choice only", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = learningDraft("model");
    draft.activities[1] = {
      ...draft.activities[1]!,
      type: "multiple_choice",
      choices: [draft.activities[1]!.correctAnswer!, "No financial right", "No resources change hands"],
    };

    expect(normalizeStandardGuidedSessionActivityMix(draft, {
      ...base.session,
      reviewType: "verify",
    })).toBe(draft);
  });

  it("preserves the retained method runtime while clearing a duplicated runtime on the converted check", async () => {
    const { normalizeStandardGuidedSessionActivityMix } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const runtime = {
      kind: "retrieval_round" as const,
      sourceClosedReminder: "Close the model before beginning this recall round.",
      prompts: [
        { prompt: "State the funding exchange.", expectedAnswer: "Capital now for a financial right later.", hint: null },
        { prompt: "Name one investor right.", expectedAnswer: "Ownership, repayment, or a future equity claim.", hint: null },
        { prompt: "Name the startup benefit.", expectedAnswer: "Resources to reach milestones before revenue pays for them.", hint: null },
      ],
    };
    const draft = learningDraft("model");
    draft.methodBriefing.methodId = "retrieval_practice";
    draft.activities.forEach((activity) => {
      activity.methodRuntime = runtime;
    });
    const original = draft.activities[1]!;
    draft.activities[1] = {
      ...original,
      methodPhase: "explain",
      type: "multiple_choice",
      choices: [original.correctAnswer!, "No resources are exchanged", "Only control is exchanged"],
    };

    const normalized = normalizeStandardGuidedSessionActivityMix(draft, base.session);

    expect(normalized.activities[0]!.methodRuntime).toEqual(runtime);
    expect(normalized.activities[1]).toMatchObject({
      type: "free_response",
      methodRuntime: null,
    });
  });
});

describe("outside-app guidance validation", () => {
  it.each([
    "Open your textbook and complete the comparison there. Bring your answer back for a short check.",
    "Open your class notes and write the two relationships there, then explain what you found.",
  ])("accepts a natural return direction: %s", async (body) => {
    const { validateOutsideAppGuidance } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.activities[0]!.body = body;

    expect(validateOutsideAppGuidance(draft, "outside_yova")).toBeNull();
  });

  it("still rejects external work with no direction to bring the learner back", async () => {
    const { validateOutsideAppGuidance } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.activities[0]!.body = "Open your textbook and complete the comparison in your notes.";

    expect(validateOutsideAppGuidance(draft, "outside_yova")).toMatch(/when to return to YOVA/i);
  });
});

describe("session content-volume validation", () => {
  it("maps explanatory Bioenergetics claims back to concise plan labels", async () => {
    const { coverageTargetsMatch } = await import("@/lib/openai/session-generator");

    expect(coverageTargetsMatch(
      "Cells couple ATP hydrolysis to energy-requiring reactions.",
      "Energy coupling and ATP",
    )).toBe(true);
  });

  it("preserves the plan's bounded completion contract instead of adding lesson requirements", async () => {
    const { boundedSessionCompletionEvidence } = await import("@/lib/openai/session-generator");

    expect(boundedSessionCompletionEvidence({
      planned: ["Draft one claim and connect one source"],
      generated: ["Draft a claim", "Match a source", "Explain the counterargument"],
      estimatedMinutes: 12,
    })).toEqual(["Draft one claim and connect one source"]);
  });

  it("requires every planned target to be covered or explicitly deferred", async () => {
    const { validateSessionCoverageFidelity } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const issue = validateSessionCoverageFidelity(draft, {
      title: "Learn funding tradeoffs",
      objective: "Connect funding to ownership and repayment rights.",
      method: "Self-explanation",
      methodReason: "Build the model before an independent check.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TEST_TOPIC_ID],
      contentTargets: [
        "Funding exchanges resources now for financial rights later",
        "Dilution changes founder ownership",
      ],
      completionEvidence: ["Explain both relationships without the model visible"],
    });

    expect(issue).toMatch(/lost planned content.*Dilution changes founder ownership/i);
    draft.coverage.deferredContent = ["Dilution changes founder ownership"];
    expect(validateSessionCoverageFidelity(draft, {
      title: "Learn funding tradeoffs",
      objective: "Connect funding to ownership and repayment rights.",
      method: "Self-explanation",
      methodReason: "Build the model before an independent check.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TEST_TOPIC_ID],
      contentTargets: [
        "Funding exchanges resources now for financial rights later",
        "Dilution changes founder ownership",
      ],
      completionEvidence: ["Explain both relationships without the model visible"],
    })).toBeNull();
  });

  it("does not count a broad financing survey as coverage of one narrow target", async () => {
    const { validateSessionCoverageFidelity } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.coverage.essentialIdeas = [
      "Dilution changes founder ownership while valuation caps, liquidation preferences, board control, debt conversion, investor exits, and later fundraising terms shape the entire startup financing lifecycle",
    ];
    draft.coverage.deferredContent = [];

    const issue = validateSessionCoverageFidelity(draft, {
      title: "Understand dilution",
      objective: "Explain how issuing shares changes founder ownership.",
      method: "Self-explanation",
      methodReason: "Build one ownership model before a check.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TEST_TOPIC_ID],
      contentTargets: ["Dilution changes founder ownership"],
      completionEvidence: ["Explain the ownership change without the model visible"],
    });

    expect(issue).toMatch(/lost planned content.*Dilution changes founder ownership/i);
  });

  it("uses plan targets as scope labels without replacing teachable explanatory claims", async () => {
    const { alignSessionCoverageWithPlan } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.coverage.essentialIdeas = [
      "Functions, limits, derivatives, and integrals form a connected calculus model",
    ];
    draft.coverage.evidenceMap = [{
      essentialIdea: "Functions, limits, derivatives, and integrals form a connected calculus model",
      activityConcept: "Funding tradeoff",
    }];
    draft.coverage.deferredContent = [
      "Read function notation, domain, evaluation, and graphs",
    ];

    const aligned = alignSessionCoverageWithPlan(draft.coverage, [
      "Relationship among functions, limits, derivatives, and integrals",
      "Function notation, evaluation, domain, and graphs",
    ]);

    expect(aligned.essentialIdeas).toEqual([
      "Functions, limits, derivatives, and integrals form a connected calculus model",
    ]);
    expect(aligned.evidenceMap[0]?.essentialIdea).toBe(
      "Functions, limits, derivatives, and integrals form a connected calculus model",
    );
    expect(aligned.deferredContent).toEqual([
      "Read function notation, domain, evaluation, and graphs",
    ]);
  });

  it("does not relabel an active current-window target as deferred", async () => {
    const { alignSessionCoverageWithPlan } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.coverage.essentialIdeas = [
      "Osmosis moves water across a selectively permeable membrane down the water-potential gradient.",
      "Hypotonic, hypertonic, and isotonic solutions determine the direction of net water movement.",
    ];
    draft.coverage.deferredContent = [
      "Tonicity and cell water movement",
      "Effects of osmosis on animal and plant cells",
    ];

    const aligned = alignSessionCoverageWithPlan(
      draft.coverage,
      ["Osmosis and water potential", "Tonicity and cell water movement"],
      ["Effects of osmosis on animal and plant cells"],
    );

    expect(aligned.deferredContent).toEqual([
      "Effects of osmosis on animal and plant cells",
    ]);
  });

  it("keeps concise target matching strict for broad neighboring content", async () => {
    const { coverageTargetsMatch } = await import("@/lib/openai/session-generator");

    expect(coverageTargetsMatch(
      "Photosynthesis and cellular respiration exchange gases and connect energy transformation",
      "Photosynthesis",
    )).toBe(false);
    expect(coverageTargetsMatch(
      "Dilution changes founder ownership while liquidation preferences and debt conversion shape financing",
      "Dilution changes founder ownership",
    )).toBe(false);
  });

  it("accepts a server-validated target id as authoritative coverage without weakening prose matching", async () => {
    const {
      validateSessionCoverageFidelity,
    } = await import("@/lib/openai/session-generator");
    const {
      lessonIdeaMatchesTarget,
    } = await import("@/lib/session-generation/lesson-brief");
    const draft = learningDraft("model");
    const target = "Prewar European alliances and tensions";
    const idea = "Before 1914, European alliances divided powers into rival armed blocs whose commitments increased the danger that a regional dispute would spread among major states.";
    draft.coverage.essentialIdeas = [idea];
    draft.coverage.deferredContent = [];
    const session = {
      title: "Baseline Check and WWI Map",
      objective: "Understand the main prewar tensions and build a simple World War I timeline.",
      method: "Self-explanation",
      methodReason: "Build the model before an independent check.",
      estimatedMinutes: 45,
      learningMode: "learn" as const,
      topicIds: [TEST_TOPIC_ID],
      contentTargets: [target],
      completionEvidence: ["Explain the prewar pressure without notes"],
    };
    expect(lessonIdeaMatchesTarget(idea, target)).toBe(false);
    expect(validateSessionCoverageFidelity(
      draft,
      session,
      lessonIdeaMatchesTarget,
    )).toMatch(/lost planned content/i);
    expect(validateSessionCoverageFidelity(
      draft,
      session,
      lessonIdeaMatchesTarget,
      [target],
    )).toBeNull();
  });

  it("limits active ideas according to the session duration", async () => {
    const { validateSessionCoverageFidelity } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.coverage.essentialIdeas = ["Idea one", "Idea two", "Idea three"];

    expect(validateSessionCoverageFidelity(draft, {
      title: "A short lesson",
      objective: "Learn a bounded cluster.",
      method: "Self-explanation",
      methodReason: "Build a model before the check.",
      estimatedMinutes: 15,
      learningMode: "learn",
      topicIds: [TEST_TOPIC_ID],
      contentTargets: [],
      completionEvidence: ["Explain the cluster"],
    })).toMatch(/at most 2 content targets/i);
  });

  it("keeps a time-deferred target out of active coverage", async () => {
    const { validateSessionCoverageFidelity } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    draft.coverage.essentialIdeas = [
      "Water moves across a selectively permeable membrane down its water-potential gradient.",
    ];
    draft.coverage.deferredContent = ["Effects of osmosis on animal and plant cells"];
    const session = {
      title: "Retrieve osmosis",
      objective: "Retrieve the bounded osmosis targets.",
      method: "Closed-note retrieval",
      methodReason: "Use an unsupported attempt before repair.",
      estimatedMinutes: 15,
      learningMode: "study" as const,
      topicIds: [TEST_TOPIC_ID],
      contentTargets: ["Osmosis and water potential"],
      deferredContentTargets: ["Effects of osmosis on animal and plant cells"],
      completionEvidence: ["Explain water movement without notes"],
    };

    expect(validateSessionCoverageFidelity(draft, session)).toBeNull();
    draft.coverage.essentialIdeas.push(
      "Animal cells may lyse while water entry creates turgor pressure in plant cells.",
    );
    expect(validateSessionCoverageFidelity(draft, session)).toMatch(/reserved for later/i);
  });

  it("scopes a shortened material-backed session and preserves the remaining target", async () => {
    const { scopeFullSessionToCurrentWindow } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const topicIds = [
      "8ec325f4-0000-4000-8000-000000000021",
      "8ec325f4-0000-4000-8000-000000000022",
      "8ec325f4-0000-4000-8000-000000000023",
    ];
    const chunkIds = [
      "8ec325f4-0000-4000-8000-000000000061",
      "8ec325f4-0000-4000-8000-000000000062",
      "8ec325f4-0000-4000-8000-000000000063",
    ];
    const materialId = "8ec325f4-0000-4000-8000-000000000060";
    const targets = [
      "Osmosis and water potential",
      "Tonicity and cell water movement",
      "Effects of osmosis on animal and plant cells",
    ];
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: {
        ...base!.learningGoal,
        title: "Biology Quiz on Osmosis",
        topic: "Osmosis, tonicity, and effects on animal and plant cells",
        sourceMode: "user_materials",
      },
      materials: targets.map((target, index) => ({
        materialId,
        chunkId: chunkIds[index]!,
        chunkIndex: index,
        name: "Osmosis notes",
        text: `Source-grounded explanation of ${target.toLocaleLowerCase()}.`,
        truncated: false,
        locationLabel: `Section ${index + 1}`,
        role: "content_source" as const,
      })),
      knowledgeTopics: targets.map((target, index) => ({
        ...base!.knowledgeTopics[0]!,
        id: topicIds[index]!,
        title: target,
        description: `Source-grounded explanation of ${target.toLocaleLowerCase()}.`,
        origin: "material" as const,
        sourceReferences: [{
          materialId,
          chunkId: chunkIds[index]!,
          chunkIndex: index,
          startCharacter: 0,
          endCharacter: 100,
          locationLabel: `Section ${index + 1}`,
          sectionRole: "content_source" as const,
        }],
      })),
      session: {
        ...base!.session,
        title: "Retrieve and apply osmosis",
        objective: "Retrieve and apply Osmosis and water potential, Tonicity and cell water movement, Effects of osmosis on animal and plant cells without notes, then repair only the gap the attempt reveals.",
        estimatedMinutes: 25,
        topicIds,
        contentTargets: targets,
        completionEvidence: targets.map((target) => `Explain ${target} without notes.`),
      },
      sessionAdjustment: {
        familiarity: "as_planned",
        availableMinutes: 15,
        knownTargets: [],
        note: "",
      },
    };

    const scoped = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment(context),
    );

    expect(scoped.session.estimatedMinutes).toBe(15);
    expect(scoped.session.contentTargets).toEqual(targets.slice(0, 2));
    expect(scoped.session.deferredContentTargets).toEqual([targets[2]]);
    expect(scoped.session.topicIds).toEqual(topicIds.slice(0, 2));
    expect(scoped.knowledgeTopics.map((topic) => topic.id)).toEqual(topicIds.slice(0, 2));
    expect(scoped.materials.map((material) => material.chunkId)).toEqual(chunkIds.slice(0, 2));
    expect(scoped.session.completionEvidence).toHaveLength(2);
    expect(scoped.session.objective).not.toContain(targets[2]!);

    const reordered = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment({
        ...context,
        session: {
          ...context.session,
          topicIds: [topicIds[2]!, topicIds[0]!, topicIds[1]!],
        },
      }),
    );
    expect(reordered.session.contentTargets).toEqual(targets.slice(0, 2));
    expect(reordered.session.topicIds).toEqual([topicIds[0], topicIds[1]]);
    expect(reordered.knowledgeTopics.map((topic) => topic.id)).toEqual(topicIds.slice(0, 2));

    const directed = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment({
        ...context,
        sessionAdjustment: {
          ...context.sessionAdjustment!,
          note: `Focus this attempt on ${targets[2]}.`,
        },
      }),
    );
    expect(directed.session.contentTargets).toEqual(targets.slice(1));
    expect(directed.session.deferredContentTargets).toEqual([targets[0]]);
    expect(directed.session.topicIds).toEqual(topicIds.slice(1));
    expect(directed.materials.map((material) => material.chunkId)).toEqual(chunkIds.slice(1));
    expect(directed.session.completionEvidence).toEqual([
      `Explain ${targets[1]} without notes.`,
      `Explain ${targets[2]} without notes.`,
    ]);

    const nonPositionalEvidence = [
      `Explain ${targets[0]} without notes.`,
      `Compare ${targets[1]} with ${targets[2]}.`,
    ];
    const directedWithCombinedEvidence = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment({
        ...context,
        session: {
          ...context.session,
          completionEvidence: nonPositionalEvidence,
        },
        sessionAdjustment: {
          ...context.sessionAdjustment!,
          note: `Focus this attempt on ${targets[2]}.`,
        },
      }),
    );
    expect(directedWithCombinedEvidence.session.contentTargets).toEqual(targets.slice(1));
    expect(directedWithCombinedEvidence.session.deferredContentTargets).toEqual([targets[0]]);
    expect(directedWithCombinedEvidence.session.completionEvidence).toEqual([
      nonPositionalEvidence[1],
    ]);

    const directedWithOnlyDeferredEvidence = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment({
        ...context,
        session: {
          ...context.session,
          completionEvidence: [nonPositionalEvidence[0]!],
        },
        sessionAdjustment: {
          ...context.sessionAdjustment!,
          note: `Focus this attempt on ${targets[2]}.`,
        },
      }),
    );
    expect(directedWithOnlyDeferredEvidence.session.completionEvidence).toEqual([
      `Retrieve or apply ${targets[1]} without notes.`,
      `Retrieve or apply ${targets[2]} without notes.`,
    ]);

    const paraphrasedDeferredOnlyEvidence = scopeFullSessionToCurrentWindow(
      (await import("@/lib/openai/session-generator")).applyCurrentSessionAdjustment({
        ...context,
        session: {
          ...context.session,
          completionEvidence: ["State where this process happens and what it produces."],
        },
      }),
    );
    expect(paraphrasedDeferredOnlyEvidence.session.contentTargets).toEqual(targets.slice(0, 2));
    expect(paraphrasedDeferredOnlyEvidence.session.completionEvidence).toEqual([
      `Retrieve or apply ${targets[0]} without notes.`,
      `Retrieve or apply ${targets[1]} without notes.`,
    ]);

    const ambiguousTopics = context.knowledgeTopics.map((topic, index) => ({
      ...topic,
      title: `General cell process ${index + 1}`,
      description: "A broad process description used for study and review.",
      subtopics: [],
    }));
    const ambiguousAdjusted = (await import("@/lib/openai/session-generator"))
      .applyCurrentSessionAdjustment({
        ...context,
        knowledgeTopics: ambiguousTopics,
      });
    expect(() => scopeFullSessionToCurrentWindow(ambiguousAdjusted)).toThrowError(expect.objectContaining({
      name: "SessionGenerationFailure",
      generationStats: expect.objectContaining({
        attempts: 0,
        failedValidator: "session_coverage_fidelity",
      }),
    }));
  });

  it("semantically narrows a continuation topic superset even when its targets fit", async () => {
    const { prepareSessionGenerationContext } = await import("@/lib/openai/session-generator");
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const topicIds = [
      "8ec325f4-0000-4000-8000-000000000031",
      "8ec325f4-0000-4000-8000-000000000032",
      "8ec325f4-0000-4000-8000-000000000033",
    ];
    const chunkIds = [
      "8ec325f4-0000-4000-8000-000000000041",
      "8ec325f4-0000-4000-8000-000000000042",
      "8ec325f4-0000-4000-8000-000000000043",
    ];
    const materialId = "8ec325f4-0000-4000-8000-000000000050";
    const topicTitles = [
      "Glycolysis inputs and outputs",
      "Krebs cycle location and outputs",
      "Electron transport chain mechanism",
    ];
    const deferredTargets = topicTitles.slice(1);
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: {
        ...base!.learningGoal,
        sourceMode: "user_materials",
      },
      materials: topicTitles.map((title, index) => ({
        materialId,
        chunkId: chunkIds[index]!,
        chunkIndex: index,
        name: "Respiration notes",
        text: `Authoritative source explanation for ${title}.`,
        truncated: false,
        locationLabel: `Section ${index + 1}`,
        role: "content_source" as const,
      })),
      knowledgeTopics: topicTitles.map((title, index) => ({
        ...base!.knowledgeTopics[0]!,
        id: topicIds[index]!,
        title,
        description: `Authoritative model of ${title.toLocaleLowerCase()}.`,
        subtopics: [title],
        origin: "material" as const,
        sourceReferences: [{
          materialId,
          chunkId: chunkIds[index]!,
          chunkIndex: index,
          startCharacter: 0,
          endCharacter: 80,
          locationLabel: `Section ${index + 1}`,
          sectionRole: "content_source" as const,
        }],
      })),
      session: {
        ...base!.session,
        title: "Continue cellular respiration stages",
        objective: `Retrieve or apply the remaining saved targets: ${deferredTargets.join("; ")}.`,
        methodReason: `This continuation preserves the exact plan scope that did not fit the previous time window. Complete only these remaining targets before moving to later curriculum: ${deferredTargets.join("; ")}.`,
        estimatedMinutes: 25,
        topicIds,
        contentTargets: deferredTargets,
        completionEvidence: deferredTargets.map((target) => (
          `Explain or apply this remaining saved target independently: ${target}`
        )),
      },
      sessionAdjustment: null,
    };

    const prepared = prepareSessionGenerationContext(context);

    expect(prepared.session.contentTargets).toEqual(deferredTargets);
    expect(prepared.session.topicIds).toEqual(topicIds.slice(1));
    expect(prepared.knowledgeTopics.map((topic) => topic.id)).toEqual(topicIds.slice(1));
    expect(prepared.materials.map((material) => material.chunkId)).toEqual(chunkIds.slice(1));
    expect(prepared.session.objective).toBe(context.session.objective);
    expect(prepared.session.completionEvidence).toEqual(context.session.completionEvidence);
    expect(prepared.session.deferredContentTargets).toBeUndefined();

    const twoTopicContinuation = prepareSessionGenerationContext({
      ...context,
      materials: context.materials.slice(0, 2),
      knowledgeTopics: context.knowledgeTopics.slice(0, 2),
      session: {
        ...context.session,
        topicIds: topicIds.slice(0, 2),
        contentTargets: [topicTitles[1]!],
        completionEvidence: [
          `Explain or apply this remaining saved target independently: ${topicTitles[1]}`,
        ],
      },
    });
    expect(twoTopicContinuation.session.topicIds).toEqual([topicIds[1]]);
    expect(twoTopicContinuation.knowledgeTopics.map((topic) => topic.id)).toEqual([topicIds[1]]);
    expect(twoTopicContinuation.materials.map((material) => material.chunkId)).toEqual([chunkIds[1]]);

    const ambiguous = {
      ...context,
      knowledgeTopics: context.knowledgeTopics.map((topic, index) => ({
        ...topic,
        title: `General respiration topic ${index + 1}`,
        description: "Cell respiration processes, locations, mechanisms, and outputs.",
        subtopics: [],
      })),
    };
    expect(() => prepareSessionGenerationContext(ambiguous)).toThrowError(expect.objectContaining({
      name: "SessionGenerationFailure",
      generationStats: expect.objectContaining({
        attempts: 0,
        failedValidator: "session_coverage_fidelity",
      }),
    }));

    expect(() => prepareSessionGenerationContext({
      ...context,
      materials: context.materials.filter((material) => material.chunkId !== chunkIds[2]),
    })).toThrowError(expect.objectContaining({
      name: "SessionGenerationFailure",
      generationStats: expect.objectContaining({
        attempts: 0,
        failedValidator: "session_source_grounding",
      }),
    }));
  });

  it("rejects a wall of content that cannot fit a short guided session", async () => {
    const { validateSessionTimeBudget } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const oversizedExplanation = Array.from(
      { length: 520 },
      (_, index) => `detail${index + 1}`,
    ).join(" ");
    draft.activities[0]!.teaching!.explanation = oversizedExplanation;

    expect(validateSessionTimeBudget(draft, 15)).toMatch(/too much for a 15-minute guided session/i);
  });

  it("does not charge a future-return reminder against today's reading budget", async () => {
    const {
      ensureDelayedRetrievalReturn,
      validateSessionTimeBudget,
    } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const policy = {
      schemaVersion: 1 as const,
      evidenceStatus: "starting_hypothesis" as const,
      presentation: { mode: "task_aligned" as const, label: "Task led", instruction: "Present the content around the task at hand." },
      repair: { mode: "task_aligned" as const, label: "Repair", instruction: "Repair only the gap shown by the learner." },
      retention: { mode: "delayed_retrieval" as const, label: "Delayed retrieval", instruction: "Return to the idea after a useful delay." },
      workspace: { mode: "one_step" as const, label: "One step", instruction: "Keep one current action visually prominent." },
      pacing: { firstActionMinutes: 3, maximumActivities: 3, reason: "Use a short sequence that fits the learner's available time." },
      activityCadence: { mode: "task_aligned" as const, label: "Task-aligned cadence", instruction: "Change activities only when the selected method and current objective call for it." },
      attemptSafety: { mode: "task_aligned" as const, label: "Task-aligned attempts", instruction: "Use the attempt and feedback format best supported by the current task." },
      knowledgeCheck: { mode: "task_aligned" as const, label: "Task-aligned check", instruction: "Use the knowledge check required by the selected method and current objective." },
      learnerFacingReasons: ["You report forgetting after a delay, so YOVA will bring this idea back later."],
      signalsUsed: ["I forget after a few days"],
    };
    const withReturn = {
      ...draft,
      activities: ensureDelayedRetrievalReturn(draft.activities, policy, "Funding tradeoffs"),
    };
    const bloatedReturn = withReturn.activities.at(-1)!;
    bloatedReturn.body = Array.from({ length: 430 }, (_, index) => `reminder${index}`).join(" ");

    expect(validateSessionTimeBudget(withReturn, 15)).toBeNull();
  });
});

describe("personalized retention normalization", () => {
  it("adds a lightweight delayed return without turning it into required work", async () => {
    const {
      ensureDelayedRetrievalReturn,
      validateSessionTimeBudget,
    } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const activities = ensureDelayedRetrievalReturn(
      draft.activities,
      {
        schemaVersion: 1,
        evidenceStatus: "starting_hypothesis",
        presentation: { mode: "task_aligned", label: "Task led", instruction: "Present the content around the task at hand." },
        repair: { mode: "task_aligned", label: "Repair", instruction: "Repair only the gap shown by the learner." },
        retention: { mode: "delayed_retrieval", label: "Delayed retrieval", instruction: "Return to the idea after a useful delay." },
        workspace: { mode: "one_step", label: "One step", instruction: "Keep one current action visually prominent." },
        pacing: { firstActionMinutes: 3, maximumActivities: 3, reason: "Use a short sequence that fits the learner's available time." },
        activityCadence: { mode: "task_aligned", label: "Task-aligned cadence", instruction: "Change activities only when the selected method and current objective call for it." },
        attemptSafety: { mode: "task_aligned", label: "Task-aligned attempts", instruction: "Use the attempt and feedback format best supported by the current task." },
        knowledgeCheck: { mode: "task_aligned", label: "Task-aligned check", instruction: "Use the knowledge check required by the selected method and current objective." },
        learnerFacingReasons: ["You report forgetting after a delay, so YOVA will bring this idea back later."],
        signalsUsed: ["I forget after a few days"],
      },
      "Funding tradeoffs",
    );
    const normalized = { ...draft, activities };

    expect(activities.at(-1)).toMatchObject({
      methodPhase: "schedule_return",
      requiredForCompletion: false,
      type: "reflection",
    });
    expect(validateSessionTimeBudget(normalized, 15)).toBeNull();
  });

  it("replaces provider-authored return questions and duplicates with one canonical optional marker", async () => {
    const {
      ensureDelayedRetrievalReturn,
      validateSessionTimeBudget,
    } = await import("@/lib/openai/session-generator");
    const draft = learningDraft("model");
    const invalidReturnQuestion = {
      ...draft.activities[1]!,
      methodPhase: "schedule_return" as const,
      requiredForCompletion: true,
      title: "Answer this again later",
    };
    const invalidDuplicate = {
      ...draft.activities[2]!,
      methodPhase: "schedule_return" as const,
      requiredForCompletion: true,
      title: "A second return check",
    };
    const activities = ensureDelayedRetrievalReturn(
      [...draft.activities, invalidReturnQuestion, invalidDuplicate],
      {
        schemaVersion: 1,
        evidenceStatus: "starting_hypothesis",
        presentation: { mode: "task_aligned", label: "Task led", instruction: "Present the content around the task at hand." },
        repair: { mode: "task_aligned", label: "Repair", instruction: "Repair only the gap shown by the learner." },
        retention: { mode: "delayed_retrieval", label: "Delayed retrieval", instruction: "Return to the idea after a useful delay." },
        workspace: { mode: "one_step", label: "One step", instruction: "Keep one current action visually prominent." },
        pacing: { firstActionMinutes: 3, maximumActivities: 3, reason: "Use a short sequence that fits the learner's available time." },
        activityCadence: { mode: "task_aligned", label: "Task-aligned cadence", instruction: "Change activities only when the selected method and current objective call for it." },
        attemptSafety: { mode: "task_aligned", label: "Task-aligned attempts", instruction: "Use the attempt and feedback format best supported by the current task." },
        knowledgeCheck: { mode: "task_aligned", label: "Task-aligned check", instruction: "Use the knowledge check required by the selected method and current objective." },
        learnerFacingReasons: ["You report forgetting after a delay, so YOVA will bring this idea back later."],
        signalsUsed: ["I forget after a few days"],
      },
      "Funding tradeoffs",
    );

    expect(activities.filter((activity) => activity.methodPhase === "schedule_return")).toHaveLength(1);
    expect(activities.at(-1)).toMatchObject({
      methodPhase: "schedule_return",
      requiredForCompletion: false,
      type: "reflection",
      topicId: null,
      concept: null,
    });
    expect(validateSessionTimeBudget({ ...draft, activities }, 15)).toBeNull();
  });
});

describe("outside-YOVA teaching-first generation", () => {
  it("repairs an orient instruction plus model question into subject teaching, external action, and return", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")?.context;
    expect(base).toBeDefined();
    const context: SessionGenerationContext = {
      ...base!,
      sessionArchitectureVersion: "filled_teaching_v1",
      learningGoal: {
        ...base!.learningGoal,
        studyMode: "outside_yova",
        sourceMode: "yova_generated",
        learningIntent: "learn",
      },
    };
    const repairedDraft = learningDraft("model");
    repairedDraft.activities[1]!.methodPhase = "explain";
    repairedDraft.activities.push({
      topicId: null,
      methodPhase: "repair",
      concept: null,
      estimatedMinutes: 1,
      requiredForCompletion: false,
      label: "Repair",
      title: "Repair only the missing relationship",
      body: "Compare your explanation with the source and correct only the relationship you missed.",
      teaching: null,
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    });
    appendSelfExplanationReexplain(repairedDraft);
    repairedDraft.activities.forEach((activity) => {
      if (activity.type === "multiple_choice" || activity.type === "free_response") {
        activity.practiceIntent = "baseline";
      }
    });
    repairedDraft.sourceGrounding = {
      mode: "materials_plus_ai",
      summary: "A provider-supplied grounding block must not override YOVA's AI-generated source policy.",
      sourceNames: ["provider-invented-source.txt"],
      anchors: [{
        chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceName: "provider-invented-source.txt",
        locationLabel: "Invented section",
        excerpt: "This provider-supplied excerpt is deliberately outside the authoritative context.",
        usedFor: "Verify that server-owned source policy removes an invented grounding block.",
      }],
      supplements: [{
        topic: "Provider grounding",
        reason: "This deliberately supplied value proves the server owns AI-generated grounding metadata.",
      }],
    };
    const invalidDraft = structuredClone(repairedDraft);
    invalidDraft.activities[0]!.methodPhase = "orient";
    invalidDraft.activities[1]!.methodPhase = "model";
    invalidDraft.activities[1]!.teaching = structuredClone(invalidDraft.activities[0]!.teaching);
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-outside-learn", invalidDraft))
      .mockResolvedValueOnce(completedProviderResponse("repaired-outside-learn", repairedDraft));

    const {
      generateSessionWithOpenAI,
      validateOutsideAppGuidance,
      validateSubstantiveTeaching,
    } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      failedValidator: "session_structure",
      repairReason: "structured_output",
      repairSucceeded: true,
      validationIssueCode: "session_full_structure",
    });
    expect(parseResponse.mock.calls[1]?.[0]?.instructions).toMatch(/activities\[1\]\.methodPhase: Only instruction activities may use the model phase/);
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as {
      outsideAppContract?: {
        methodCoaching?: string;
        learningSequence?: string;
        instructionTemplate?: string;
      };
    };
    expect(prompt.outsideAppContract).toMatchObject({
      methodCoaching: expect.stringMatching(/compact method panel.*task-selected method/i),
      learningSequence: expect.stringMatching(/subject primer.*study the YOVA model.*open the named source.*return to YOVA/i),
      instructionTemplate: expect.stringMatching(/YOVA's subject explanation first.*open your.*Return to YOVA/i),
    });
    expect(result.draft.activities[0]).toMatchObject({
      type: "instruction",
      methodPhase: "model",
    });
    expect(result.draft.activities[0]?.teaching).not.toBeNull();
    expect(result.draft.activities[0]?.body).toMatch(/^Study YOVA's subject model below first, then open your trusted source or class notes\./);
    expect(result.draft.activities.find((activity) => activity.methodPhase === "repair")?.body).toBe(
      "Compare your explanation with the source and correct only the relationship you missed.",
    );
    expect(result.draft.activities.some((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.draft.activities.some((activity) => activity.type === "free_response")).toBe(true);
    expect(result.draft.sourceGrounding).toBeNull();
    expect(validateSubstantiveTeaching(result.draft)).toBeNull();
    expect(validateOutsideAppGuidance(result.draft, "outside_yova")).toBeNull();
  });

  it("server-normalizes a recognition-only learn session in one call even when bounded recovery is ineligible", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const context: SessionGenerationContext = {
      ...base,
      sessionArchitectureVersion: "filled_teaching_v1",
      learningGoal: {
        ...base.learningGoal,
        studyMode: "outside_yova",
        sourceMode: "yova_generated",
        learningIntent: "learn",
      },
      sessionAdjustment: {
        familiarity: "as_planned",
        availableMinutes: 15,
        knownTargets: [],
        note: "Keep the funding exchange as the only focus in this attempt.",
      },
    };
    const draft = learningDraft("model");
    const explanation = draft.activities[1]!;
    draft.activities[1] = {
      ...explanation,
      methodPhase: "explain",
      type: "multiple_choice",
      choices: [
        explanation.correctAnswer!,
        "The startup receives no capital and gives no financial right.",
        "The investor receives control without providing any resources.",
      ],
    };
    draft.activities[2] = {
      ...draft.activities[2]!,
      methodPhase: "repair",
      label: "Repair",
      title: "Repair the missing relationship",
      body: "The first explanation can miss the financial right given in return. Which correction restores that relationship?",
      choices: [
        "The investor provides capital and receives ownership, repayment rights, or a future equity claim.",
        "The investor receives control without providing any resources.",
        "The startup receives capital without giving any financial right in return.",
      ],
      correctAnswer: "The investor provides capital and receives ownership, repayment rights, or a future equity claim.",
      feedback: "The correction must preserve both the immediate capital and the investor's financial right.",
    };
    appendSelfExplanationReexplain(draft);
    draft.activities.forEach((activity) => {
      if (activity.type === "multiple_choice" || activity.type === "free_response") {
        activity.practiceIntent = "baseline";
      }
    });
    parseResponse.mockResolvedValueOnce(completedProviderResponse("recognition-only-learn", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.draft.activities[1]).toMatchObject({
      methodPhase: "explain",
      type: "free_response",
      choices: [],
      correctAnswer: explanation.correctAnswer,
      feedback: explanation.feedback,
      estimatedMinutes: explanation.estimatedMinutes,
    });
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: false,
      failedValidator: "session_method_fidelity",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "semantic_validation",
      validationIssueCode: null,
    });
  });

  it("server-normalizes evidence-derived practice metadata before full-session validation", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const context: SessionGenerationContext = {
      ...base,
      sessionArchitectureVersion: "filled_teaching_v1",
      learningGoal: {
        ...base.learningGoal,
        studyMode: "outside_yova",
        sourceMode: "yova_generated",
        learningIntent: "learn",
      },
    };
    const draft = learningDraft("model");
    draft.activities[1]!.methodPhase = "explain";
    draft.activities.push({
      topicId: null,
      methodPhase: "repair",
      concept: null,
      estimatedMinutes: 1,
      requiredForCompletion: false,
      label: "Repair",
      title: "Repair only the missing relationship",
      body: "Compare your explanation with the source and correct only the relationship you missed.",
      teaching: null,
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
      practiceIntent: null,
      misconceptionSummary: null,
    });
    appendSelfExplanationReexplain(draft);
    draft.activities.forEach((activity) => {
      if (activity.type === "multiple_choice" || activity.type === "free_response") {
        activity.practiceIntent = "develop_gap";
      }
    });
    parseResponse.mockResolvedValueOnce(completedProviderResponse("wrong-practice-metadata", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.draft.activities.filter((activity) => (
      activity.type === "multiple_choice" || activity.type === "free_response"
    )).map((activity) => activity.practiceIntent)).toEqual(["baseline", "baseline", "baseline"]);
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: false,
      failedValidator: "session_practice_variation",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "semantic_validation",
      validationIssueCode: "session_practice_metadata",
    });
  });
});

describe("bounded full-generator provider budget", () => {
  it.each([
    ["connection", Object.assign(new Error("connection lost"), { name: "APIConnectionError", code: "econnreset" })],
    ["server", Object.assign(new Error("upstream unavailable"), { status: 503 })],
    ["rate limit", Object.assign(new Error("rate limited"), { status: 429 })],
    ["timeout", Object.assign(new Error("request timed out"), { name: "APIConnectionTimeoutError" })],
  ])("retries one transient %s failure and preserves truthful attempt and token totals", async (_label, transientError) => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const draft = validStartupSelfExplanationDraft();
    parseResponse
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce(completedProviderResponse("transient-retry-success", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(2);
    expect(result.generationStats).toMatchObject({
      attempts: 2,
      firstAttemptPassed: false,
      failedValidator: "session_provider_request",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "none",
      inputTokens: 600,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 300,
    });
  });

  it.each([
    ["authentication", Object.assign(new Error("authentication rejected"), { status: 401 })],
    ["permission", Object.assign(new Error("permission rejected"), { status: 403 })],
    ["invalid request", Object.assign(new Error("invalid request"), { status: 400 })],
    ["semantic SDK error", new Error("unclassified provider exception")],
  ])("does not retry a permanent %s failure", async (_label, permanentError) => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    parseResponse.mockRejectedValueOnce(permanentError);

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        failedValidator: "session_provider_request",
        repairAttempted: false,
        stage: "provider",
        cause: "provider_request",
        inputTokens: 0,
        outputTokens: 0,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("keeps both allowed calls inside settlement headroom and never starts a third", async () => {
    parseResponse.mockReset();
    const context = economicsLearnContext();
    const startedAt = new Date("2026-08-21T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse
      .mockImplementationOnce(async () => {
        vi.setSystemTime(startedAt.getTime() + 35_000);
        return completedProviderResponse("invalid-budget-initial", {});
      })
      .mockImplementationOnce(async () => {
        vi.setSystemTime(startedAt.getTime() + 70_000);
        return completedProviderResponse("invalid-budget-repair", {});
      });

    try {
      const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
      await expect(generateSessionWithOpenAI(context, {
        deadlineAt: startedAt.getTime() + 90_000,
        settlementReserveMs: 12_000,
      })).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 2,
          stage: "validation",
          cause: "invalid_structure",
          repairAttempted: true,
          repairSucceeded: false,
        },
      });

      expect(parseResponse).toHaveBeenCalledTimes(2);
      expect(parseResponse.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ maxRetries: 0, timeout: 35_000, signal: expect.any(AbortSignal) }),
        expect.objectContaining({ maxRetries: 0, timeout: 35_000, signal: expect.any(AbortSignal) }),
      ]);
      expect(Date.now()).toBeLessThanOrEqual(startedAt.getTime() + 78_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a real first-call timeout when the shared route budget still has room", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "startup_funding_foundations")!.context;
    const startedAt = new Date("2026-08-21T12:30:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse
      .mockImplementationOnce((_, options: { signal: AbortSignal }) => (
        new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        })
      ))
      .mockResolvedValueOnce(completedProviderResponse(
        "real-timeout-retry-success",
        validStartupSelfExplanationDraft(),
      ));

    try {
      const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
      const generation = generateSessionWithOpenAI(context, {
        deadlineAt: startedAt.getTime() + 90_000,
        settlementReserveMs: 12_000,
      });
      await vi.advanceTimersByTimeAsync(35_000);
      const result = await generation;

      expect(parseResponse).toHaveBeenCalledTimes(2);
      expect(parseResponse.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ timeout: 35_000, maxRetries: 0, signal: expect.any(AbortSignal) }),
        expect.objectContaining({ timeout: 35_000, maxRetries: 0, signal: expect.any(AbortSignal) }),
      ]);
      expect(result.generationStats).toMatchObject({
        attempts: 2,
        firstAttemptPassed: false,
        failedValidator: "session_provider_request",
        repairAttempted: true,
        repairSucceeded: true,
        inputTokens: 600,
        outputTokens: 300,
      });
      expect(Date.now()).toBe(startedAt.getTime() + 35_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a delayed provider call at the remaining server budget", async () => {
    parseResponse.mockReset();
    const context = economicsLearnContext();
    const startedAt = new Date("2026-08-21T13:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse.mockImplementationOnce((_, options: { signal: AbortSignal }) => (
      new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      })
    ));

    try {
      const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
      const generation = generateSessionWithOpenAI(context, {
        deadlineAt: startedAt.getTime() + 30_000,
        settlementReserveMs: 12_000,
      });
      const rejection = expect(generation).rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 1,
          failedValidator: "session_provider_request",
          repairSucceeded: null,
          stage: "provider",
          cause: "provider_request",
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

describe("full guided-session personalization prompt", () => {
  it("sends teaching decisions to the model without CSS-only or raw personalization data", async () => {
    parseResponse.mockReset();
    parseResponse.mockRejectedValueOnce(new Error("provider unavailable"));
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "biology_initial_teaching")?.context;
    expect(context).toBeDefined();
    const personalizedContext = {
      ...context!,
      personalization: {
        decisions: [{
          id: "decision:method_delivery:activity_cadence:short_active_rounds",
          artifact: "method_delivery" as const,
          setting: "activity_cadence" as const,
          value: "short_active_rounds",
          title: "Controlled activity changes",
          explanation: "Use short active rounds while preserving one objective.",
          signalIds: ["signal:attention_variability"],
          evidenceLabel: "You told YOVA" as const,
          methodCandidates: [],
          experimental: false,
        }, {
          id: "decision:workspace:motion:reduced",
          artifact: "workspace" as const,
          setting: "motion" as const,
          value: "PRIVATE-CSS-ONLY",
          title: "Reduced motion",
          explanation: "Keep interface motion reduced.",
          signalIds: ["signal:workspace_settings"],
          evidenceLabel: "You told YOVA" as const,
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
    } satisfies SessionGenerationContext;

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(personalizedContext))
      .rejects.toMatchObject({
        name: "SessionGenerationFailure",
        generationStats: {
          attempts: 1,
          stage: "provider",
          cause: "provider_request",
        },
      });

    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as Record<string, unknown>;
    expect(prompt).toMatchObject({
      sessionDeliveryPolicy: {
        activityCadence: { mode: "short_active_rounds" },
      },
    });
    expect(prompt).not.toHaveProperty("personalization");
    expect(providerInput).not.toContain("PRIVATE-CSS-ONLY");
  });
});

describe("bounded study failure behavior", () => {
  it("uses the one-call compact path for an explicitly shortened material session", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")!.context;
    const materialText = "Cells couple energy-releasing reactions to energy-requiring work. ATP hydrolysis releases free energy that can drive a coupled cellular reaction.";
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: { ...base.learningGoal, sourceMode: "user_materials" },
      materials: [{
        materialId: "41111111-1111-4111-8111-111111111111",
        chunkId: "42222222-2222-4222-8222-222222222222",
        chunkIndex: 0,
        name: "shortened-bioenergetics-notes.txt",
        text: materialText,
        truncated: false,
        locationLabel: "Uploaded text",
        role: "content_source",
      }],
      session: {
        ...base.session,
        estimatedMinutes: 15,
        deferredContentTargets: ["Membrane transport applications"],
        completionEvidence: base.session.completionEvidence?.slice(0, 2),
      },
    };
    parseResponse.mockResolvedValueOnce(completedProviderResponse(
      "direct-material-safe-study",
      compactBioRecoveryContent(),
    ));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_safe_study_recovery");
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const providerContext = JSON.parse(
      providerInput.slice(providerInput.indexOf("\n") + 1),
    ) as { targetProvenance: unknown[] };
    expect(providerContext.targetProvenance).toEqual([]);
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: true,
      repairAttempted: false,
      recoveryMode: "safe_study",
    });
    expect(result.draft.coverage.deferredContent).toEqual(["Membrane transport applications"]);
    expect(result.draft.sourceGrounding?.sourceNames).toEqual(["shortened-bioenergetics-notes.txt"]);
    await expectCompleteValidatorPass(result.draft, context);
  });

  it("server-normalizes a recognition-only challenge session without adding a provider call", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")!.context;
    const context: SessionGenerationContext = {
      ...base,
      sessionArchitectureVersion: "filled_teaching_v1",
      sessionAdjustment: {
        familiarity: "challenge_me",
        availableMinutes: 25,
        knownTargets: [],
        note: "Use a demanding but bounded application of the same two targets.",
      },
    };
    const draft = oversizedStudyDraft();
    draft.topicIds = [...context.session.topicIds];
    draft.rationale = "Use unsupported bioenergetics recognition before a concise correction and delayed return.";
    draft.coverage = {
      focus: "Cellular energy transfer and ATP hydrolysis coupling.",
      essentialIdeas: [
        "Cells transfer energy by coupling energy-releasing reactions to energy-requiring cellular work.",
        "ATP hydrolysis releases free energy that can drive a coupled cellular reaction.",
      ],
      completionEvidence: [...(context.session.completionEvidence ?? [])],
      evidenceMap: [{
        essentialIdea: "Cells transfer energy by coupling energy-releasing reactions to energy-requiring cellular work.",
        activityConcept: "Cellular energy transfer",
      }, {
        essentialIdea: "ATP hydrolysis releases free energy that can drive a coupled cellular reaction.",
        activityConcept: "ATP hydrolysis and energy coupling",
      }],
      deferredContent: [],
    };
    draft.activities[0] = {
      ...draft.activities[0]!,
      topicId: context.session.topicIds[0]!,
      estimatedMinutes: 3,
      concept: "Cellular energy transfer",
      title: "Explain cellular energy transfer",
      body: "Explain how an energy-releasing reaction can drive energy-requiring cellular work.",
      type: "multiple_choice",
      choices: [
        "Cells couple energy-releasing reactions to energy-requiring work",
        "Cells create new energy whenever work is required",
        "Cells rely only on heat released by reactions",
        "Cells store every form of energy permanently",
      ],
      correctAnswer: "Cells couple energy-releasing reactions to energy-requiring work",
      feedback: "The useful relationship is chemical coupling between an energy-releasing process and the cellular work it drives.",
      practiceIntent: "baseline",
    };
    draft.activities[1] = {
      ...draft.activities[1]!,
      topicId: context.session.topicIds[0]!,
      methodPhase: "retrieve",
      estimatedMinutes: 3,
      concept: "ATP hydrolysis and energy coupling",
      title: "Apply ATP coupling",
      body: "How can ATP hydrolysis help drive an energy-requiring cellular reaction?",
      choices: [
        "Coupling makes the combined free-energy change favorable",
        "ATP creates energy that did not previously exist",
        "ATP prevents every spontaneous reaction",
        "Hydrolysis permanently stores energy in water",
      ],
      correctAnswer: "Coupling makes the combined free-energy change favorable",
      feedback: "The favorable free-energy change of ATP hydrolysis can drive a linked energy-requiring reaction without creating energy.",
      practiceIntent: "baseline",
    };
    draft.activities[2] = {
      ...draft.activities[2]!,
      estimatedMinutes: 3,
      title: "Repair the coupling model",
      body: "Compare both attempts with the corrected energy-coupling model and replace only the exposed gap.",
      teaching: {
        keyIdea: "Cells transfer rather than create energy by coupling reactions.",
        explanation: "An energy-releasing reaction can be chemically linked to energy-requiring cellular work. ATP hydrolysis is a common link because its favorable free-energy change can make the combined process favorable.",
        example: null,
        commonMistake: {
          mistake: "ATP hydrolysis creates new energy for the cell.",
          correction: "ATP hydrolysis transfers usable free energy through coupling; it does not create energy.",
        },
      },
    };
    draft.activities[3] = {
      ...draft.activities[3]!,
      estimatedMinutes: 1,
      title: "Return to ATP coupling",
      body: "YOVA will bring ATP coupling back after a delay for another unsupported retrieval.",
    };
    parseResponse.mockResolvedValueOnce(completedProviderResponse("recognition-only-study", draft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.draft.activities.find((activity) => activity.type === "free_response")).toMatchObject({
      type: "free_response",
      choices: [],
      topicId: context.session.topicIds[0],
      methodPhase: "retrieve",
      estimatedMinutes: 3,
    });
    expect(result.draft.activities.some((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      failedValidator: "session_required_typed_recall",
      repairAttempted: true,
      repairSucceeded: true,
      validationIssueCode: "session_required_typed_recall",
    });
  });

  it("fails a requested challenge session closed after two calls without entering compact recovery", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")!.context;
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-challenge-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-challenge-repair", {}));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI({
      ...base,
      sessionAdjustment: {
        familiarity: "challenge_me",
        availableMinutes: 25,
        knownTargets: [],
        note: "Use a demanding but bounded application of the same targets.",
      },
    })).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 2,
        stage: "validation",
        cause: "invalid_structure",
      },
    });
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
    ]);
  });
});

describe("scheduled retrieval generation", () => {
  it("uses the narrow three-question contract instead of the full lesson schema", async () => {
    parseResponse.mockReset();
    parseResponse.mockResolvedValueOnce({
      id: "response-scheduled-review",
      model: "gpt-yova-test",
      status: "completed",
      output_parsed: {
        questions: [
          {
            targetIndex: 0,
            title: "Estimate from a nearby interval",
            body: "For $f(x)=x^2$, use the points at $x=2$ and $x=2.1$. Which value best estimates the instantaneous rate at $x=2$?",
            choices: ["0.4", "4.1", "8", "40"],
            correctChoiceIndex: 1,
            feedback: "The secant slope is $((2.1)^2-2^2)/(2.1-2)=4.1$, which approximates the derivative near $x=2$.",
          },
          {
            targetIndex: 0,
            title: "Interpret the estimate",
            body: "For $f(x)=x^2$, a nearby-interval slope at $x=2$ is about $4.1$. What does this estimate represent?",
            choices: ["The instantaneous rate of change near $x=2$", "The value $f(2)$", "The interval width", "The average output"],
            correctChoiceIndex: 0,
            feedback: "A secant slope over a very small interval estimates the tangent slope, or instantaneous rate of change.",
          },
          {
            targetIndex: 0,
            title: "Use a fresh interval",
            body: "For $f(x)=x^2$, which nearby-interval calculation would give another estimate of the instantaneous rate at $x=2$?",
            choices: ["$(f(2.01)-f(2))/(2.01-2)$", "$f(2.01)-f(2)$", "$f(2)/2$", "$(2.01-2)/f(2)$"],
            correctChoiceIndex: 0,
            feedback: "The difference quotient uses the change in output divided by the small change in input.",
          },
        ],
      },
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 500, cache_write_tokens: 0 },
        output_tokens: 500,
      },
    });
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")?.context;
    expect(context).toBeDefined();
    expect(context!.session.contentTargets ?? []).toEqual([]);
    expect(context!.session.completionEvidence ?? []).toEqual([]);
    const personalizedContext = {
      ...context!,
      sessionAdjustment: {
        familiarity: "already_know" as const,
        availableMinutes: 10,
        knownTargets: ["Nearby interval estimate at x = 2"],
        note: "",
      },
      personalization: {
        decisions: [{
          id: "decision:support:attempt_safety:private_revisable_attempt",
          artifact: "support" as const,
          setting: "attempt_safety" as const,
          value: "private_revisable_attempt",
          title: "A low-stakes first attempt",
          explanation: "Make the first answer private and revisable, then use feedback as information rather than a verdict.",
          signalIds: ["signal:mistake_sensitivity"],
          evidenceLabel: "You told YOVA" as const,
          methodCandidates: [],
          experimental: false,
        }, {
          id: "decision:workspace:text_density:reduced",
          artifact: "workspace" as const,
          setting: "text_density" as const,
          value: "PRIVATE-CSS-ONLY",
          title: "Less text on screen",
          explanation: "Keep instructions concise and reveal extra detail only when the learner requests it.",
          signalIds: ["signal:workspace_settings"],
          evidenceLabel: "You told YOVA" as const,
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
    } satisfies SessionGenerationContext;

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(personalizedContext);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_scheduled_retrieval");
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    expect(JSON.parse(providerInput)).toMatchObject({
      sessionDeliveryPolicy: {
        activityCadence: { mode: "task_aligned" },
        attemptSafety: { mode: "private_revisable_attempt" },
        knowledgeCheck: { mode: "task_aligned" },
      },
    });
    expect(providerInput).not.toContain("PRIVATE-CSS-ONLY");
    expect(result.draft.activities).toHaveLength(3);
    expect(result.draft.activities.every((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.draft.activities.every((activity) => activity.concept === "Nearby interval estimate at x = 2")).toBe(true);
    expect(result.draft.methodBriefing.personalization.join(" ")).toMatch(/already knowing.*verify.*claim/i);
  });

  it.each([
    {
      label: "needs more support",
      correctAnswers: 1,
      feedback: "too_difficult" as const,
      expected: /needs? more support.*smaller steps.*guidance/i,
    },
    {
      label: "promising",
      correctAnswers: 4,
      feedback: "about_right" as const,
      expected: /promising.*independent.*transfer/i,
    },
  ])("does not grant raw $label retrieval outcomes route-authority during slot filling", async ({
    correctAnswers,
    feedback,
  }) => {
    parseResponse.mockReset();
    parseResponse.mockResolvedValue(completedProviderResponse(
      "response-scheduled-method-outcome",
      scheduledCalculusQuestionSet(),
    ));
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;
    const comparableResult = {
      methodId: "retrieval_practice" as const,
      taskType: "problem_solving" as const,
      knowledgeStage: "retrieval_ready" as const,
      correctAnswers,
      totalAnswers: 4,
      feedback,
      observedGap: null,
      plannedMinutes: 10,
      actualMinutes: 10,
      calibrationPattern: "insufficient" as const,
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI({
      ...base,
      recentResults: [
        comparableResult,
        comparableResult,
        comparableResult,
        comparableResult,
      ],
    });

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(result.generationStats.attempts).toBe(1);
    const personalization = result.draft.methodBriefing.personalization.join(" ");
    expect(personalization).not.toMatch(/promising|needs? more support|best method/i);
    expect(personalization).toMatch(/scheduled return|current task/i);
  });

  it("fails before the provider when a scheduled three-question review receives a teaching-first adjustment", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI({
      ...base,
      sessionAdjustment: {
        familiarity: "need_teaching",
        availableMinutes: 10,
        knownTargets: [],
        note: "Teach this before checking it.",
      },
    })).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_adjustment_fidelity",
        repairAttempted: false,
      },
    });
    expect(parseResponse).not.toHaveBeenCalled();
  });

  it("reports scheduled target-shape failures separately from ordinary typed recall", async () => {
    parseResponse.mockReset();
    const invalidTargetSet = {
      questions: [0, 1, 2].map((index) => ({
        targetIndex: 2,
        title: `Invalid scheduled target ${index + 1}`,
        body: `Which self-contained answer applies to invalid scheduled target ${index + 1}?`,
        choices: ["Correct relationship", "Reversed relationship", "Unrelated relationship", "Missing relationship"],
        correctChoiceIndex: 0,
        feedback: "The correct relationship preserves the supplied scheduled target.",
      })),
    };
    parseResponse.mockResolvedValue(completedProviderResponse(
      "response-invalid-scheduled-target",
      invalidTargetSet,
    ));
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      generationStats: {
        attempts: 2,
        failedValidator: "scheduled_retrieval_format",
        validationIssueCode: "scheduled_retrieval_format",
        repairAttempted: true,
        repairSucceeded: false,
      },
    });
  });

  it("keeps two scheduled targets attached to their distinct topic evidence", async () => {
    parseResponse.mockReset();
    const secondTopicId = "55555555-5555-4555-8555-555555555555";
    const targets = [
      "Derivative as instantaneous rate of change",
      "Difference quotient estimates a derivative from a nearby interval",
    ];
    parseResponse.mockResolvedValue(completedProviderResponse("response-two-target-review", {
      questions: [{
        targetIndex: 0,
        title: "Interpret the derivative",
        body: "For a position function $s(t)$, what does $s'(2)$ represent at time $t=2$?",
        choices: ["Instantaneous velocity", "Position", "Elapsed time", "Average position"],
        correctChoiceIndex: 0,
        feedback: "The derivative of position at a time is the instantaneous rate of change, which is velocity.",
      }, {
        targetIndex: 1,
        title: "Build the nearby quotient",
        body: "For $f(x)=x^2$, which calculation estimates the derivative at $x=2$ using the nearby point $x=2.1$?",
        choices: ["$(f(2.1)-f(2))/(2.1-2)$", "$f(2.1)-f(2)$", "$f(2)/2$", "$(2.1-2)/f(2.1)$"],
        correctChoiceIndex: 0,
        feedback: "A difference quotient divides the nearby change in output by the corresponding change in input.",
      }, {
        targetIndex: 1,
        title: "Use a closer interval",
        body: "For $f(x)=x^2$, which nearby input would usually refine a difference-quotient estimate at $x=2$?",
        choices: ["$2.01$", "$3$", "$10$", "$-2$"],
        correctChoiceIndex: 0,
        feedback: "Using $2.01$ creates a smaller interval around $2$, so its secant slope better approximates the tangent slope.",
      }],
    }));
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;
    const context: SessionGenerationContext = {
      ...base,
      // This older signal uses a narrower historical label than the persisted
      // multi-target review. The scheduled session's exact target contract is
      // authoritative; server-owned labels must not make it regenerate.
      conceptSignals: [{
        topicId: TEST_TOPIC_ID,
        concept: "Derivative rate interpretation",
        attempts: 1,
        secureAttempts: 0,
        needsReviewAttempts: 1,
        lastOutcome: "needs_review",
        lastObservedAt: "2026-08-01T12:00:00.000Z",
        status: "needs_review",
      }],
      knowledgeTopics: [{
        ...base.knowledgeTopics[0]!,
        id: TEST_TOPIC_ID,
        title: targets[0]!,
        description: targets[0]!,
      }, {
        ...base.knowledgeTopics[0]!,
        id: secondTopicId,
        title: targets[1]!,
        description: targets[1]!,
      }],
      session: {
        ...base.session,
        estimatedMinutes: 10,
        topicIds: [TEST_TOPIC_ID, secondTopicId],
        contentTargets: targets,
        completionEvidence: [
          "Interpret a derivative as an instantaneous rate.",
          "Choose a valid nearby-interval difference quotient.",
        ],
        reviewConcept: targets[0],
        reviewType: "verify",
      },
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(result.draft.topicIds).toEqual([TEST_TOPIC_ID, secondTopicId]);
    expect(result.draft.coverage.essentialIdeas).toEqual(targets);
    expect(result.draft.coverage.evidenceMap.map((mapping) => mapping.activityConcept)).toEqual(targets);
    expect(result.draft.activities.map((activity) => activity.topicId)).toEqual([
      TEST_TOPIC_ID,
      secondTopicId,
      secondTopicId,
    ]);
    expect(result.generationStats.attempts).toBe(1);
  });

  it("narrows a legacy topic superset to the uniquely assessed topic and rejects ambiguous attribution", async () => {
    parseResponse.mockReset();
    parseResponse.mockResolvedValue(completedProviderResponse(
      "response-narrowed-topic-review",
      scheduledCalculusQuestionSet(),
    ));
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;
    const calculusTopic = base.knowledgeTopics[0]!;
    const unrelatedTopicId = "88888888-8888-4888-8888-888888888888";
    const target = "Nearby interval estimate at x = 2";
    const supersetContext: SessionGenerationContext = {
      ...base,
      knowledgeTopics: [{
        ...calculusTopic,
        id: unrelatedTopicId,
        title: "Startup funding rights",
        description: "How capital exchanges create ownership or repayment rights.",
        subtopics: ["Debt and equity"],
      }, calculusTopic],
      session: {
        ...base.session,
        topicIds: [unrelatedTopicId, calculusTopic.id],
        contentTargets: [target],
        completionEvidence: ["Estimate the nearby interval rate without notes."],
        reviewConcept: target,
      },
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(supersetContext);

    expect(result.draft.topicIds).toEqual([calculusTopic.id]);
    expect(result.draft.activities.every((activity) => activity.topicId === calculusTopic.id)).toBe(true);
    expect(parseResponse).toHaveBeenCalledTimes(1);

    parseResponse.mockReset();
    await expect(generateSessionWithOpenAI({
      ...supersetContext,
      knowledgeTopics: supersetContext.knowledgeTopics.map((topic, index) => ({
        ...topic,
        title: `General review area ${index + 1}`,
        description: "A broad area used for recurring study and practice.",
        subtopics: [],
      })),
      session: {
        ...supersetContext.session,
        contentTargets: ["Explain the core idea"],
        reviewConcept: "Explain the core idea",
      },
    })).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_coverage_fidelity",
      },
    });
    expect(parseResponse).not.toHaveBeenCalled();
  });

  it("keeps an outside material-backed verification in YOVA while preserving source grounding", async () => {
    parseResponse.mockReset();
    const materialChunkId = "33333333-3333-4333-8333-333333333333";
    const materialName = "krebs-cycle-notes.txt";
    const materialLocation = "Section 4: Electron carriers";
    const materialExcerpt = "During the Krebs cycle, oxidation reactions transfer high-energy electrons to NAD+, producing NADH, and to FAD, producing FADH2.";
    const reviewConcept = "Krebs cycle electron carriers";
    const contentTarget = "The Krebs cycle transfers high-energy electrons to NADH and FADH2";
    const completionEvidence = "Explain how Krebs cycle oxidation reactions produce NADH and FADH2.";
    const groundedReview = {
      questions: [{
        targetIndex: 0,
        title: "Identify the electron transfer",
        body: "During the Krebs cycle, oxidation reactions remove high-energy electrons. Which molecule accepts those electrons to form NADH?",
        choices: ["NAD+", "ATP", "Carbon dioxide", "Oxygen"],
        correctChoiceIndex: 0,
        feedback: "NAD+ accepts high-energy electrons during Krebs cycle oxidation and is reduced to NADH.",
      }, {
        targetIndex: 0,
        title: "Distinguish the two carriers",
        body: "Which statement correctly distinguishes how the Krebs cycle produces the two reduced electron carriers?",
        choices: [
          "NAD+ becomes NADH and FAD becomes FADH2",
          "NADH becomes NAD+ and FADH2 becomes FAD",
          "ATP becomes NADH and carbon dioxide becomes FADH2",
          "Oxygen becomes NADH and glucose becomes FADH2",
        ],
        correctChoiceIndex: 0,
        feedback: "Both carriers accept electrons: NAD+ is reduced to NADH, while FAD is reduced to FADH2.",
      }, {
        targetIndex: 0,
        title: "Predict a carrier change",
        body: "If a Krebs cycle oxidation cannot transfer electrons to FAD, which product would decrease most directly?",
        choices: ["FADH2", "NAD+", "Carbon dioxide", "ATP synthase"],
        correctChoiceIndex: 0,
        feedback: "FADH2 is produced when FAD accepts electrons, so blocking that transfer directly reduces FADH2 production.",
      }],
    };
    parseResponse.mockResolvedValueOnce(completedProviderResponse(
      "response-outside-material-verification",
      groundedReview,
    ));
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")?.context;
    expect(base).toBeDefined();
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: {
        title: "Krebs cycle source practice",
        topic: "How the Krebs cycle produces NADH and FADH2",
        kind: "topic",
        deadline: null,
        sourceMode: "user_materials",
        studyMode: "outside_yova",
        learningIntent: "study",
      },
      planRationale: "Study the learner's source outside YOVA, then return for a short evidence-producing verification.",
      materials: [{
        chunkId: materialChunkId,
        name: materialName,
        text: materialExcerpt,
        truncated: false,
        locationLabel: materialLocation,
        role: "content_source",
      }],
      knowledgeTopics: [{
        ...base!.knowledgeTopics[0]!,
        id: TEST_TOPIC_ID,
        title: reviewConcept,
        description: contentTarget,
        subtopics: [contentTarget],
        origin: "material",
        sourceReferences: [{
          materialId: "44444444-4444-4444-8444-444444444444",
          chunkId: materialChunkId,
          chunkIndex: 0,
          startCharacter: 0,
          endCharacter: materialExcerpt.length,
          locationLabel: materialLocation,
          sectionRole: "content_source",
        }],
      }],
      session: {
        title: `Verify ${reviewConcept}`,
        objective: `Complete an independent guided retrieval check for every original target: ${contentTarget}. Record topic evidence only from those checked answers.`,
        method: "Independent retrieval verification",
        methodReason: "The outside-source method work counted as practice, not proof, so YOVA scheduled this guided return check.",
        estimatedMinutes: 10,
        learningMode: "study",
        topicIds: [TEST_TOPIC_ID],
        contentTargets: [contentTarget],
        completionEvidence: [completionEvidence],
        reviewConcept,
        reviewType: "verify",
      },
      recentResults: [],
      recentInterruptions: [],
      conceptSignals: [],
      scaffoldSignals: [],
      topicCalibrationSignals: [],
    };

    const {
      generateSessionWithOpenAI,
      validateOutsideAppGuidance,
    } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_scheduled_retrieval");
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput) as {
      contentTargets: string[];
      materialGrounding: {
        policy: { supplementationAllowed: boolean };
        excerpts: Array<{ chunkId: string; name: string; text: string }>;
      };
    };
    expect(prompt.contentTargets).toEqual([contentTarget]);
    expect(prompt.materialGrounding).toMatchObject({
      policy: { supplementationAllowed: false },
      excerpts: [{ chunkId: materialChunkId, name: materialName, text: materialExcerpt }],
    });
    expect(result.draft.activities).toHaveLength(3);
    expect(result.draft.activities.every((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.draft.coverage.essentialIdeas).toEqual([contentTarget]);
    expect(result.draft.sourceGrounding?.sourceNames).toEqual([materialName]);
    expect(validateOutsideAppGuidance(result.draft, "outside_yova")).toMatch(/must include an instruction/i);

    await expect(generateSessionWithOpenAI({
      ...context,
      session: {
        ...context.session,
        contentTargets: [
          contentTarget,
          "The Krebs cycle transfers carbon atoms into carbon dioxide",
          "The Krebs cycle produces a small amount of ATP or GTP",
        ],
      },
    })).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_coverage_fidelity",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);

    await expect(generateSessionWithOpenAI({
      ...context,
      materials: [{
        name: "legacy-unmapped-notes.txt",
        text: "A legacy excerpt with no persisted chunk identity cannot be cited authoritatively.",
        truncated: false,
        role: "content_source",
      }, ...context.materials],
    })).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_source_grounding",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(1);
  });

  it("balances the authoritative excerpts across every active material topic", async () => {
    parseResponse.mockReset();
    const secondTopicId = "66666666-6666-4666-8666-666666666666";
    const firstMaterialId = "77777777-7777-4777-8777-777777777771";
    const secondMaterialId = "77777777-7777-4777-8777-777777777772";
    const firstTopicChunkIds = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
    ];
    const secondTopicChunkId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
    const firstTarget = "NAD+ accepts electrons during Krebs cycle oxidation to form NADH";
    const secondTarget = "FAD accepts electrons during Krebs cycle oxidation to form FADH2";
    const firstTopicMaterials = firstTopicChunkIds.map((chunkId, index) => ({
      materialId: firstMaterialId,
      chunkId,
      chunkIndex: index,
      name: "nad-carrier-notes.txt",
      text: index === 0
        ? "Krebs cycle carrier scope: review how NAD+ and FAD accept electrons."
        : `Krebs cycle source section ${index + 1}: NAD+ accepts electrons during oxidation and is reduced to NADH.`,
      truncated: false,
      locationLabel: `NAD section ${index + 1}`,
      role: index === 0 ? "scope_outline" as const : "content_source" as const,
    }));
    const secondTopicMaterial = {
      materialId: secondMaterialId,
      chunkId: secondTopicChunkId,
      chunkIndex: 0,
      name: "fad-carrier-notes.txt",
      text: "During a Krebs cycle oxidation, FAD accepts electrons and is reduced to FADH2.",
      truncated: false,
      locationLabel: "FAD section 1",
      role: "content_source" as const,
    };
    const balancedReview = {
      questions: [{
        targetIndex: 0,
        title: "Identify NADH formation",
        body: "During a Krebs cycle oxidation, which carrier accepts electrons to form NADH?",
        choices: ["NAD+", "FAD", "ATP", "Oxygen"],
        correctChoiceIndex: 0,
        feedback: "NAD+ accepts electrons during the oxidation and is reduced to NADH.",
      }, {
        targetIndex: 1,
        title: "Identify FADH2 formation",
        body: "During a Krebs cycle oxidation, which carrier accepts electrons to form FADH2?",
        choices: ["FAD", "NAD+", "Carbon dioxide", "ATP"],
        correctChoiceIndex: 0,
        feedback: "FAD accepts electrons during the oxidation and is reduced to FADH2.",
      }, {
        targetIndex: 1,
        title: "Predict a blocked FAD transfer",
        body: "If FAD cannot accept electrons during its Krebs cycle oxidation, which reduced carrier decreases directly?",
        choices: ["FADH2", "NADH", "NAD+", "Carbon dioxide"],
        correctChoiceIndex: 0,
        feedback: "FADH2 decreases because it forms only when FAD accepts those electrons.",
      }],
    };
    parseResponse.mockResolvedValueOnce(completedProviderResponse(
      "response-balanced-material-review",
      balancedReview,
    ));
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_delayed_retrieval_self_contained")!.context;
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: {
        ...base.learningGoal,
        title: "Krebs cycle carrier review",
        topic: "How NAD+ and FAD accept electrons during Krebs cycle oxidation",
        sourceMode: "user_materials",
      },
      materials: [...firstTopicMaterials, secondTopicMaterial],
      knowledgeTopics: [{
        ...base.knowledgeTopics[0]!,
        id: TEST_TOPIC_ID,
        title: "NADH formation",
        description: firstTarget,
        origin: "material",
        sourceReferences: firstTopicMaterials.map((material) => ({
          materialId: firstMaterialId,
          chunkId: material.chunkId,
          chunkIndex: material.chunkIndex,
          startCharacter: 0,
          endCharacter: material.text.length,
          locationLabel: material.locationLabel,
          sectionRole: material.role,
        })),
      }, {
        ...base.knowledgeTopics[0]!,
        id: secondTopicId,
        title: "FADH2 formation",
        description: secondTarget,
        origin: "material",
        sourceReferences: [{
          materialId: secondMaterialId,
          chunkId: secondTopicChunkId,
          chunkIndex: 0,
          startCharacter: 0,
          endCharacter: secondTopicMaterial.text.length,
          locationLabel: secondTopicMaterial.locationLabel,
          sectionRole: "content_source",
        }],
      }],
      session: {
        ...base.session,
        title: "Verify Krebs cycle electron carriers",
        objective: `Verify both source-backed targets: ${firstTarget}; ${secondTarget}.`,
        topicIds: [TEST_TOPIC_ID, secondTopicId],
        contentTargets: [firstTarget, secondTarget],
        completionEvidence: [
          "Identify how NAD+ forms NADH.",
          "Identify how FAD forms FADH2.",
        ],
        reviewConcept: firstTarget,
        reviewType: "verify",
      },
      conceptSignals: [],
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    const providerInput = JSON.parse(parseResponse.mock.calls[0]?.[0]?.input as string) as {
      materialGrounding: { excerpts: Array<{ chunkId: string }> };
    };
    const providerChunkIds = providerInput.materialGrounding.excerpts.map((excerpt) => excerpt.chunkId);
    const anchorChunkIds = result.draft.sourceGrounding?.anchors.map((anchor) => anchor.chunkId) ?? [];
    expect(providerChunkIds).toHaveLength(4);
    expect(providerChunkIds).toContain(firstTopicChunkIds[1]);
    expect(providerChunkIds).toContain(secondTopicChunkId);
    expect(anchorChunkIds).toEqual(providerChunkIds);
    expect(result.draft.activities.map((activity) => activity.topicId)).toEqual([
      TEST_TOPIC_ID,
      secondTopicId,
      secondTopicId,
    ]);

    parseResponse.mockResolvedValue(completedProviderResponse(
      "response-mixed-provenance-review",
      balancedReview,
    ));
    const mixedContext: SessionGenerationContext = {
      ...context,
      materials: firstTopicMaterials,
      knowledgeTopics: context.knowledgeTopics.map((topic) => (
        topic.id === secondTopicId
          ? { ...topic, origin: "ai_generated", sourceReferences: [] }
          : topic
      )),
      session: {
        ...context.session,
        // The route may supply knowledge-map order rather than target order.
        // Evidence attribution must come from the target text, never position.
        topicIds: [secondTopicId, TEST_TOPIC_ID],
      },
    };
    const mixedResult = await generateSessionWithOpenAI(mixedContext);
    const mixedProviderInput = JSON.parse(parseResponse.mock.calls[1]?.[0]?.input as string) as {
      targetContracts: Array<{
        targetIndex: number;
        topicId: string;
        provenance: string;
        allowedChunkIds: string[];
      }>;
      materialGrounding: { policy: { supplementationAllowed: boolean } };
    };
    expect(mixedProviderInput.targetContracts).toEqual([
      expect.objectContaining({
        targetIndex: 0,
        topicId: TEST_TOPIC_ID,
        provenance: "mapped_material",
        allowedChunkIds: expect.arrayContaining([firstTopicChunkIds[1]]),
      }),
      expect.objectContaining({
        targetIndex: 1,
        topicId: secondTopicId,
        provenance: "model_knowledge",
        allowedChunkIds: [],
      }),
    ]);
    expect(mixedProviderInput.materialGrounding.policy.supplementationAllowed).toBe(true);
    expect(mixedResult.draft.activities.map((activity) => activity.topicId)).toEqual([
      TEST_TOPIC_ID,
      secondTopicId,
      secondTopicId,
    ]);
    expect(mixedResult.draft.sourceGrounding).toMatchObject({
      mode: "materials_plus_ai",
      supplements: expect.arrayContaining([
        expect.objectContaining({ topic: "FADH2 formation" }),
      ]),
    });

    await expect(generateSessionWithOpenAI({
      ...context,
      materials: firstTopicMaterials,
      knowledgeTopics: context.knowledgeTopics.map((topic) => (
        topic.id === secondTopicId ? { ...topic, sourceReferences: [] } : topic
      )),
    })).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_source_grounding",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });
});

describe("whose words decide the task type", () => {
  async function routingSentToModel(context: SessionGenerationContext) {
    parseResponse.mockReset();
    parseResponse.mockRejectedValue(new Error("provider unavailable"));
    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 1,
        stage: "provider",
        cause: "provider_request",
      },
    });

    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as {
      learningScienceRouting: { taskType: string; allowedMethodIds: string[] };
    };
    return prompt.learningScienceRouting;
  }

  function contextWithGoal(topic: string, sessionWording: string) {
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "biology_initial_teaching")?.context;
    if (!base) throw new Error("Missing the biology fixture context.");

    return {
      ...base,
      learningGoal: { ...base.learningGoal, topic },
      session: { ...base.session, title: sessionWording, objective: sessionWording },
    } satisfies SessionGenerationContext;
  }

  it("follows a clear learner goal even when the generated session says otherwise", async () => {
    // The learner asked to memorise. The model wrote a session that reads as
    // conceptual teaching. Classification weights the generated wording above
    // the learner's, so without an override the task silently changes and the
    // method changes with it.
    const routing = await routingSentToModel(contextWithGoal(
      "Memorize the parts of a plant cell and what each organelle does",
      "Understand why the chloroplast structure explains how it captures light energy",
    ));

    expect(routing.taskType).toBe("memorization");
  });

  it("still classifies from the session when the learner's goal is ambiguous", async () => {
    const routing = await routingSentToModel(contextWithGoal(
      "Get better at this before the test",
      "Work through solving systems of linear equations step by step",
    ));

    expect(routing.taskType).not.toBe("memorization");
  });
});

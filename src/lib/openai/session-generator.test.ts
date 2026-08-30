import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import {
  GeneratedSessionDraftOutputSchema,
  GeneratedSessionDraftProviderOutputSchema,
  type FilledGeneratedSessionDraft,
  type GeneratedSessionDraft,
} from "@/lib/session-generation/schema";
import type { SessionGenerationContext } from "@/lib/openai/session-generator";

const parseResponse = vi.hoisted(() => vi.fn());
const TEST_TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const BIO_TOPIC_IDS = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
  "22222222-2222-4222-8222-222222222223",
] as const;

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
    output_parsed,
    usage: {
      input_tokens: 600,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 300,
    },
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

function calculusFoundationsRecoveryContent() {
  return {
    targetClaims: [
      "The notation f'(a) and dy/dx represent tangent slope and instantaneous rate of change at a specified input.",
      "For differentiable expressions, the derivative of a constant is 0, the derivative of x^n is n x^(n-1), constants can be pulled out, and derivatives distribute over sums and diffs.",
    ],
    topicChecks: [{
      title: "Interpret derivative notation",
      prompt: "For a differentiable function f, explain what f'(a) means geometrically and as a rate of change at x = a.",
      choices: [
        "It is the tangent slope and instantaneous rate at x = a",
        "It is the function value f(a)",
        "It is the average rate from x = 0 to x = a",
        "It is the area under f from x = 0 to x = a",
      ],
      correctChoiceIndex: 0,
      referenceAnswer: "The value f'(a) is the slope of the tangent line to y = f(x) at x = a and the instantaneous rate of change there.",
      feedback: "Derivative notation at an input names both the tangent-line slope and the instantaneous rate of change at that input.",
    }, {
      title: "Apply the basic rules",
      prompt: "What is g'(x) for the differentiable function g(x) = 4x^3 - 5x + 7?",
      choices: ["g'(x) = 12x^2 - 5", "g'(x) = 4x^2 - 5", "g'(x) = 12x^3 - 5x", "g'(x) = 12x^2 + 7"],
      correctChoiceIndex: 0,
      referenceAnswer: "The derivative is g'(x) = 12x^2 - 5 because the constant 7 becomes zero and each remaining term differentiates separately.",
      feedback: "The power rule gives 12x^2, the derivative of -5x is -5, and the constant term differentiates to zero.",
    }],
    independentExtension: {
      title: "Differentiate a fresh function",
      prompt: "Without reopening the model, differentiate h(x) = -2x^4 + 3x^2 - 9 and state which basic derivative rules you used.",
      choices: ["h'(x) = -8x^3 + 6x", "h'(x) = -2x^3 + 3x", "h'(x) = -8x^4 + 6x^2", "h'(x) = -8x^3 + 6x - 9"],
      correctChoiceIndex: 0,
      referenceAnswer: "The derivative is h'(x) = -8x^3 + 6x. Apply the power and constant-multiple rules term by term, and differentiate -9 to zero.",
      feedback: "The correct derivative applies the power and constant-multiple rules to both variable terms and sends the constant to zero.",
    },
    subjectModel: {
      keyIdea: "Derivative notation names a rate, while basic rules calculate that rate term by term.",
      explanation: "At x = a, f'(a) is the tangent-line slope and instantaneous rate of change. To calculate derivatives of basic polynomial expressions, differentiate each term separately: constants become zero, powers use nx^(n-1), and constant factors remain attached.",
      commonMistake: "Keeping a standalone constant or forgetting to multiply by the original exponent.",
      correction: "Differentiate every term separately, drop standalone constants, and multiply each power by its exponent before lowering that exponent by one.",
    },
    modelExample: {
      setup: "Differentiate p(x) = 3x^4 - 2x + 6 with the basic derivative rules.",
      steps: [
        "Use the power and constant-multiple rules: the derivative of 3x^4 is 12x^3.",
        "Differentiate -2x to -2 and the constant 6 to zero, then combine the terms.",
      ],
      takeaway: "The result is p'(x) = 12x^3 - 2 because each term is differentiated independently.",
    },
  };
}

function economicsLearnRecoveryContent() {
  return {
    targetClaims: [
      "An own-price change causes a movement along a demand curve, while a non-price determinant shifts the entire demand curve.",
      "An own-price change causes a movement along a supply curve, while a non-price determinant shifts the entire supply curve.",
      "Higher consumer income can shift demand for a normal good right, while higher input costs can shift supply left.",
    ],
    topicChecks: [{
      title: "Explain a demand movement",
      prompt: "Explain why a fall in the product's own price is a movement along demand rather than a shift of demand.",
      choices: ["Own price changes quantity demanded along the existing curve", "Own price shifts the entire demand curve", "Income always changes when price changes", "Supply determines whether demand moves"],
      correctChoiceIndex: 0,
      referenceAnswer: "A change in the good's own price changes quantity demanded and therefore moves the chosen point along the existing demand curve.",
      feedback: "The good's own price selects a different quantity on the existing demand relationship; a separate determinant would shift that relationship.",
    }, {
      title: "Distinguish a supply movement",
      prompt: "A product's market price rises while production technology and costs stay fixed. What happens to its supply curve representation?",
      choices: ["Quantity supplied rises along the existing curve", "The supply curve shifts right", "The supply curve shifts left", "Demand shifts because price rose"],
      correctChoiceIndex: 0,
      referenceAnswer: "The higher own price causes an increase in quantity supplied represented by movement along the existing supply curve.",
      feedback: "Own price changes quantity supplied along the curve; technology or input-cost changes would shift the curve itself.",
    }, {
      title: "Predict two curve shifts",
      prompt: "For a normal good, consumer income rises while a producer's input costs also rise. Which pair of shifts is expected?",
      choices: ["Demand shifts right and supply shifts left", "Demand shifts left and supply shifts right", "Both curves shift right", "Neither curve shifts"],
      correctChoiceIndex: 0,
      referenceAnswer: "Higher income raises demand for a normal good, shifting demand right, while higher input costs reduce supply, shifting supply left.",
      feedback: "Income is a demand determinant and input cost is a supply determinant, so they shift different curves in opposite directions here.",
    }],
    independentExtension: null,
    subjectModel: {
      keyIdea: "Own price moves the market point along a curve; other determinants shift the complete demand or supply relationship.",
      explanation: "On a demand curve, a change in the good's own price changes quantity demanded along the same curve. On a supply curve, own price changes quantity supplied along the same curve. Income or preferences can shift demand, while technology or input costs can shift supply. For a normal good, higher income shifts demand right; higher input costs shift supply left.",
      commonMistake: "Calling every price-and-quantity change a shift of the curve.",
      correction: "First ask whether the good's own price changed. Own price creates movement along the curve; a different determinant shifts it.",
    },
    modelExample: null,
  };
}

function geneRegulationLearnRecoveryContent() {
  return {
    targetClaims: [
      "DNA methylation near a promoter can reduce transcription by limiting access or recruiting repressive chromatin proteins.",
      "Histone acetylation often loosens chromatin and increases access of transcription machinery to DNA.",
    ],
    topicChecks: [{
      title: "Explain promoter methylation",
      prompt: "Explain how DNA methylation near a promoter can reduce transcription of the associated gene.",
      choices: ["It can reduce factor access or recruit repressive proteins", "It copies the gene into extra chromosomes", "It removes every histone from the chromosome", "It translates the promoter into protein"],
      correctChoiceIndex: 0,
      referenceAnswer: "Promoter methylation can reduce transcription by making the promoter less accessible or by recruiting proteins that maintain repressive chromatin.",
      feedback: "The relevant relationship is between promoter methylation, chromatin access, and transcription rather than DNA copy number or translation.",
    }, {
      title: "Predict histone acetylation",
      prompt: "If histone acetylation increases around a gene, which change is most consistent with the source model?",
      choices: ["Chromatin becomes more accessible and transcription can increase", "Chromatin always condenses and transcription stops", "The DNA sequence is permanently rewritten", "The gene is translated before it is transcribed"],
      correctChoiceIndex: 0,
      referenceAnswer: "Histone acetylation often loosens chromatin, increasing access for transcription machinery and making transcription more likely.",
      feedback: "Acetylation changes chromatin accessibility; it does not rewrite the DNA sequence or reverse transcription and translation.",
    }],
    independentExtension: null,
    subjectModel: {
      keyIdea: "Chemical marks can regulate genes by changing how accessible DNA is to the transcription machinery.",
      explanation: "DNA methylation near a promoter can reduce transcription by blocking access or recruiting repressive chromatin proteins. Histone acetylation usually weakens histone-DNA interactions, loosens chromatin, and increases access for transcription machinery. These marks regulate use of the sequence rather than changing the sequence itself.",
      commonMistake: "Epigenetic marks change the nucleotide sequence of the gene.",
      correction: "They usually change chromatin access and gene expression while leaving the underlying DNA sequence intact.",
    },
    modelExample: null,
  };
}

function callStackLearnRecoveryContent() {
  return {
    targetClaims: [
      "A recursive function pushes a new call frame for each unfinished call and resolves those frames in last-in, first-out order after reaching its base case.",
    ],
    topicChecks: [{
      title: "Trace the guided call stack",
      prompt: "For factorial(3), which call frame resolves first after factorial(1) reaches the base case?",
      choices: ["factorial(2)", "factorial(3)", "factorial(1) again", "All frames resolve simultaneously"],
      correctChoiceIndex: 0,
      referenceAnswer: "After factorial(1) returns, factorial(2) is the next unfinished frame and resolves before factorial(3).",
      feedback: "The call stack is last-in, first-out, so the most recently suspended frame resumes first after the base case returns.",
    }],
    independentExtension: {
      title: "Trace a fresh recursive call",
      prompt: "Trace sumTo(4), where sumTo(n) returns 0 at n = 0 and otherwise returns n + sumTo(n - 1). List the frames in the order they resolve and give the result.",
      choices: ["0, 1, 2, 3, 4 and result 10", "4, 3, 2, 1, 0 and result 4", "All frames resolve together and result 0", "The function never reaches a base case"],
      correctChoiceIndex: 0,
      referenceAnswer: "After sumTo(0) returns 0, the frames resolve as sumTo(1), sumTo(2), sumTo(3), then sumTo(4), producing 1, 3, 6, and finally 10.",
      feedback: "The base case starts the return chain, and each suspended frame adds its current n as the stack unwinds in last-in, first-out order.",
    },
    subjectModel: {
      keyIdea: "Recursive calls pause in separate stack frames until a base case starts the return sequence.",
      explanation: "Each recursive call creates a frame that stores its current argument and waits for the nested call. Reaching the base case stops new calls. The newest waiting frame resumes first, so the stack unwinds in last-in, first-out order until the original call returns its result.",
      commonMistake: "Every recursive frame keeps changing the same shared argument at once.",
      correction: "Each call frame has its own argument and paused execution point; frames resume one at a time as nested calls return.",
    },
    modelExample: {
      setup: "Trace factorial(3), with factorial(1) as the base case.",
      steps: [
        "factorial(3) pauses after calling factorial(2), which pauses after calling factorial(1).",
        "factorial(1) returns 1, so factorial(2) resumes and returns 2 times 1.",
        "factorial(3) resumes last and returns 3 times 2, which is 6.",
      ],
      takeaway: "The most recently created unfinished frame resumes first when the base case returns.",
    },
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
  it("keeps cross-field misses out of the provider parser and in YOVA's final validator", () => {
    const draft = structuredClone(learningDraft("model"));
    draft.activities[0]!.teaching = null;
    draft.activities[0]!.methodRuntime = {
      kind: "retrieval_round",
      format: "broad_recall_v1",
      sourceClosedReminder: "Close the source before recalling the idea.",
      prompts: [{
        prompt: "Recall the central relationship.",
        expectedAnswer: "The central relationship in a complete sentence.",
        hint: "Use the relationship named in the lesson.",
      }],
      comparisonInstructions: null,
      gapChecklist: null,
      correctionInstruction: null,
      transferPrompt: null,
      targetBindings: null,
    };
    const multipleChoice = draft.activities.find((activity) => activity.type === "multiple_choice");
    expect(multipleChoice).toBeDefined();
    multipleChoice!.correctAnswer = "An answer the provider omitted from the choices";

    expect(GeneratedSessionDraftProviderOutputSchema.safeParse(draft).success).toBe(true);
    const final = GeneratedSessionDraftOutputSchema.safeParse(draft);

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
        path: ["activities", 0, "methodRuntime", "comparisonInstructions"],
        message: "Broad recall requires delayed source-comparison instructions.",
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
    const invalidResponse = GeneratedSessionDraftProviderOutputSchema.safeParse({});
    expect(invalidResponse.success).toBe(false);
    if (invalidResponse.success) return;
    parseResponse
      .mockRejectedValueOnce(invalidResponse.error)
      .mockRejectedValueOnce(invalidResponse.error);

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context!)).rejects.toMatchObject({
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
    });
    expect(parseResponse).toHaveBeenCalledTimes(2);
  });

  it("preserves completed-attempt usage when the repair response throws an SDK ZodError", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const invalidRepair = GeneratedSessionDraftProviderOutputSchema.safeParse({});
    expect(invalidRepair.success).toBe(false);
    if (invalidRepair.success) return;
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-full-study", {}))
      .mockRejectedValueOnce(invalidRepair.error);

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context!)).rejects.toMatchObject({
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
    repairedDraft.activities.forEach((activity) => {
      if (activity.type === "multiple_choice" || activity.type === "free_response") {
        activity.practiceIntent = "baseline";
      }
    });
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
      failedValidator: "session_required_typed_recall",
      repairAttempted: true,
      repairSucceeded: true,
      repairReason: "semantic_validation",
      validationIssueCode: "session_required_typed_recall",
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
    )).map((activity) => activity.practiceIntent)).toEqual(["baseline", "baseline"]);
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

describe("bounded teaching-first recovery", () => {
  it("recovers an unrelated outside economics lesson with one narrow subject-model call", async () => {
    parseResponse.mockReset();
    const context = economicsLearnContext();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-economics-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-economics-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("safe-economics-learn", economicsLearnRecoveryContent()));

    const {
      generateSessionWithOpenAI,
      validateOutsideAppGuidance,
      validateSubstantiveTeaching,
    } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
      "yova_safe_learn_recovery",
    ]);
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      inputTokens: 1_800,
      outputTokens: 900,
      failedValidator: "session_structure",
      repairSucceeded: true,
      recoveryMode: "safe_learn",
    });
    expect(result.draft.activities[0]).toMatchObject({
      methodPhase: "model",
      type: "instruction",
      requiredForCompletion: true,
    });
    expect(result.draft.activities[0]?.teaching?.explanation).toContain("own price");
    expect(result.draft.coverage.evidenceMap.map((mapping) => mapping.activityConcept)).toEqual(
      context.session.contentTargets,
    );
    expect(result.draft.activities.some((activity) => activity.type === "free_response" && activity.requiredForCompletion)).toBe(true);
    expect(validateSubstantiveTeaching(result.draft)).toBeNull();
    expect(validateOutsideAppGuidance(result.draft, "outside_yova")).toBeNull();
    await expectCompleteValidatorPass(result.draft, context, "self_explanation");
  });

  it("keeps an arbitrary inside biology lesson grounded in mapped learner material", async () => {
    parseResponse.mockReset();
    const base = economicsLearnContext();
    const topicIds = [
      "71111111-1111-4111-8111-111111111111",
      "72222222-2222-4222-8222-222222222222",
    ];
    const targets = [
      "Promoter DNA methylation and reduced transcription",
      "Histone acetylation and increased chromatin access",
    ];
    const materialText = "DNA methylation near a promoter can reduce transcription by limiting transcription-factor access or recruiting repressive chromatin proteins. Histone acetylation often loosens chromatin and increases access of transcription machinery to DNA. These marks regulate expression without changing the DNA sequence.";
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: {
        ...base.learningGoal,
        title: "Understand epigenetic gene regulation",
        topic: "Explain how promoter methylation and histone acetylation change transcription",
        sourceMode: "user_materials",
        studyMode: "inside_yova",
      },
      materials: [{
        materialId: "73333333-3333-4333-8333-333333333333",
        chunkId: "74444444-4444-4444-8444-444444444444",
        chunkIndex: 0,
        name: "gene-regulation-notes.txt",
        text: materialText,
        truncated: false,
        locationLabel: "Epigenetics notes",
        role: "content_source",
      }],
      knowledgeTopics: targets.map((target, index) => ({
        id: topicIds[index]!,
        title: target,
        description: target,
        subtopics: [],
        prerequisiteTopicIds: [],
        status: "not_started" as const,
        initialEvidence: null,
        sourceReferences: [],
        origin: "material" as const,
        deferred: null,
      })),
      session: {
        ...base.session,
        title: "Explain two epigenetic controls",
        objective: "Learn and explain how promoter DNA methylation and histone acetylation change transcription through chromatin access.",
        estimatedMinutes: 10,
        topicIds,
        contentTargets: targets,
        completionEvidence: targets.map((target) => `Explain ${target} without the model visible.`),
      },
    };
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-epigenetics-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-epigenetics-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("safe-epigenetics-learn", geneRegulationLearnRecoveryContent()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse.mock.calls[2]?.[0]?.text?.format?.name).toBe("yova_safe_learn_recovery");
    const recoveryInput = parseResponse.mock.calls[2]?.[0]?.input as string;
    expect(recoveryInput).toContain(materialText);
    expect(result.draft.sourceGrounding).toMatchObject({
      mode: "materials_only",
      sourceNames: ["gene-regulation-notes.txt"],
    });
    expect(result.draft.coverage.deferredContent).toEqual([]);
    expect(result.generationStats.recoveryMode).toBe("safe_learn");
    await expectCompleteValidatorPass(result.draft, context, "self_explanation");
  });

  it("keeps ordinary mixed material and AI targets inside their authoritative source boundaries", async () => {
    parseResponse.mockReset();
    const base = economicsLearnContext();
    const materialTopicId = "75555555-5555-4555-8555-555555555555";
    const aiTopicId = "76666666-6666-4666-8666-666666666666";
    const materialId = "77777777-7777-4777-8777-777777777777";
    const chunkId = "78888888-8888-4888-8888-888888888888";
    const targets = [
      "Promoter DNA methylation and reduced transcription",
      "Histone acetylation and increased chromatin access",
    ];
    const materialText = "DNA methylation near a promoter can reduce transcription by limiting transcription-factor access or recruiting repressive chromatin proteins.";
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: {
        ...base.learningGoal,
        title: "Understand epigenetic gene regulation",
        topic: "Explain promoter methylation and histone acetylation",
        sourceMode: "user_materials",
        studyMode: "inside_yova",
      },
      materials: [{
        materialId,
        chunkId,
        chunkIndex: 0,
        name: "promoter-notes.txt",
        text: materialText,
        truncated: false,
        locationLabel: "Promoter methylation",
        role: "content_source",
      }],
      knowledgeTopics: [{
        id: materialTopicId,
        title: targets[0]!,
        description: "How promoter methylation changes transcription-factor access and transcription.",
        subtopics: ["Promoter methylation"],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [{
          materialId,
          chunkId,
          chunkIndex: 0,
          startCharacter: 0,
          endCharacter: materialText.length,
          locationLabel: "Promoter methylation",
          sectionRole: "content_source",
        }],
        origin: "material",
        deferred: null,
      }, {
        id: aiTopicId,
        title: targets[1]!,
        description: "How histone acetylation changes chromatin access and transcription.",
        subtopics: ["Histone acetylation"],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
      }],
      session: {
        ...base.session,
        title: "Explain two epigenetic controls",
        objective: "Learn how promoter methylation and histone acetylation regulate transcription.",
        estimatedMinutes: 10,
        topicIds: [materialTopicId, aiTopicId],
        contentTargets: targets,
        completionEvidence: targets.map((target) => `Explain ${target} without the model visible.`),
      },
    };
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-mixed-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-mixed-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("safe-mixed-learn", geneRegulationLearnRecoveryContent()));

    const {
      generateSessionWithOpenAI,
      ordinarySessionProvenanceContract,
      validateMixedProvenanceEvidenceAttribution,
    } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);
    const fullInput = JSON.parse((parseResponse.mock.calls[0]?.[0]?.input as string).split("\n").slice(1).join("\n"));
    expect(fullInput.sessionProvenanceContract).toMatchObject({
      version: "mixed_provenance_v1",
      mode: "mixed_materials_and_ai",
      targetProvenance: [{
        targetIndex: 0,
        topicId: materialTopicId,
        provenance: "mapped_material",
        allowedChunkIds: [chunkId],
      }, {
        targetIndex: 1,
        topicId: aiTopicId,
        provenance: "model_knowledge",
        allowedChunkIds: [],
      }],
      modelKnowledgeTopics: [targets[1]],
    });
    const recoveryInput = JSON.parse((parseResponse.mock.calls[2]?.[0]?.input as string).split("\n").slice(1).join("\n"));
    expect(recoveryInput.targetProvenance).toEqual(fullInput.sessionProvenanceContract.targetProvenance);
    expect(result.draft.sourceGrounding).toMatchObject({
      mode: "materials_plus_ai",
      anchors: [expect.objectContaining({ chunkId })],
      supplements: [expect.objectContaining({ topic: targets[1] })],
    });
    expect(result.generationStats.recoveryMode).toBe("safe_learn");
    await expectCompleteValidatorPass(result.draft, context, "self_explanation");

    const crossedSourceDraft = structuredClone(result.draft);
    const firstEvidenceConcept = crossedSourceDraft.coverage.evidenceMap[0]?.activityConcept;
    const firstEvidenceActivity = crossedSourceDraft.activities.find((activity) => (
      activity.requiredForCompletion && activity.concept === firstEvidenceConcept
    ));
    expect(firstEvidenceActivity).toBeDefined();
    firstEvidenceActivity!.topicId = aiTopicId;
    expect(validateMixedProvenanceEvidenceAttribution(
      crossedSourceDraft,
      ordinarySessionProvenanceContract(context).targetProvenance,
      crossedSourceDraft.coverage.evidenceMap.map((mapping, index) => ({
        essentialIdea: mapping.essentialIdea,
        target: targets[index]!,
      })),
    )).toContain("different topic's source authority");
  });

  it("fails before a provider call when mixed targets cannot be attributed uniquely", async () => {
    parseResponse.mockReset();
    const base = economicsLearnContext();
    const materialId = "79999999-9999-4999-8999-999999999999";
    const chunkId = "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: { ...base.learningGoal, sourceMode: "user_materials", studyMode: "inside_yova" },
      materials: [{
        materialId,
        chunkId,
        chunkIndex: 0,
        name: "one-topic.txt",
        text: "Mitosis separates duplicated chromosomes into two daughter nuclei during cell division.",
        truncated: false,
        locationLabel: "Mitosis",
        role: "content_source",
      }],
      knowledgeTopics: [{
        id: base.session.topicIds[0]!,
        title: "Mitosis chromosome separation",
        description: "How mitosis separates duplicated chromosomes.",
        subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null,
        sourceReferences: [{
          materialId, chunkId, chunkIndex: 0, startCharacter: 0, endCharacter: 90,
          locationLabel: "Mitosis", sectionRole: "content_source",
        }],
        origin: "material", deferred: null,
      }, {
        id: base.session.topicIds[1]!,
        title: "Meiosis genetic variation",
        description: "How meiosis creates variation through recombination and assortment.",
        subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null,
        sourceReferences: [], origin: "ai_generated", deferred: null,
      }],
      session: {
        ...base.session,
        topicIds: base.session.topicIds.slice(0, 2),
        contentTargets: ["Explain the important process and its result"],
        completionEvidence: ["Explain the process without notes."],
      },
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      generationStats: {
        attempts: 0,
        failedValidator: "session_coverage_fidelity",
      },
    });
    expect(parseResponse).not.toHaveBeenCalled();
  });

  it("treats an AI-only active continuation as model knowledge after material topics were scoped away", async () => {
    parseResponse.mockReset();
    parseResponse.mockRejectedValue(new Error("provider unavailable"));
    const base = economicsLearnContext();
    const aiTopic = base.knowledgeTopics[1]!;
    const aiTarget = base.session.contentTargets![1]!;
    const context: SessionGenerationContext = {
      ...base,
      learningGoal: {
        ...base.learningGoal,
        sourceMode: "user_materials",
        studyMode: "inside_yova",
      },
      // A continuation scoper can legitimately remove every completed
      // material chunk while leaving an AI-origin deferred topic active.
      materials: [],
      knowledgeTopics: [aiTopic],
      session: {
        ...base.session,
        topicIds: [aiTopic.id],
        contentTargets: [aiTarget],
        completionEvidence: [`Explain ${aiTarget} without the model visible.`],
      },
    };

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toThrow("provider unavailable");
    expect(parseResponse).toHaveBeenCalledTimes(1);
    const providerInput = JSON.parse((parseResponse.mock.calls[0]?.[0]?.input as string).split("\n").slice(1).join("\n"));
    expect(providerInput.learningGoal.sourceMode).toBe("yova_generated");
    expect(providerInput.materials).toEqual([]);
    expect(providerInput.sourceGroundingPolicy).toBeNull();
  });

  it("recovers an arbitrary computing lesson with a complete model and fresh independent trace", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "javascript_scaffold_fading")!.context;
    const target = "Recursive call frames and last-in first-out stack unwinding";
    const context: SessionGenerationContext = {
      ...base,
      sessionArchitectureVersion: "filled_teaching_v1",
      learningGoal: {
        ...base.learningGoal,
        title: "Trace recursive TypeScript functions",
        topic: "Trace recursive function calls through the call stack and base case",
      },
      session: {
        ...base.session,
        title: "Trace a recursive call stack",
        objective: "Learn how recursive calls create stack frames and resolve in last-in, first-out order after the base case.",
        method: "Worked example fading",
        methodReason: "A complete call trace should precede a fresh unsupported trace.",
        estimatedMinutes: 15,
        topicIds: [TEST_TOPIC_ID],
        contentTargets: [target],
        deferredContentTargets: [],
        completionEvidence: ["Trace a fresh recursive call stack and calculate its return value."],
        reviewConcept: null,
        reviewType: null,
      },
      knowledgeTopics: [{
        ...base.knowledgeTopics[0]!,
        id: TEST_TOPIC_ID,
        title: target,
        description: "How recursive call frames pause and unwind after a base case.",
        subtopics: ["call frames", "base case", "stack unwinding"],
      }],
      learnerProfile: null,
      sessionAdjustment: null,
      recentResults: [],
      recentInterruptions: [],
      conceptSignals: [],
      scaffoldSignals: [],
      topicCalibrationSignals: [],
    };
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-stack-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-stack-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("safe-stack-learn", callStackLearnRecoveryContent()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(result.draft.methodBriefing.methodId).toBe("worked_example_fading");
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "model",
      "guided_practice",
      "independent_practice",
    ]);
    expect(result.draft.activities[0]?.teaching?.example?.steps).toHaveLength(3);
    expect(result.draft.activities[2]).toMatchObject({
      type: "free_response",
      requiredForCompletion: true,
    });
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      inputTokens: 1_800,
      outputTokens: 900,
      recoveryMode: "safe_learn",
    });
    await expectCompleteValidatorPass(result.draft, context, "worked_example_fading");
  });

  it("fails closed after a provider-level teaching recovery failure so the route can refund the one claim", async () => {
    parseResponse.mockReset();
    const context = economicsLearnContext();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-refund-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-refund-repair", {}))
      .mockRejectedValueOnce(new Error("provider unavailable"));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        inputTokens: 1_200,
        outputTokens: 600,
        repairSucceeded: false,
        recoveryMode: "safe_learn",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(3);
  });

  it("does not begin a third provider call when the absolute route budget must be reserved for settlement", async () => {
    parseResponse.mockReset();
    const context = economicsLearnContext();
    const startedAt = new Date("2026-08-21T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(startedAt);
    parseResponse
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(startedAt.getTime() + 35_000));
        return completedProviderResponse("invalid-budget-initial", {});
      })
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(startedAt.getTime() + 70_000));
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
          failedValidator: "session_provider_request",
          repairAttempted: true,
          repairSucceeded: null,
        },
      });

      expect(parseResponse).toHaveBeenCalledTimes(2);
      expect(parseResponse.mock.calls.map((call) => call[1])).toEqual([
        expect.objectContaining({ maxRetries: 0, timeout: 35_000, signal: expect.any(AbortSignal) }),
        expect.objectContaining({ maxRetries: 0, timeout: 35_000, signal: expect.any(AbortSignal) }),
      ]);
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
      .rejects.toThrow("provider unavailable");

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

describe("multi-target study recovery", () => {
  it("server-normalizes a recognition-only challenge study session without making a recovery call", async () => {
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
    const typedRecall = result.draft.activities.find((activity) => activity.type === "free_response");
    expect(typedRecall).toMatchObject({
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

  it("uses the bounded source-grounded path directly for a shortened material session", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const materialText = "Cells couple energy-releasing reactions to energy-requiring work. ATP hydrolysis releases free energy that can drive a coupled cellular reaction.";
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: { ...base!.learningGoal, sourceMode: "user_materials" },
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
        ...base!.session,
        estimatedMinutes: 15,
        deferredContentTargets: ["Membrane transport applications"],
        completionEvidence: base!.session.completionEvidence?.slice(0, 2),
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
    expect(result.generationStats).toMatchObject({
      attempts: 1,
      firstAttemptPassed: true,
      repairAttempted: false,
      recoveryMode: "safe_study",
    });
    expect(result.draft.coverage.deferredContent).toEqual(["Membrane transport applications"]);
    expect(result.draft.sourceGrounding?.sourceNames).toEqual(["shortened-bioenergetics-notes.txt"]);
  });

  it("keeps compact recovery source-grounded for mapped learner materials", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const materialText = "Cells couple energy-releasing reactions to energy-requiring work. ATP hydrolysis releases free energy that can drive a coupled cellular reaction.";
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: {
        ...base!.learningGoal,
        sourceMode: "user_materials",
      },
      materials: [{
        materialId: "31111111-1111-4111-8111-111111111111",
        chunkId: "32222222-2222-4222-8222-222222222222",
        chunkIndex: 0,
        name: "bioenergetics-notes.txt",
        text: materialText,
        truncated: false,
        locationLabel: "Uploaded text",
        role: "content_source",
      }],
      knowledgeTopics: base!.knowledgeTopics.map((topic) => ({
        ...topic,
        origin: "material" as const,
      })),
    };
    const invalidFullDraft = oversizedStudyDraft();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-material-initial", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("invalid-material-repair", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("material-safe-recovery", compactBioRecoveryContent()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse.mock.calls[2]?.[0]?.text?.format?.name).toBe("yova_safe_study_recovery");
    expect(result.generationStats.recoveryMode).toBe("safe_study");
    expect(result.draft.sourceGrounding).toMatchObject({
      mode: "materials_only",
      sourceNames: ["bioenergetics-notes.txt"],
      anchors: [{
        chunkId: "32222222-2222-4222-8222-222222222222",
        excerpt: materialText,
      }],
    });
    const recoveryInput = parseResponse.mock.calls[2]?.[0]?.input as string;
    expect(recoveryInput).toContain('"sourceMode":"user_materials"');
    expect(recoveryInput).toContain(materialText);
    await expectCompleteValidatorPass(result.draft, context);
  });

  it("recovers the one-topic two-target Bioenergetics session with typed recall and meaningful choice", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const invalidFullDraft = oversizedStudyDraft();
    const recoveryContent = {
      targetClaims: [
        "Cells transfer energy from energy-releasing reactions into energy-requiring cellular work through coupled chemical processes.",
        "ATP hydrolysis releases free energy that cells couple to energy-requiring reactions and cellular work.",
      ],
      topicChecks: [{
        title: "Explain cellular energy transfer",
        prompt: "Without notes, explain how cells use and transfer energy from energy-releasing reactions into cellular work.",
        choices: [
          "Cells couple energy-releasing reactions to energy-requiring work",
          "Cells create energy from matter whenever work is required",
          "Cells use only heat released by spontaneous reactions",
          "Cells store all usable energy permanently in glucose",
        ],
        correctChoiceIndex: 0,
        referenceAnswer: "Cells transfer energy by coupling energy released by favorable reactions to energy-requiring cellular work through chemical intermediates.",
        feedback: "A complete explanation connects an energy-releasing reaction to a specific energy-requiring process rather than saying cells create energy.",
      }, {
        title: "Check ATP energy coupling",
        prompt: "Which statement correctly explains how ATP hydrolysis and energy coupling can drive an energy-requiring cellular reaction?",
        choices: [
          "ATP hydrolysis is coupled to the reaction so the combined process releases free energy",
          "ATP hydrolysis raises the activation energy until the reaction becomes favorable",
          "ATP stores heat that directly changes an endergonic reaction into combustion",
          "ATP hydrolysis creates new energy that the cell did not previously contain",
        ],
        correctChoiceIndex: 0,
        referenceAnswer: "Cells couple ATP hydrolysis to an energy-requiring reaction so the free-energy change of the combined process is favorable.",
        feedback: "Coupling links the favorable free-energy change of ATP hydrolysis to the energy-requiring reaction; it does not create energy.",
      }],
      independentExtension: null,
      subjectModel: {
        keyIdea: "Cells transfer energy by coupling reactions, often through ATP hydrolysis.",
        explanation: "Energy-releasing reactions can drive energy-requiring cellular work when the processes are chemically coupled. ATP hydrolysis is one common coupling mechanism because its favorable free-energy change can make the combined process favorable.",
        commonMistake: "ATP hydrolysis creates new energy for the cell.",
        correction: "ATP transfers usable free energy through a coupled reaction; it does not create energy.",
      },
      modelExample: null,
    };
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-initial", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("invalid-repair", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("safe-recovery", recoveryContent));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context!);

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls[2]?.[0]?.text?.format?.name).toBe("yova_safe_study_recovery");
    expect(result.draft.methodBriefing.methodId).toBe("retrieval_practice");
    expect(result.draft.activities.some((activity) => (
      activity.requiredForCompletion && activity.type === "free_response"
    ))).toBe(true);
    const multipleChoice = result.draft.activities.find((activity) => activity.type === "multiple_choice");
    expect(multipleChoice).toMatchObject({
      topicId: context!.session.topicIds[0],
      requiredForCompletion: true,
      choices: recoveryContent.topicChecks[1]!.choices,
      correctAnswer: recoveryContent.topicChecks[1]!.choices[0],
    });
    expect(result.draft.activities.at(-1)).toMatchObject({
      methodPhase: "schedule_return",
      requiredForCompletion: false,
    });
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      failedValidator: "session_time_budget",
      repairSucceeded: true,
      recoveryMode: "safe_study",
    });
    const recoveryInput = parseResponse.mock.calls[2]?.[0]?.input as string;
    expect(recoveryInput).not.toContain('"personalization"');
    expect(recoveryInput).not.toContain('"recentInterruptions"');
    expect(recoveryInput).not.toContain('"recentResults"');
    await expectCompleteValidatorPass(result.draft, context!);
  });

  it("recovers after repeated structured output failures with the same complete validator", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const schemaFailure = Object.assign(new Error("invalid guided-session schema"), { name: "ZodError" });
    parseResponse
      .mockRejectedValueOnce(schemaFailure)
      .mockResolvedValueOnce(completedProviderResponse("invalid-structured-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("valid-safe-recovery", compactBioRecoveryContent()));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context!);
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      failedValidator: "session_structure",
      repairSucceeded: true,
      repairReason: "structured_output",
      recoveryMode: "safe_study",
    });
    await expectCompleteValidatorPass(result.draft, context!);

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
      "yova_safe_study_recovery",
    ]);
  });

  it("recovers the production derivative-foundations session without changing the router-selected method", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_demonstrated_foundations_study_25")?.context;
    expect(context).toBeDefined();
    const recoveryContent = calculusFoundationsRecoveryContent();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-calculus-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-calculus-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("safe-calculus-recovery", recoveryContent));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context!);

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
      "yova_safe_study_recovery",
    ]);
    expect(result.draft.methodBriefing.methodId).toBe("worked_example_fading");
    expect(result.draft.activities.map((activity) => activity.methodPhase)).toEqual([
      "model",
      "guided_practice",
      "independent_practice",
      "independent_practice",
    ]);
    expect(result.draft.coverage.essentialIdeas).toEqual(recoveryContent.targetClaims);
    expect(result.draft.coverage.completionEvidence).toEqual(context!.session.completionEvidence);
    expect(result.draft.activities.filter((activity) => (
      activity.topicId === context!.session.topicIds[1]
      && activity.methodPhase === "independent_practice"
    ))).toHaveLength(2);
    expect(result.draft.activities[1]?.body).toMatch(/Cue: use the model/);
    expect(result.draft.activities[1]?.body).toContain(`Target: ${context!.session.contentTargets![0]}`);
    expect(result.draft.activities[2]?.body).toContain(`Target: ${context!.session.contentTargets![1]}`);
    expect(result.draft.activities[2]?.body).toContain("What is g'(x)");
    expect(result.draft.activities.at(-1)?.body).toMatch(/model closed/i);
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      failedValidator: "session_structure",
      repairSucceeded: true,
      repairReason: "structured_output",
      recoveryMode: "safe_study",
      validationIssueCode: "session_full_structure",
    });

    const recoveryInput = parseResponse.mock.calls[2]?.[0]?.input as string;
    expect(JSON.parse(recoveryInput.slice(recoveryInput.indexOf("\n") + 1))).toMatchObject({
      recoveryMethodId: "worked_example_fading",
      session: {
        title: "Verify derivative foundations",
        targets: context!.session.contentTargets,
        completionEvidence: context!.session.completionEvidence,
      },
    });
    expect(recoveryInput).not.toContain('"personalization"');
    expect(recoveryInput).not.toContain('"recentInterruptions"');
    expect(recoveryInput).not.toContain('"recentResults"');
    await expectCompleteValidatorPass(result.draft, context!, "worked_example_fading");
  });

  it("fails closed when the worked-example recovery omits its model and fresh independent extension", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "calculus_demonstrated_foundations_study_25")?.context;
    expect(context).toBeDefined();
    const malformedRecovery = {
      ...calculusFoundationsRecoveryContent(),
      independentExtension: null,
      modelExample: null,
    };
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-calculus-initial", {}))
      .mockResolvedValueOnce(completedProviderResponse("invalid-calculus-repair", {}))
      .mockResolvedValueOnce(completedProviderResponse("incomplete-calculus-recovery", malformedRecovery));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context!)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        failedValidator: "session_structure",
        repairSucceeded: false,
        recoveryMode: "safe_study",
        validationIssueCode: "session_recovery_structure",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(3);
  });

  it("fails closed after a malformed narrow recovery without making a fourth provider call", async () => {
    parseResponse.mockReset();
    const context = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(context).toBeDefined();
    const invalidFullDraft = oversizedStudyDraft();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-initial", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("invalid-repair", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("malformed-safe-recovery", {}));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI(context!)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        failedValidator: "session_time_budget",
        repairSucceeded: false,
        recoveryMode: "safe_study",
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(3);
  });

  it("recovers three authoritative Bioenergetics topics without collapsing their checks", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const targets = [
      "ATP coupling in endergonic and exergonic reactions",
      "Enzyme effects on activation energy and reaction rate",
      "Oxidation, reduction, NADH, and FADH2",
    ];
    const context: SessionGenerationContext = {
      ...base!,
      learningGoal: {
        ...base!.learningGoal,
        title: "Bioenergetics Test Preparation",
        topic: "ATP coupling, enzymes, and redox carriers",
      },
      knowledgeTopics: [{
        id: BIO_TOPIC_IDS[0],
        title: "ATP coupling",
        description: "How ATP hydrolysis couples endergonic and exergonic reactions.",
        subtopics: ["Endergonic reactions", "Exergonic reactions", "ATP hydrolysis"],
        prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null,
      }, {
        id: BIO_TOPIC_IDS[1],
        title: "Enzymes and activation energy",
        description: "How enzymes change activation energy and reaction rate.",
        subtopics: ["Activation energy", "Reaction rate"],
        prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null,
      }, {
        id: BIO_TOPIC_IDS[2],
        title: "Redox electron carriers",
        description: "Oxidation, reduction, NADH, and FADH2 in energy transfer.",
        subtopics: ["Oxidation", "Reduction", "NADH", "FADH2"],
        prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null,
      }],
      session: {
        ...base!.session,
        title: "Verify Bioenergetics prerequisites",
        objective: "Verify the demonstrated prerequisites and identify any specific repair needed before cellular respiration.",
        topicIds: [BIO_TOPIC_IDS[2], BIO_TOPIC_IDS[0], BIO_TOPIC_IDS[1]],
        contentTargets: targets,
        completionEvidence: [
          "Explain ATP coupling without support",
          "Explain how enzymes change activation energy and rate",
          "Distinguish oxidation and reduction using NADH or FADH2",
        ],
      },
      recentInterruptions: [{
        occurredAt: "2026-08-15T10:00:00.000Z",
        plannedMinutes: 25,
        actualMinutes: 6,
        completedSteps: 1,
        totalSteps: 4,
      }, {
        occurredAt: "2026-08-16T10:00:00.000Z",
        plannedMinutes: 25,
        actualMinutes: 7,
        completedSteps: 1,
        totalSteps: 4,
      }],
    };
    const recoveryContent = {
      targetClaims: [
        "ATP hydrolysis is exergonic and can be coupled to an endergonic reaction so the combined free-energy change is favorable.",
        "Enzymes lower activation energy and increase reaction rate without changing the reaction's overall free-energy change.",
        "Oxidation loses electrons, reduction gains electrons, and NADH and FADH2 carry high-energy electrons between reactions.",
      ],
      topicChecks: [{
        title: "Explain ATP coupling",
        prompt: "Without notes, explain how exergonic ATP hydrolysis can be coupled to drive an endergonic cellular reaction.",
        choices: ["Coupling makes the combined free-energy change favorable", "Coupling makes ATP hydrolysis endergonic", "Coupling removes all activation energy", "Coupling creates energy"],
        correctChoiceIndex: 0,
        referenceAnswer: "The exergonic free-energy change of ATP hydrolysis can outweigh the endergonic change when the reactions are coupled, making the combined process favorable.",
        feedback: "The key relationship is the favorable combined free-energy change, not the creation of energy or removal of activation energy.",
      }, {
        title: "Check enzyme effects",
        prompt: "Which statement correctly relates an enzyme to activation energy and the rate of a biochemical reaction?",
        choices: ["It lowers activation energy and increases reaction rate", "It raises activation energy and increases reaction rate", "It changes the reaction's overall free-energy change", "It is consumed to supply reaction energy"],
        correctChoiceIndex: 0,
        referenceAnswer: "An enzyme lowers the activation-energy barrier and therefore increases reaction rate without changing the overall free-energy change.",
        feedback: "Enzymes change the kinetic barrier and rate; they do not supply energy or change the reaction's thermodynamic free-energy difference.",
      }, {
        title: "Check redox carriers",
        prompt: "Which statement correctly connects oxidation, reduction, NADH, and FADH2 during cellular energy transfer?",
        choices: ["Oxidation loses electrons while reduced NADH and FADH2 carry electrons", "Oxidation gains electrons while NADH destroys electrons", "Reduction always releases oxygen while FADH2 stores heat", "NADH and FADH2 are enzymes that lower activation energy"],
        correctChoiceIndex: 0,
        referenceAnswer: "Oxidation is electron loss and reduction is electron gain; NADH and FADH2 are reduced carriers that transport high-energy electrons.",
        feedback: "Redox tracks electron transfer: oxidation loses electrons, reduction gains them, and NADH or FADH2 can carry the reduced electrons.",
      }],
      independentExtension: null,
      subjectModel: {
        keyIdea: "Bioenergetics links favorable coupling, kinetic enzyme effects, and electron transfer.",
        explanation: "ATP coupling concerns the combined free-energy change, enzymes lower activation-energy barriers to change rates, and redox reactions transfer electrons through carriers such as NADH and FADH2. These are connected but distinct relationships.",
        commonMistake: "Enzymes or electron carriers create the energy that reactions need.",
        correction: "Enzymes change kinetic barriers, carriers transfer electrons, and coupling links favorable and unfavorable free-energy changes.",
      },
      modelExample: null,
    };
    const invalidFullDraft = oversizedStudyDraft();
    parseResponse
      .mockResolvedValueOnce(completedProviderResponse("invalid-initial-old", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("invalid-repair-old", invalidFullDraft))
      .mockResolvedValueOnce(completedProviderResponse("safe-recovery-old", recoveryContent));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls[2]?.[0]?.text?.format?.name).toBe("yova_safe_study_recovery");
    expect(result.draft.activities.filter((activity) => (
      activity.type === "free_response" || activity.type === "multiple_choice"
    )).map((activity) => activity.topicId)).toEqual([...BIO_TOPIC_IDS]);
    expect(result.draft.activities.filter((activity) => activity.methodPhase !== "schedule_return")).toHaveLength(4);
    expect(result.deliveryPolicy.pacing.maximumActivities).toBe(4);
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      failedValidator: "session_time_budget",
      repairSucceeded: true,
      recoveryMode: "safe_study",
    });
    await expectCompleteValidatorPass(result.draft, context);
  });

  it("does not substitute the bounded recovery for a requested challenge session", async () => {
    parseResponse.mockReset();
    const base = buildSessionEvaluationCases()
      .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
    expect(base).toBeDefined();
    const invalidFullDraft = oversizedStudyDraft();
    parseResponse.mockResolvedValue(completedProviderResponse("invalid-challenge", invalidFullDraft));

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    await expect(generateSessionWithOpenAI({
      ...base!,
      sessionAdjustment: {
        familiarity: "challenge_me",
        availableMinutes: 25,
        knownTargets: [],
        note: "",
      },
    })).rejects.toMatchObject({ name: "SessionGenerationFailure" });

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
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
  ])("deterministically surfaces $label retrieval outcomes without a repair call", async ({
    correctAnswers,
    feedback,
    expected,
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
    expect(result.draft.methodBriefing.personalization.join(" ")).toMatch(expected);
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
    await expect(generateSessionWithOpenAI(context)).rejects.toThrow("provider unavailable");

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

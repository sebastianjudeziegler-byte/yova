import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import {
  GeneratedSessionDraftOutputSchema,
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

async function expectCompleteValidatorPass(
  draft: GeneratedSessionDraft,
  context: SessionGenerationContext,
  expectedSuggestedMethod: "spaced_retrieval" | "worked_example_fading" = "spaced_retrieval",
) {
  const { buildLearningScienceRoutingBrief } = await import("@/lib/learning/method-router");
  const {
    applyPersonalizedMethodTieToRouting,
    personalizationDecisions,
  } = await import("@/lib/personalization/personalization-generation");
  const { buildSessionDeliveryPolicy } = await import("@/lib/personalization/session-delivery-policy");
  const { validateGeneratedSessionWithCode } = await import("@/lib/openai/session-generator");
  const routing = applyPersonalizedMethodTieToRouting(buildLearningScienceRoutingBrief({
    learningIntent: context.learningGoal.learningIntent,
    sessionLearningMode: context.session.learningMode,
    goalTitle: context.learningGoal.title,
    goalTopic: context.learningGoal.topic,
    goalKind: context.learningGoal.kind,
    sessionTitle: context.session.title,
    sessionObjective: context.session.objective,
    plannedMethod: context.session.method,
    plannedMethodReason: context.session.methodReason,
    learnerProfile: context.learnerProfile,
    recentResults: context.recentResults,
    interruptionCount: context.recentInterruptions.length,
  }), context.personalization);
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
    expect(result.draft.methodBriefing.methodId).toBe("spaced_retrieval");
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
        topicIds: [...BIO_TOPIC_IDS],
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
            title: "Estimate from a nearby interval",
            body: "For $f(x)=x^2$, use the points at $x=2$ and $x=2.1$. Which value best estimates the instantaneous rate at $x=2$?",
            choices: ["0.4", "4.1", "8", "40"],
            correctChoiceIndex: 1,
            feedback: "The secant slope is $((2.1)^2-2^2)/(2.1-2)=4.1$, which approximates the derivative near $x=2$.",
          },
          {
            title: "Interpret the estimate",
            body: "For $f(x)=x^2$, a nearby-interval slope at $x=2$ is about $4.1$. What does this estimate represent?",
            choices: ["The instantaneous rate of change near $x=2$", "The value $f(2)$", "The interval width", "The average output"],
            correctChoiceIndex: 0,
            feedback: "A secant slope over a very small interval estimates the tangent slope, or instantaneous rate of change.",
          },
          {
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
    const personalizedContext = {
      ...context!,
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
    const groundedReview = GeneratedSessionDraftOutputSchema.parse({
      topicIds: [TEST_TOPIC_ID],
      rationale: "Use three source-grounded questions as the promised in-YOVA verification after the learner's outside-source practice.",
      coverage: {
        focus: "How Krebs cycle oxidation reactions produce reduced electron carriers.",
        essentialIdeas: [contentTarget],
        completionEvidence: [completionEvidence],
        evidenceMap: [{
          essentialIdea: contentTarget,
          activityConcept: reviewConcept,
        }],
        deferredContent: [],
      },
      methodBriefing: {
        learningMode: "study",
        taskType: "conceptual_learning",
        methodId: "retrieval_practice",
        name: "Quick retrieval check",
        what: "Answer three source-grounded questions before viewing each explanation.",
        why: "A short unsupported return checks what remains available after the learner studied the source outside YOVA.",
        how: [
          "Choose each answer before viewing its feedback.",
          "Use each explanation to identify only the relationship that needs repair.",
        ],
        completion: "Answer all three questions so YOVA can record evidence from the guided check.",
        personalization: ["The learner already completed the outside-source method work, so this return stays short and focused."],
      },
      sourceGrounding: {
        mode: "materials_only",
        summary: "The verification questions use the learner's uploaded Krebs cycle notes only.",
        sourceNames: [materialName],
        anchors: [{
          chunkId: materialChunkId,
          sourceName: materialName,
          locationLabel: materialLocation,
          excerpt: "oxidation reactions transfer high-energy electrons to NAD+",
          usedFor: "The relationship between Krebs cycle oxidation and NADH production.",
        }],
        supplements: [],
      },
      activities: [{
        topicId: TEST_TOPIC_ID,
        methodPhase: "retrieve",
        concept: reviewConcept,
        estimatedMinutes: 2,
        requiredForCompletion: true,
        label: "Recall",
        title: "Identify the electron transfer",
        body: "During the Krebs cycle, oxidation reactions remove high-energy electrons. Which molecule accepts those electrons to form NADH?",
        teaching: null,
        type: "multiple_choice",
        choices: ["NAD+", "ATP", "Carbon dioxide", "Oxygen"],
        correctAnswer: "NAD+",
        feedback: "NAD+ accepts high-energy electrons during Krebs cycle oxidation and is reduced to NADH.",
      }, {
        topicId: TEST_TOPIC_ID,
        methodPhase: "discriminate",
        concept: reviewConcept,
        estimatedMinutes: 3,
        requiredForCompletion: true,
        label: "Distinguish",
        title: "Distinguish the two carriers",
        body: "Which statement correctly distinguishes how the Krebs cycle produces the two reduced electron carriers?",
        teaching: null,
        type: "multiple_choice",
        choices: [
          "NAD+ becomes NADH and FAD becomes FADH2",
          "NADH becomes NAD+ and FADH2 becomes FAD",
          "ATP becomes NADH and carbon dioxide becomes FADH2",
          "Oxygen becomes NADH and glucose becomes FADH2",
        ],
        correctAnswer: "NAD+ becomes NADH and FAD becomes FADH2",
        feedback: "Both carriers accept electrons: NAD+ is reduced to NADH, while FAD is reduced to FADH2.",
      }, {
        topicId: TEST_TOPIC_ID,
        methodPhase: "transfer",
        concept: reviewConcept,
        estimatedMinutes: 3,
        requiredForCompletion: true,
        label: "Apply",
        title: "Predict a carrier change",
        body: "If a Krebs cycle oxidation cannot transfer electrons to FAD, which product would decrease most directly?",
        teaching: null,
        type: "multiple_choice",
        choices: ["FADH2", "NAD+", "Carbon dioxide", "ATP synthase"],
        correctAnswer: "FADH2",
        feedback: "FADH2 is produced when FAD accepts electrons, so blocking that transfer directly reduces FADH2 production.",
      }],
    });
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
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_guided_session");
    const providerInput = parseResponse.mock.calls[0]?.[0]?.input as string;
    const prompt = JSON.parse(providerInput.slice(providerInput.indexOf("\n") + 1)) as {
      outsideAppContract: unknown;
      quickReviewContract: unknown;
      sourceGroundingPolicy: unknown;
    };
    expect(prompt.outsideAppContract).toBeNull();
    expect(prompt.quickReviewContract).toMatchObject({ reviewType: "verify" });
    expect(prompt.sourceGroundingPolicy).toMatchObject({ supplementationAllowed: false });
    expect(result.draft.activities).toHaveLength(3);
    expect(result.draft.activities.every((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.draft.sourceGrounding?.sourceNames).toEqual([materialName]);
    expect(validateOutsideAppGuidance(result.draft, "outside_yova")).toMatch(/must include an instruction/i);
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

import { describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";
import {
  GeneratedSessionDraftOutputSchema,
  type GeneratedSessionDraft,
} from "@/lib/session-generation/schema";

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
  }) as GeneratedSessionDraft;
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
});

describe("session content-volume validation", () => {
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

    const { generateSessionWithOpenAI } = await import("@/lib/openai/session-generator");
    const result = await generateSessionWithOpenAI(context!);

    expect(parseResponse).toHaveBeenCalledTimes(1);
    expect(parseResponse.mock.calls[0]?.[0]?.text?.format?.name).toBe("yova_scheduled_retrieval");
    expect(result.draft.activities).toHaveLength(3);
    expect(result.draft.activities.every((activity) => activity.type === "multiple_choice")).toBe(true);
    expect(result.draft.activities.every((activity) => activity.concept === "Nearby interval estimate at x = 2")).toBe(true);
  });
});

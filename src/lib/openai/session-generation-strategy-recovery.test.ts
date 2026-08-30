import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionEvaluationCases } from "@/evals/session-cases";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAISessionConfig: () => ({ apiKey: "test", model: "gpt-yova-test" }),
}));

describe("production evidence scoping before safe study recovery", () => {
  beforeEach(() => {
    parseResponse.mockReset();
  });

  it("retains only scaffold and calibration evidence bound to this session", async () => {
    const context = bioenergeticsContext();
    const relevantConcept = context.session.contentTargets![0]!;
    const unrelatedScaffold = scaffoldSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    });
    const relevantScaffold = scaffoldSignal({
      topicId: context.session.topicIds[0]!,
      concept: relevantConcept,
    });
    const unrelatedCalibration = calibrationSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    });
    const relevantCalibration = calibrationSignal({
      topicId: context.session.topicIds[0]!,
      concept: relevantConcept,
    });
    context.scaffoldSignals = [unrelatedScaffold, relevantScaffold];
    context.topicCalibrationSignals = [unrelatedCalibration, relevantCalibration];

    const { withSessionEvidenceScope } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const scoped = withSessionEvidenceScope(context);

    expect(scoped.scaffoldSignals).toEqual([relevantScaffold]);
    expect(scoped.topicCalibrationSignals).toEqual([relevantCalibration]);
  });

  it("lets unrelated prior scaffold and calibration evidence reach bounded recovery", async () => {
    const context = bioenergeticsContext();
    context.scaffoldSignals = [scaffoldSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    })];
    context.topicCalibrationSignals = [calibrationSignal({
      topicId: "99999999-9999-4999-8999-999999999999",
      concept: "Photosynthetic electron transport",
    })];
    parseResponse
      .mockResolvedValueOnce(completedResponse("invalid-initial", {}))
      .mockResolvedValueOnce(completedResponse("invalid-repair", {}))
      .mockResolvedValueOnce(completedResponse("safe-recovery", compactRecoveryContent()));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    const result = await generateProductionSessionWithOpenAI(context);

    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
      "yova_safe_study_recovery",
    ]);
    expect(result.generationStats).toMatchObject({
      attempts: 3,
      repairSucceeded: true,
      recoveryMode: "safe_study",
    });
  });

  it("keeps relevant scaffold evidence fail-closed for bounded recovery", async () => {
    const context = bioenergeticsContext();
    context.scaffoldSignals = [scaffoldSignal({
      topicId: context.session.topicIds[0]!,
      concept: context.session.contentTargets![0]!,
    })];
    parseResponse
      .mockResolvedValueOnce(completedResponse("invalid-initial", {}))
      .mockResolvedValueOnce(completedResponse("invalid-repair", {}))
      .mockResolvedValueOnce(completedResponse("invalid-final-repair", {}));

    const { generateProductionSessionWithOpenAI } = await import(
      "@/lib/openai/session-generation-strategy"
    );
    await expect(generateProductionSessionWithOpenAI(context)).rejects.toMatchObject({
      name: "SessionGenerationFailure",
      generationStats: {
        attempts: 3,
        repairSucceeded: false,
      },
    });
    expect(parseResponse).toHaveBeenCalledTimes(3);
    expect(parseResponse.mock.calls.map((call) => call[0]?.text?.format?.name)).toEqual([
      "yova_guided_session",
      "yova_guided_session",
      "yova_guided_session",
    ]);
  });
});

function bioenergeticsContext() {
  const context = buildSessionEvaluationCases()
    .find((candidate) => candidate.id === "bioenergetics_multi_target_study")?.context;
  if (!context) throw new Error("Missing bioenergetics evaluation context.");
  return structuredClone(context);
}

function scaffoldSignal({ topicId, concept }: { topicId: string; concept: string }) {
  return {
    topicId,
    concept,
    checks: 1,
    supportedChecks: 0,
    independentChecks: 1,
    secureIndependentChecks: 1,
    latestOutcome: "secure" as const,
    latestPhase: "retrieve" as const,
    status: "fade_support" as const,
    evidence: "One prior independent check was secure.",
    guidance: "Remove some earlier support and require a fresh independent check.",
  };
}

function calibrationSignal({ topicId, concept }: { topicId: string; concept: string }) {
  return {
    topicId,
    concept,
    pattern: "possible_misconception" as const,
    checkedAnswers: 1,
    highConfidenceMisses: 1,
    lowConfidenceSuccesses: 0,
    misconceptionSummary: "Oxygen is produced by splitting water, not carbon dioxide.",
    feedback: "A confident answer needs a fresh discrimination check before this concept is treated as stable.",
  };
}

function completedResponse(id: string, outputParsed: unknown) {
  return {
    id,
    model: "gpt-yova-test",
    status: "completed",
    output_parsed: outputParsed,
    usage: {
      input_tokens: 600,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 300,
    },
  };
}

function compactRecoveryContent() {
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

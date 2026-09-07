import { beforeEach, describe, expect, it, vi } from "vitest";

const parseResponse = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { parse: parseResponse } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAIKnowledgeMapConfig: () => ({ model: "gpt-yova-diagnostic-test" }),
  getOpenAIPlanConfig: () => ({ model: "gpt-yova-validation-test" }),
}));

import {
  applyDiagnosticAnswers,
  buildPreviewMapDiagnostic,
  generateMapDiagnostic,
} from "@/lib/diagnostics/map-diagnostic";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";

function map(origin: "material" | "ai_generated") {
  return PlanKnowledgeMapSchema.parse({
    version: 1,
    scopeJudgment: {
      band: "unit_or_exam",
      label: "Mapped unit",
      minimumSessions: 4,
      recommendedSessions: 6,
      maximumSessions: 8,
      minimumTeachingSessions: 2,
      explanation: "The map follows the prerequisite structure needed for the learner's stated unit goal.",
    },
    topics: [
      ["Causes", "Explain the long-term causes that made a wider conflict possible"],
      ["Escalation", "Connect alliances and mobilization to the expansion of the conflict"],
      ["Turning points", "Distinguish the military and political turning points"],
      ["Consequences", "Explain the major political and social consequences"],
    ].map(([title, description], index) => ({
      id: `10000000-1000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title,
      description,
      subtopics: [],
      prerequisiteTopicIds: index === 0
        ? []
        : [`10000000-1000-4000-8000-${String(index).padStart(12, "0")}`],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin,
      deferred: null,
    })),
    placementCheck: {
      status: "available",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  });
}

describe("knowledge-map diagnostics", () => {
  beforeEach(() => {
    parseResponse.mockReset();
    parseResponse.mockImplementation(async (request) => {
      const input = JSON.parse(request.input);
      return { ...providerResponse([]), output_parsed: { judgments: input.questions.map((_: unknown,index: number)=>({questionIndex:index,testsAssignedTopic:true,selfContained:true,factuallyAccurate:true,independentEvidence:true,validChoiceIndices:[0],explanation:"Only the first choice satisfies the question as written."})) } };
    });
  });

  it("does not skip teaching after one correct multiple-choice answer", () => {
    const knowledgeMap = map("ai_generated");
    const question = buildPreviewMapDiagnostic(knowledgeMap)[0]!;
    const result = applyDiagnosticAnswers(knowledgeMap, [question], [question.correctAnswer], false);
    const topic = result.map.topics.find(topic => topic.id === question.topicId)!;
    expect(topic.initialEvidence?.outcome === "demonstrated" ? "Quick verification" : "Teach and check").toBe("Teach and check");
  });

  it("rejects the elimination question with two mathematically valid answers", async () => {
    const knowledgeMap = map("ai_generated");
    const questions = buildPreviewMapDiagnostic(knowledgeMap).map((question, index) => providerQuestion(`topic_${index+1}`, question.prompt, question.correctAnswer));
    questions[0] = {
      topicAlias: "topic_1", prompt: "For 2x + y = 11 and 2x - y = 1, which operation eliminates a variable?",
      options: ["Add the equations to eliminate y", "Subtract the equations to eliminate x", "Multiply both equations by zero", "I don't know yet"], correctChoiceIndex: 0,
    };
    parseResponse.mockResolvedValueOnce(providerResponse(questions));
    parseResponse.mockResolvedValueOnce({ ...providerResponse([]), output_parsed: { judgments: questions.map((_, index) => ({questionIndex:index, testsAssignedTopic:true,selfContained:true, validChoiceIndices:index===0?[0,1]:[0], explanation:index===0?"Adding eliminates y and subtracting eliminates x, so both choices satisfy the question.":"Only the first choice satisfies the stated question."})) } });
    await expect(generateMapDiagnostic(knowledgeMap, "Solve simultaneous linear equations")).rejects.toMatchObject({failedValidator:"diagnostic_structure"});
  });

  it("rejects the live glycolysis question whose premise asks for the product of each half but the key counts a whole glucose", async () => {
    const knowledgeMap = map("ai_generated");
    const questions = buildPreviewMapDiagnostic(knowledgeMap).map((question,index)=>providerQuestion(`topic_${index+1}`,question.prompt,question.correctAnswer));
    questions[0] = {topicAlias:"topic_1",prompt:"In glycolysis, one glucose molecule is split. What is made from each half of glucose?",options:["Two molecules of pyruvate","Two molecules of oxygen","One acetyl-CoA","I don't know yet"],correctChoiceIndex:0};
    parseResponse.mockResolvedValueOnce(providerResponse(questions));
    parseResponse.mockResolvedValueOnce({...providerResponse([]),output_parsed:{judgments:questions.map((_,index)=>({questionIndex:index,testsAssignedTopic:true,selfContained:true,factuallyAccurate:index!==0,independentEvidence:true,validChoiceIndices:[0],explanation:index===0?"Each three-carbon half produces one pyruvate; the keyed answer incorrectly counts both halves.":"The question and keyed choice agree with the facts."}))}});
    await expect(generateMapDiagnostic(knowledgeMap,"Learn glycolysis")).rejects.toMatchObject({failedValidator:"diagnostic_structure"});
  });

  it.each(["material", "ai_generated"] as const)(
    "generates a self-contained optional check from a %s map",
    (origin) => {
      const knowledgeMap = map(origin);
      const questions = buildPreviewMapDiagnostic(knowledgeMap);

      expect(questions.length).toBeGreaterThanOrEqual(4);
      expect(questions.length).toBeLessThanOrEqual(8);
      expect(questions.every((question) => knowledgeMap.topics.some((topic) => topic.id === question.topicId))).toBe(true);
      expect(questions.every((question) => question.options.length === 4)).toBe(true);
      expect(questions.every((question) => new Set(question.options).size === question.options.length)).toBe(true);
      expect(questions.every((question) => question.options.at(-1) === "I don't know yet")).toBe(true);
      expect(questions.every((question) => question.options.includes(question.correctAnswer))).toBe(true);
    },
  );

  it("keeps preview answer choices unique when the map has only one topic", () => {
    const knowledgeMap = PlanKnowledgeMapSchema.parse({
      ...map("ai_generated"),
      topics: map("ai_generated").topics.slice(0, 1),
    });

    const questions = buildPreviewMapDiagnostic(knowledgeMap);

    expect(questions).toHaveLength(2);
    expect(questions.every((question) => new Set(question.options).size === 4)).toBe(true);
  });

  it("skips without silently creating evidence or changing topic status", () => {
    const knowledgeMap = map("ai_generated");
    const questions = buildPreviewMapDiagnostic(knowledgeMap);
    const result = applyDiagnosticAnswers(knowledgeMap, questions, [], true);

    expect(result.responses).toEqual([]);
    expect(result.map.placementCheck.status).toBe("skipped");
    expect(result.map.placementCheck.demonstratedTopicIds).toEqual([]);
    expect(result.map.placementCheck.gapTopicIds).toEqual([]);
    expect(result.map.topics.every((topic) => topic.status === "not_started")).toBe(true);
    expect(result.map.topics.every((topic) => topic.initialEvidence === null)).toBe(true);
  });

  it("records demonstrated starting evidence and confirmed gaps without marking either secure", () => {
    const knowledgeMap = map("material");
    const questions = buildPreviewMapDiagnostic(knowledgeMap);
    const answers = questions.map((question, index) => (
      index < 2 ? question.correctAnswer : "I don't know yet"
    ));
    const result = applyDiagnosticAnswers(knowledgeMap, questions, answers, false);

    expect(result.map.placementCheck.status).toBe("completed");
    expect(result.map.placementCheck.demonstratedTopicIds.length).toBeGreaterThan(0);
    expect(result.map.placementCheck.gapTopicIds.length).toBeGreaterThan(0);
    expect(result.map.topics.some((topic) => topic.initialEvidence?.outcome === "demonstrated" && topic.status === "evidenced")).toBe(true);
    expect(result.map.topics.some((topic) => topic.initialEvidence?.outcome === "gap" && topic.status === "not_started")).toBe(true);
    expect(result.map.topics.some((topic) => topic.status === "secure")).toBe(false);
  });

  it("binds provider questions to server-owned stable topic aliases", async () => {
    const knowledgeMap = map("ai_generated");
    const assigned = buildPreviewMapDiagnostic(knowledgeMap);
    parseResponse.mockResolvedValueOnce(providerResponse(assigned.map((question, index) => ({
      topicAlias: `topic_${index + 1}`,
      prompt: `Which explanation correctly matches assigned placement topic ${index + 1}?`,
      options: [
        question.correctAnswer,
        `Incorrect alternative A for topic ${index + 1}`,
        `Incorrect alternative B for topic ${index + 1}`,
        "I don't know yet",
      ],
      correctChoiceIndex: 0,
    }))));

    const result = await generateMapDiagnostic(knowledgeMap, "Prepare for the mapped unit test");

    expect(result.questions.map((question) => question.topicId)).toEqual(
      assigned.map((question) => question.topicId),
    );
    expect(result.questions.map((question) => question.prompt)).toEqual(
      assigned.map((_, index) => `Which explanation correctly matches assigned placement topic ${index + 1}?`),
    );
    expect(result.stats).toMatchObject({
      firstAttemptPassed: true,
      failedValidator: null,
      model: "gpt-yova-diagnostic-test",
    });

    const input = JSON.parse(parseResponse.mock.calls[0]?.[0]?.input) as {
      assignedTopics: Array<Record<string, unknown>>;
    };
    expect(input.assignedTopics).toHaveLength(8);
    expect(input.assignedTopics.map((topic) => topic.topicAlias)).toEqual([
      "topic_1",
      "topic_2",
      "topic_3",
      "topic_4", "topic_5", "topic_6", "topic_7", "topic_8",
    ]);
    expect(input.assignedTopics.some((topic) => "id" in topic || "topicId" in topic)).toBe(false);
    expect(parseResponse).toHaveBeenCalledWith(
      expect.any(Object),
      { maxRetries: 0, timeout: 30_000 },
    );
  });

  it("rejects unknown and duplicate provider aliases without preview substitution", async () => {
    const knowledgeMap = map("ai_generated");
    const assigned = buildPreviewMapDiagnostic(knowledgeMap);
    const firstPrompt = "Which answer correctly explains the first assigned topic?";
    const thirdPrompt = "Which answer correctly explains the third assigned topic?";
    const duplicateCrossTopicPrompt = "Which consequence ended a war but belongs to a different assigned topic?";
    const unknownAliasPrompt = "Which turning point belongs to an unknown provider topic identifier?";
    parseResponse.mockResolvedValueOnce(providerResponse([
      providerQuestion("topic_1", firstPrompt, assigned[0]!.correctAnswer),
      providerQuestion("topic_1", duplicateCrossTopicPrompt, assigned[3]!.correctAnswer),
      providerQuestion("00000000-0000-4000-8000-000000000099", unknownAliasPrompt, assigned[1]!.correctAnswer),
      providerQuestion("topic_3", thirdPrompt, assigned[2]!.correctAnswer),
    ]));

    await expect(generateMapDiagnostic(knowledgeMap, "Prepare for the mapped unit test")).rejects.toMatchObject({failedValidator:"diagnostic_topic_coverage"});
  });

  it("keeps placement to two checks per topic and eight questions overall", async () => {
    const knowledgeMap = PlanKnowledgeMapSchema.parse({
      ...map("ai_generated"),
      topics: Array.from({ length: 10 }, (_, index) => ({
        id: `20000000-2000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: `Mapped topic ${index + 1}`,
        description: `Explain the distinct knowledge relationship for mapped topic ${index + 1}.`,
        subtopics: [],
        prerequisiteTopicIds: index === 0
          ? []
          : [`20000000-2000-4000-8000-${String(index).padStart(12, "0")}`],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: null,
      })),
    });
    const assigned = buildPreviewMapDiagnostic(knowledgeMap);
    parseResponse.mockResolvedValueOnce(providerResponse(assigned.map((question,index)=>providerQuestion(`topic_${index+1}`,question.prompt,question.correctAnswer))));

    const result = await generateMapDiagnostic(knowledgeMap, "Prepare for the mapped cumulative test");

    expect(result.questions).toHaveLength(8);
    expect(new Set(result.questions.map((question) => question.topicId)).size).toBe(4);
    const input = JSON.parse(parseResponse.mock.calls[0]?.[0]?.input) as {
      assignedTopics: unknown[];
    };
    expect(input.assignedTopics).toHaveLength(8);
    expect(result.stats).toMatchObject({
      firstAttemptPassed: true,
      failedValidator: null,
    });
  });
});

function providerQuestion(topicAlias: string, prompt: string, correctAnswer: string) {
  return {
    topicAlias,
    prompt,
    options: [correctAnswer, "Plausible but incorrect option A", "Plausible but incorrect option B", "I don't know yet"],
    correctChoiceIndex: 0,
  };
}

function providerResponse(questions: unknown[]) {
  return {
    id: "diagnostic-response",
    model: "gpt-yova-diagnostic-test",
    status: "completed",
    output: [],
    output_parsed: { questions },
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 25, cache_write_tokens: 0 },
      output_tokens: 80,
    },
  };
}

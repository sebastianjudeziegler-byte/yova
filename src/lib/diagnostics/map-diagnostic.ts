import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { GenerationValidator } from "@/lib/analytics/generation-observation";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAIKnowledgeMapConfig } from "@/lib/openai/config";
import { PlanDiagnosticQuestionSchema, type PlanDiagnosticQuestion } from "@/lib/plan-generation/schema";

const DiagnosticOutputSchema = z.object({
  questions: z.array(z.object({
    topicAlias: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(12).max(500),
    options: z.array(z.string().trim().min(1).max(180)).length(4),
    correctChoiceIndex: z.number().int().min(0).max(2),
  })).max(8),
});

type DiagnosticProviderQuestion = z.infer<typeof DiagnosticOutputSchema>["questions"][number];

export type DiagnosticGenerationStats = {
  elapsedMs: number;
  attempts: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  firstAttemptPassed: boolean;
  failedValidator: GenerationValidator | null;
  model: string | null;
};

export class MapDiagnosticGenerationError extends Error {
  constructor(
    message: string,
    public readonly failedValidator: GenerationValidator,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MapDiagnosticGenerationError";
  }
}

const INSTRUCTIONS = `Create a short YOVA placement check from the supplied assigned topics.

Return exactly one multiple-choice question for every assigned topic. Copy each supplied topicAlias exactly once. Never invent, repeat, or omit a topicAlias. The server owns the topic assignment; use the title, description, subtopics, and prerequisites attached to that alias only. Every question must be self-contained: include the facts, situation, definition, or data needed to reason about the answer without reopening a source. Do not ask what the learner prefers, how confident they feel, or what they think they know.

Each question must have exactly four options. The first three are plausible content answers. The fourth must be exactly "I don't know yet". correctChoiceIndex must point to one of the first three choices. Keep the questions diagnostic rather than tricky. Use clean interface text with no Markdown or em dashes. Return only the requested structure.`;

export async function generateMapDiagnostic(
  map: PlanKnowledgeMap,
  goal: string,
): Promise<{ questions: PlanDiagnosticQuestion[]; stats: DiagnosticGenerationStats }> {
  const startedAt = Date.now();
  const config = getOpenAIKnowledgeMapConfig();
  if (!config) {
    return { questions: buildPreviewMapDiagnostic(map), stats: emptyStats(Date.now() - startedAt) };
  }

  const client = getOpenAIClient();
  try {
    const fallbackQuestions = buildPreviewMapDiagnostic(map);
    const topicById = new Map(map.topics.map((topic) => [topic.id, topic]));
    const assignments = fallbackQuestions.map((fallback, index) => {
      const topic = topicById.get(fallback.topicId)!;
      return {
        alias: `topic_${index + 1}`,
        topic,
        fallback,
      };
    });
    const response = await client.responses.parse({
      model: config.model,
      instructions: INSTRUCTIONS,
      input: JSON.stringify({
        learnerGoal: goal,
        assignedTopics: assignments.map(({ alias, topic }) => ({
          topicAlias: alias,
          title: topic.title,
          description: topic.description,
          subtopics: topic.subtopics,
          prerequisiteTopics: topic.prerequisiteTopicIds.flatMap((prerequisiteId) => {
            const prerequisite = topicById.get(prerequisiteId);
            return prerequisite ? [prerequisite.title] : [];
          }),
        })),
      }),
      reasoning: { effort: "low" },
      text: { format: zodTextFormat(DiagnosticOutputSchema, "yova_map_diagnostic"), verbosity: "low" },
      max_output_tokens: 2_400,
      store: false,
    }, { maxRetries: 0, timeout: 30_000 });

    if (response.status !== "completed") {
      throw new MapDiagnosticGenerationError("The placement check did not finish.", "diagnostic_response_status");
    }
    const parsed = DiagnosticOutputSchema.safeParse(response.output_parsed);
    if (!parsed.success) {
      throw new MapDiagnosticGenerationError("The placement check had an invalid structure.", "diagnostic_structure");
    }
    const reconciled = reconcileDiagnosticQuestions(assignments, parsed.data.questions);
    const usage = response.usage;
    return {
      questions: reconciled.questions,
      stats: {
        elapsedMs: Date.now() - startedAt,
        attempts: 1,
        inputTokens: usage?.input_tokens ?? 0,
        cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
        cacheWriteTokens: usage?.input_tokens_details.cache_write_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        firstAttemptPassed: reconciled.failedValidator === null,
        failedValidator: reconciled.failedValidator,
        model: response.model,
      },
    };
  } catch (error) {
    if (error instanceof MapDiagnosticGenerationError) throw error;
    throw new MapDiagnosticGenerationError("The placement-check request failed.", "diagnostic_provider_request", error);
  }
}

function reconcileDiagnosticQuestions(
  assignments: Array<{
    alias: string;
    topic: PlanKnowledgeMap["topics"][number];
    fallback: PlanDiagnosticQuestion;
  }>,
  providerQuestions: DiagnosticProviderQuestion[],
) {
  const assignmentByAlias = new Map(assignments.map((assignment) => [assignment.alias, assignment]));
  const providerByAlias = new Map<string, DiagnosticProviderQuestion>();
  let failedValidator: GenerationValidator | null = null;

  for (const question of providerQuestions) {
    if (!assignmentByAlias.has(question.topicAlias) || providerByAlias.has(question.topicAlias)) {
      failedValidator ??= "diagnostic_topic_coverage";
      continue;
    }
    if (
      question.options[3] !== "I don't know yet"
      || new Set(question.options).size !== question.options.length
    ) {
      failedValidator ??= "diagnostic_structure";
      continue;
    }
    providerByAlias.set(question.topicAlias, question);
  }

  if (providerQuestions.length !== assignments.length) {
    failedValidator ??= "diagnostic_topic_coverage";
  }

  const questions = assignments.map((assignment) => {
    const provider = providerByAlias.get(assignment.alias);
    if (!provider) {
      failedValidator ??= "diagnostic_topic_coverage";
      return assignment.fallback;
    }
    return PlanDiagnosticQuestionSchema.parse({
      id: crypto.randomUUID(),
      topicId: assignment.topic.id,
      prompt: provider.prompt,
      options: provider.options,
      correctAnswer: provider.options[provider.correctChoiceIndex],
    });
  });

  return { questions, failedValidator };
}

export function buildPreviewMapDiagnostic(map: PlanKnowledgeMap): PlanDiagnosticQuestion[] {
  const dependents = new Map<string, number>();
  for (const topic of map.topics) {
    for (const prerequisite of topic.prerequisiteTopicIds) {
      dependents.set(prerequisite, (dependents.get(prerequisite) ?? 0) + 1);
    }
  }
  const ranked = [...map.topics].sort((left, right) => {
    const leftScore = (left.prerequisiteTopicIds.length === 0 ? 10 : 0) + (dependents.get(left.id) ?? 0);
    const rightScore = (right.prerequisiteTopicIds.length === 0 ? 10 : 0) + (dependents.get(right.id) ?? 0);
    return rightScore - leftScore;
  });
  const selected = ranked.slice(0, Math.min(8, Math.max(4, ranked.length)));
  while (selected.length < 4) selected.push(ranked[selected.length % ranked.length]);
  return selected.map((topic, index) => {
    const correct = topic.description.replace(/[.!?]+$/, "");
    const alternatives = map.topics.filter((candidate) => candidate.id !== topic.id).slice(index % Math.max(1, map.topics.length - 1), index % Math.max(1, map.topics.length - 1) + 2);
    const distractors = alternatives
      .map((candidate) => candidate.description.replace(/[.!?]+$/, ""))
      .filter((option, optionIndex, options) => option !== correct && options.indexOf(option) === optionIndex)
      .slice(0, 2);
    const fallbackDistractors = [
      `It is mainly an unrelated detail rather than ${topic.title}`,
      `It belongs to a different topic and does not explain ${topic.title}`,
      `It is a later extension rather than the central idea of ${topic.title}`,
    ];
    for (const fallback of fallbackDistractors) {
      if (distractors.length >= 2) break;
      if (fallback !== correct && !distractors.includes(fallback)) distractors.push(fallback);
    }
    return PlanDiagnosticQuestionSchema.parse({
      id: crypto.randomUUID(),
      topicId: topic.id,
      prompt: `Which statement best captures the mapped idea ${topic.title}?`,
      options: [correct, ...distractors, "I don't know yet"],
      correctAnswer: correct,
    });
  });
}

function emptyStats(elapsedMs: number): DiagnosticGenerationStats {
  return {
    elapsedMs,
    attempts: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    firstAttemptPassed: true,
    failedValidator: null,
    model: null,
  };
}

export function applyDiagnosticAnswers(
  map: PlanKnowledgeMap,
  questions: PlanDiagnosticQuestion[],
  answers: string[],
  skipped: boolean,
) {
  if (skipped) {
    return {
      map: { ...map, placementCheck: { status: "skipped" as const, completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } },
      responses: [],
    };
  }
  const observedAt = new Date().toISOString();
  const responses = questions.map((question, index) => ({
    questionId: question.id,
    topicId: question.topicId,
    question: question.prompt,
    answer: answers[index] ?? "I don't know yet",
    evaluation: answers[index] === question.correctAnswer ? "correct" as const : "incorrect" as const,
  }));
  const demonstratedTopicIds: string[] = [...new Set(responses.filter((response) => response.evaluation === "correct").map((response) => response.topicId))];
  const gapTopicIds: string[] = [...new Set(responses.filter((response) => response.evaluation === "incorrect").map((response) => response.topicId))];
  return {
    map: {
      ...map,
      placementCheck: { status: "completed" as const, completedAt: observedAt, demonstratedTopicIds, gapTopicIds },
      topics: map.topics.map((topic) => {
        if (demonstratedTopicIds.includes(topic.id)) {
          return { ...topic, status: topic.status === "secure" ? topic.status : "evidenced" as const, initialEvidence: { source: "placement_check" as const, outcome: "demonstrated" as const, observedAt } };
        }
        if (gapTopicIds.includes(topic.id)) {
          return { ...topic, status: "not_started" as const, initialEvidence: { source: "placement_check" as const, outcome: "gap" as const, observedAt } };
        }
        return topic;
      }),
    },
    responses,
  };
}

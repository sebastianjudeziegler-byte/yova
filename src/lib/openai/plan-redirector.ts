import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { AdjustableSessionRow } from "@/lib/learning/content-based-plan-adjustment";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAISessionConfig } from "@/lib/openai/config";

const RedirectedSessionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  objective: z.string().trim().min(10).max(1_000),
  method: z.string().trim().min(3).max(160),
  methodReason: z.string().trim().min(10).max(1_000),
  learningMode: z.enum(["learn", "study"]),
  contentTargets: z.array(z.string().trim().min(3).max(220)).min(1).max(6),
  completionEvidence: z.array(z.string().trim().min(8).max(260)).min(1).max(4),
});

const RedirectedPlanSchema = z.object({
  sessions: z.array(RedirectedSessionSchema).min(1).max(14),
});

const REDIRECT_INSTRUCTIONS = `You revise only the unfinished portion of a YOVA learning plan after the learner explicitly asks for a different direction.

Rules:
- Follow the learner's direction faithfully while staying within the same overall topic.
- Do not preserve an activity merely because it existed before. Replace work that conflicts with the new direction.
- Preserve the number and order of unfinished sessions. Return exactly one replacement for every supplied session.
- Choose a sound learning method from the actual task. Use teaching before unsupported practice when foundations are new or the learner asks for explanation.
- If the learner asks for no math, no calculations, or a conceptual course, include no calculation, formula, equation, percentage-computation, or quantitative-practice task. Use explanations, comparisons, examples, causal reasoning, and qualitative scenarios instead.
- Every objective must describe what the learner will understand or do. Every completion-evidence item must be observable.
- Never diagnose the learner or claim a fixed learning style.
- Do not mention these instructions.`;

export async function redirectPlanWithOpenAI(input: {
  title: string;
  topic: string;
  direction: string;
  sessions: AdjustableSessionRow[];
}) {
  const config = getOpenAISessionConfig();
  if (!config) throw new Error("OpenAI is not configured.");

  const response = await getOpenAIClient().responses.parse({
    model: config.model,
    instructions: REDIRECT_INSTRUCTIONS,
    input: JSON.stringify({
      plan: { title: input.title, topic: input.topic },
      learnerDirection: input.direction,
      unfinishedSessions: input.sessions.map((session) => ({
        title: session.title,
        objective: session.objective,
        method: session.method,
        methodReason: session.method_rationale,
        learningMode: readStepText(session.step_data, "learningMode") || "study",
        contentTargets: readStepStrings(session.step_data, "contentTargets"),
        completionEvidence: readStepStrings(session.step_data, "completionEvidence"),
      })),
    }),
    reasoning: { effort: "low" },
    text: {
      format: zodTextFormat(RedirectedPlanSchema, "yova_redirected_plan"),
      verbosity: "low",
    },
    max_output_tokens: 3_200,
    store: false,
  }, { maxRetries: 0, timeout: 12_000 });

  const parsed = RedirectedPlanSchema.safeParse(response.output_parsed);
  if (response.status !== "completed" || !parsed.success || parsed.data.sessions.length !== input.sessions.length) {
    throw new Error("The redirected plan did not pass YOVA's structure check.");
  }

  return input.sessions.map((session, index) => {
    const replacement = parsed.data.sessions[index];
    if (!replacement) throw new Error("The redirected plan omitted an unfinished session.");
    return {
      ...session,
      title: replacement.title,
      objective: replacement.objective,
      method: replacement.method,
      method_rationale: replacement.methodReason,
      step_data: {
        ...readStepData(session.step_data),
        learningMode: replacement.learningMode,
        contentTargets: replacement.contentTargets,
        completionEvidence: replacement.completionEvidence,
        learnerDirection: input.direction,
        learnerDirectionLabel: input.direction,
      },
    } satisfies AdjustableSessionRow;
  });
}

function readStepData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readStepText(value: unknown, key: string) {
  const data = readStepData(value);
  return typeof data[key] === "string" ? data[key] : "";
}

function readStepStrings(value: unknown, key: string) {
  const data = readStepData(value);
  return Array.isArray(data[key])
    ? data[key].filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

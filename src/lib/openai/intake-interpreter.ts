import "server-only";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAISessionConfig } from "@/lib/openai/config";
import type { IntakeInterpretation } from "@/lib/intake/schema";
import { IntakeItemTypeSchema } from "@/lib/intake/schema";

const AIIntakeInterpretationSchema = z.object({
  title: z.string().trim().min(2).max(100),
  objective: z.string().trim().min(3).max(500),
  itemType: IntakeItemTypeSchema,
  scope: z.string().trim().min(2).max(400),
  progress: z.string().trim().max(400),
});

const INSTRUCTIONS = `You organize a learner's natural-language request for YOVA.

Return a concise, editable interpretation. Do not create a plan or recommend an outcome.
- The title must name the actual subject, assignment, test, book, or skill. Never use generic titles such as "Personalized learning plan" or "New learning goal" when the request names real content.
- The objective must say what successful completion or understanding means.
- Scope must preserve the learner's requested boundaries and exclusions.
- Progress must reflect only what the learner explicitly says they know, completed, or have not learned. Leave it empty when unknown.
- Item type is internal routing metadata. A deadline alone does not automatically make something a test.
- Never invent a deadline, source, course requirement, grade, or learner trait.
- Do not diagnose a learning style or make claims about the learner's brain.
- Use plain language and no em dashes.`;

export async function interpretIntakeWithOpenAI(input: {
  description: string;
  materialNames: string[];
  timeZone: string;
  deterministic: IntakeInterpretation;
}): Promise<IntakeInterpretation> {
  const config = getOpenAISessionConfig();
  if (!config) return input.deterministic;

  const response = await getOpenAIClient().responses.parse({
    model: config.model,
    instructions: INSTRUCTIONS,
    input: JSON.stringify({
      learnerRequest: input.description,
      attachedMaterialNames: input.materialNames,
      timeZone: input.timeZone,
      reliableBaseline: {
        itemType: input.deterministic.itemType,
        title: input.deterministic.title,
        objective: input.deterministic.objective,
        scope: input.deterministic.scope,
        progress: input.deterministic.progress,
      },
    }),
    reasoning: { effort: "low" },
    text: {
      format: zodTextFormat(AIIntakeInterpretationSchema, "yova_add_interpretation"),
      verbosity: "low",
    },
    max_output_tokens: 1_000,
    store: false,
  }, { maxRetries: 0, timeout: 8_000 });

  const parsed = AIIntakeInterpretationSchema.safeParse(response.output_parsed);
  if (response.status !== "completed" || !parsed.success) return input.deterministic;

  return {
    ...input.deterministic,
    ...parsed.data,
    // Dates, requested duration, and attached-source descriptions stay under
    // deterministic control so the model cannot invent operational details.
    dueAt: input.deterministic.dueAt,
    requestedMinutes: input.deterministic.requestedMinutes,
    materialsSummary: input.deterministic.materialsSummary,
    missingFields: [
      ...(parsed.data.scope.length < 8 ? ["scope" as const] : []),
      ...(!parsed.data.progress ? ["progress" as const] : []),
    ],
  };
}

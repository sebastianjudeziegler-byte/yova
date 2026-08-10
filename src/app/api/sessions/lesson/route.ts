import { z } from "zod";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
import { getOpenAILessonConfig, isOpenAILessonConfigured } from "@/lib/openai/config";
import {
  StreamedLessonGenerationError,
  streamGeneratedLesson,
  type StreamedLessonInput,
} from "@/lib/openai/streamed-lesson-generator";
import { LessonDeliveryInstructionsSchema } from "@/lib/personalization/session-delivery-policy";
import { encodeLessonStreamEvent } from "@/lib/session-generation/lesson-stream";
import {
  CachedGeneratedSessionV16Schema,
  StreamedGeneratedSessionActivitySchema,
  type LessonBrief,
} from "@/lib/session-generation/schema";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkLessonGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const LessonGenerateRequestSchema = z.object({
  action: z.literal("generate").default("generate"),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  activityIndex: z.number().int().min(0).max(40),
  previewLesson: z.object({
    activity: StreamedGeneratedSessionActivitySchema,
    deliveryInstructions: LessonDeliveryInstructionsSchema,
  }).optional(),
}).strict();

const LessonSkipRequestSchema = z.object({
  action: z.literal("skip_to_practice"),
  planId: z.string().uuid(),
  planSessionId: z.string().uuid(),
  activityIndex: z.number().int().min(0).max(40),
  lessonRequestId: z.string().uuid().optional(),
}).strict();

const LessonRequestSchema = z.discriminatedUnion("action", [
  LessonGenerateRequestSchema,
  LessonSkipRequestSchema,
]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (!developmentPreview && (!supabase || userError || !user)) {
    return Response.json({ error: "Sign in to open this lesson." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The lesson request was not valid JSON." }, { status: 400 });
  }
  const parsed = LessonRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "YOVA could not identify this lesson." }, { status: 422 });
  }

  if (parsed.data.action === "skip_to_practice") {
    if (!developmentPreview && supabase && user) {
      const owned = await ownsPlanSession(supabase, parsed.data.planId, parsed.data.planSessionId);
      if (!owned) return Response.json({ error: "That lesson was not found." }, { status: 404 });
      await recordGenerationObservation(supabase, user.id, {
        generationType: "lesson",
        observationKind: "usage",
        environment: generationEnvironment(),
        finalOutcome: "cache",
        firstAttemptPassed: null,
        failedValidator: null,
        repairAttempted: false,
        repairSucceeded: null,
        elapsedMs: 0,
        attempts: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        model: null,
        diagnostics: {
          lessonAction: "skip_to_practice",
          lessonRequestId: parsed.data.lessonRequestId,
        },
      });
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  if (!isOpenAILessonConfigured()) {
    return Response.json({ error: "Live lesson generation is not connected yet." }, { status: 503 });
  }
  const rateLimit = checkLessonGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many lessons were opened at once. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let lesson: LessonRuntimeSource | null = null;
  if (developmentPreview) {
    lesson = parsed.data.previewLesson
      ? {
        activity: parsed.data.previewLesson.activity,
        deliveryInstructions: parsed.data.previewLesson.deliveryInstructions,
      }
      : null;
  } else if (supabase) {
    lesson = await loadLessonRuntimeSource(
      supabase,
      parsed.data.planId,
      parsed.data.planSessionId,
      parsed.data.activityIndex,
    );
  }
  if (!lesson?.activity.lessonBrief) {
    return Response.json({ error: "This teaching step does not have a streamed lesson." }, { status: 409 });
  }

  if (!developmentPreview && supabase) {
    try {
      const durableLimit = await claimAIRequest(supabase, "lesson_generation");
      if (!durableLimit.allowed) {
        return Response.json(
          { error: "This account has reached its lesson allowance. Try again after the limit resets." },
          {
            status: 429,
            headers: {
              "Retry-After": String(durableLimit.retryAfterSeconds),
              "Cache-Control": "no-store",
            },
          },
        );
      }
    } catch {
      return Response.json(
        { error: "YOVA paused before using OpenAI because it could not verify the account's AI budget." },
        { status: 503 },
      );
    }
  }

  const model = getOpenAILessonConfig()?.model ?? "lesson-model";
  const lessonInput = lessonInputFromSource(lesson);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeLessonStreamEvent({ type: "lesson.meta", requestId, model }));
      const startedAt = Date.now();
      try {
        const result = await streamGeneratedLesson(
          lessonInput,
          (delta) => controller.enqueue(encodeLessonStreamEvent({ type: "lesson.delta", delta })),
          request.signal,
        );
        controller.enqueue(encodeLessonStreamEvent({
          type: "lesson.complete",
          elapsedMs: result.elapsedMs,
          latencyToFirstTokenMs: result.latencyToFirstTokenMs,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens,
          wordCount: result.wordCount,
          model: result.model,
        }));
        await recordGenerationObservation(supabase, user?.id, {
          generationType: "lesson",
          environment: generationEnvironment(),
          finalOutcome: "success",
          firstAttemptPassed: true,
          failedValidator: null,
          repairAttempted: false,
          repairSucceeded: null,
          elapsedMs: result.elapsedMs,
          attempts: 1,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          cacheWriteTokens: 0,
          outputTokens: result.outputTokens,
          model: result.model,
          diagnostics: {
            lessonRequestId: requestId,
            latencyToFirstTokenMs: result.latencyToFirstTokenMs,
            wordCount: result.wordCount,
            streamCompleted: true,
          },
        });
        controller.close();
      } catch (error) {
        const failure = error instanceof StreamedLessonGenerationError ? error.stats : null;
        const elapsedMs = failure?.elapsedMs ?? Date.now() - startedAt;
        await recordGenerationObservation(supabase, user?.id, {
          generationType: "lesson",
          environment: generationEnvironment(),
          finalOutcome: "failure",
          firstAttemptPassed: false,
          failedValidator: "lesson_stream",
          repairAttempted: false,
          repairSucceeded: null,
          elapsedMs,
          attempts: 1,
          inputTokens: failure?.inputTokens ?? 0,
          cachedInputTokens: failure?.cachedInputTokens ?? 0,
          cacheWriteTokens: 0,
          outputTokens: failure?.outputTokens ?? 0,
          model: failure?.model ?? model,
          diagnostics: {
            lessonRequestId: requestId,
            latencyToFirstTokenMs: failure?.latencyToFirstTokenMs ?? null,
            wordCount: failure?.wordCount ?? 0,
            streamCompleted: false,
          },
        });
        try {
          controller.enqueue(encodeLessonStreamEvent({
            type: "lesson.error",
            message: "YOVA could not finish this lesson. Your session progress is safe.",
            retryable: true,
          }));
          controller.close();
        } catch {
          // The learner may have left the page while the provider was working.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Yova-Request-Id": requestId,
    },
  });
}

type LessonRuntimeSource = {
  activity: z.infer<typeof StreamedGeneratedSessionActivitySchema>;
  deliveryInstructions: z.infer<typeof LessonDeliveryInstructionsSchema>;
};

async function loadLessonRuntimeSource(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planId: string,
  planSessionId: string,
  activityIndex: number,
): Promise<LessonRuntimeSource | null> {
  const { data: row, error } = await supabase
    .from("plan_sessions")
    .select("step_data")
    .eq("id", planSessionId)
    .eq("plan_id", planId)
    .maybeSingle();
  if (error || !row) return null;
  if (!row.step_data || typeof row.step_data !== "object" || Array.isArray(row.step_data)) return null;
  const parsed = CachedGeneratedSessionV16Schema.safeParse(
    (row.step_data as Record<string, unknown>).generatedSession,
  );
  if (!parsed.success) return null;
  const activity = parsed.data.activities[activityIndex];
  if (!activity || activity.type !== "instruction" || !activity.lessonBrief) return null;
  return { activity, deliveryInstructions: parsed.data.deliveryInstructions };
}

async function ownsPlanSession(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  planId: string,
  planSessionId: string,
) {
  const { data, error } = await supabase
    .from("plan_sessions")
    .select("id")
    .eq("id", planSessionId)
    .eq("plan_id", planId)
    .maybeSingle();
  return !error && Boolean(data);
}

function lessonInputFromSource(source: LessonRuntimeSource): StreamedLessonInput {
  const brief: LessonBrief = source.activity.lessonBrief!;
  return {
    lessonTitle: source.activity.title,
    topicTitles: [source.activity.title],
    essentialIdeas: brief.essentialIdeas,
    knowledgeSource: brief.knowledgeSource === "material_content"
      ? "materials"
      : brief.knowledgeSource === "mixed_material_and_model"
        ? "mixed"
        : "model",
    sourceChunks: brief.sourceChunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      sourceName: chunk.sourceName,
      locationLabel: chunk.locationLabel,
      sectionRole: chunk.role,
      text: chunk.text,
    })),
    evidenceContext: {
      confirmedGaps: brief.evidenceContext.confirmedGaps.map((gap) => ({
        topicId: gap.topicId,
        concept: gap.concept,
      })),
      secureTopics: brief.evidenceContext.secureKnowledge.map((topic) => ({
        topicId: topic.topicId,
        title: topic.concept,
      })),
      pastMisconceptions: brief.evidenceContext.priorMisconceptions.map((misconception) => ({
        topicId: misconception.topicId,
        concept: misconception.concept,
        summary: misconception.misconception,
      })),
    },
    contentRequirements: {
      coverAllEssentialIdeas: true,
      concreteWorkedExample: brief.contentRequirements.includeConcreteExample,
      commonMixup: true,
    },
    deliveryInstructions: source.deliveryInstructions,
  };
}

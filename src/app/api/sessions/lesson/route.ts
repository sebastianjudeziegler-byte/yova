import { z } from "zod";
import { aiUsageReservationConflict } from "@/lib/ai-usage/reservation-conflict";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservationAfterResponse } from "@/lib/analytics/generation-observation-server";
import { getOpenAILessonConfig, isOpenAILessonConfigured } from "@/lib/openai/config";
import {
  buildBoundedFallbackLesson,
  StreamedLessonGenerationError,
  streamGeneratedLessonWithRetry,
  type StreamedLessonFailureKind,
  type StreamedLessonInput,
  type StreamedLessonResult,
} from "@/lib/openai/streamed-lesson-generator";
import { LessonDeliveryInstructionsSchema } from "@/lib/personalization/session-delivery-policy";
import { coreRecallKnowledgeForLesson, includeCoreRecallKnowledge } from "@/lib/session-generation/lesson-assessment-contract";
import { lessonIdeaCapacityForMinutes } from "@/lib/session-generation/lesson-brief";
import { conciseTeachingActivityTitle } from "@/lib/session-generation/activity-copy";
import { encodeLessonStreamEvent } from "@/lib/session-generation/lesson-stream";
import { guidedSessionAllowanceExhaustedHeaders } from "@/lib/session-generation/failure-message";
import {
  CachedGeneratedSessionV16Schema,
  CachedGeneratedSessionV17Schema,
  StreamedGeneratedSessionActivitySchema,
  type LessonBrief,
} from "@/lib/session-generation/schema";
import {
  consumeAIRequestClaimAfterProviderFailure,
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { checkLessonGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import {
  sessionOperationFailure,
  verifyOperationalPlanSession,
} from "@/lib/server/session-operation-guard";
import { readSavedLesson, saveDeliveredLesson, savedLessonResourceFingerprint, type SavedLesson, type SavedLessonIdentity } from "@/lib/server/saved-lessons";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Do not make a learner wait for the platform's hard execution limit. If the
// provider stalls, replace the partial stream with the bounded lesson fallback
// while the session is still usable.
const LESSON_RUNTIME_DEADLINE_MS = 90_000;

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

const LessonReviewRequestSchema = z.object({
  planId: z.string().uuid(), planSessionId: z.string().uuid(),
  activityIndex: z.coerce.number().int().min(0).max(40),
  generatedAt: z.string().datetime({ offset: true }),
  routeRevisionId: z.string().uuid().optional(),
}).strict();

/** Read-only review also works after completion or archiving, without AI usage. */
export async function GET(request: Request) {
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const auth = supabase ? await supabase.auth.getUser() : null;
  const user = auth?.data.user;
  if (!supabase || auth?.error || !user) return Response.json({ error: "Sign in to review this lesson." }, { status: 401 });
  const parsed = LessonReviewRequestSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "YOVA could not identify this saved lesson." }, { status: 422 });
  const source = await loadLessonRuntimeSource(supabase, parsed.data.planId, parsed.data.planSessionId, parsed.data.activityIndex);
  if (!source?.resourceFingerprint) return Response.json({ error: "That lesson was not found." }, { status: 404 });
  if (source.generatedAt !== parsed.data.generatedAt || source.routeRevisionId !== parsed.data.routeRevisionId) {
    return Response.json({ error: "This session has changed. Reload the goal to open its current resources." }, { status: 409 });
  }
  try {
    const saved = await readSavedLesson(supabase, { ...parsed.data, userId: user.id, resourceFingerprint: source.resourceFingerprint });
    return Response.json(saved ? { saved: true, content: saved.content } : {
      saved: false,
      content: buildBoundedFallbackLesson(lessonInputFromSource(source)),
      notice: "The original explanation was not saved. This review uses the session’s saved learning points.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "YOVA could not load your saved explanation. Try again." }, { status: 503 });
  }
}

async function persistLesson(identity: SavedLessonIdentity | undefined, lesson: SavedLesson) {
  if (!identity) return { ...lesson, persisted: undefined };
  try {
    return { ...await saveDeliveredLesson(identity, lesson), persisted: true };
  } catch {
    return { ...lesson, persisted: false };
  }
}

function savedLessonResponse(saved: SavedLesson, requestId: string) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encodeLessonStreamEvent({ type: "lesson.meta", requestId, model: saved.model }));
    controller.enqueue(encodeLessonStreamEvent({ type: "lesson.replace", content: saved.content }));
    controller.enqueue(encodeLessonStreamEvent({ type: "lesson.complete", deliveryMode: saved.delivery_mode,
      persisted: true, elapsedMs: 0, latencyToFirstTokenMs: null, inputTokens: 0, cachedInputTokens: 0,
      outputTokens: 0, wordCount: countWords(saved.content), model: saved.model }));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
}

export async function POST(request: Request) {
  const requestId = lessonRequestId(request);
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

  if (!developmentPreview && supabase) {
    const operationAccess = await verifyOperationalPlanSession(supabase, parsed.data);
    if (!operationAccess.allowed) {
      const failure = sessionOperationFailure(operationAccess);
      return Response.json({ error: failure.error }, { status: failure.status });
    }
  }

  if (parsed.data.action === "skip_to_practice") {
    if (!developmentPreview && supabase && user) {
      recordGenerationObservationBestEffort(supabase, user.id, {
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
  const savedIdentity: SavedLessonIdentity | undefined = !developmentPreview && user && lesson.resourceFingerprint ? {
    userId: user.id, planId: parsed.data.planId, planSessionId: parsed.data.planSessionId,
    activityIndex: parsed.data.activityIndex, resourceFingerprint: lesson.resourceFingerprint,
  } : undefined;
  if (savedIdentity && supabase) {
    try {
      const saved = await readSavedLesson(supabase, savedIdentity);
      if (saved) return savedLessonResponse(saved, requestId);
    } catch {
      return Response.json({ error: "YOVA could not check your saved lesson. Try again before preparing another explanation." }, { status: 503 });
    }
  }
  const model = getOpenAILessonConfig()?.model ?? "lesson-model";
  const lessonInput = lessonInputFromSource(lesson);
  if (!isOpenAILessonConfigured()) {
    return boundedLessonFallbackResponse({
      lessonInput,
      savedIdentity,
      requestId,
      model,
      supabase,
      userId: user?.id,
      failureKind: "provider_request_error",
    });
  }
  const rateLimit = checkLessonGenerationRateLimit(`${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return boundedLessonFallbackResponse({
      lessonInput,
      savedIdentity,
      requestId,
      model,
      supabase,
      userId: user?.id,
      failureKind: "provider_request_error",
    });
  }

  let aiUsageClaimId: string | null = null;
  if (!developmentPreview && supabase) {
    const aiUsageRecoveryKey = crypto.randomUUID();
    try {
      const durableLimit = await reserveAIRequest(supabase, "lesson_generation", requestId, aiUsageRecoveryKey);
      if (!durableLimit.allowed) {
        const conflict = aiUsageReservationConflict(durableLimit);
        if (conflict) {
          return Response.json(
            { code: conflict.code, error: conflict.error, retryable: conflict.retryable },
            {
              status: 409,
              headers: {
                "Cache-Control": "no-store",
                ...(conflict.retryAfterSeconds === null ? {} : {
                  "Retry-After": String(conflict.retryAfterSeconds),
                }),
                "X-Yova-Request-Id": requestId,
              },
            },
          );
        }
        return boundedLessonFallbackResponse({
          lessonInput,
          savedIdentity,
          requestId,
          model,
          supabase,
          userId: user?.id,
          failureKind: "provider_request_error",
          allowanceRetryAfterSeconds: durableLimit.retryAfterSeconds,
        });
      }
      aiUsageClaimId = durableLimit.claimId;
    } catch {
      await recoverUnknownLessonReservation(supabase, requestId, aiUsageRecoveryKey);
      return boundedLessonFallbackResponse({
        lessonInput,
        savedIdentity,
        requestId,
        model,
        supabase,
        userId: user?.id,
        failureKind: "provider_request_error",
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encodeLessonStreamEvent({ type: "lesson.meta", requestId, model }));
      const startedAt = Date.now();
      const runtimeSignal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(LESSON_RUNTIME_DEADLINE_MS),
      ]);
      let streamedLessonText = "";
      try {
        const { attempts, firstFailureKind, result } = await streamGeneratedLessonWithRetry(
          lessonInput,
          (delta) => {
            streamedLessonText += delta;
            controller.enqueue(encodeLessonStreamEvent({ type: "lesson.delta", delta }));
          },
          runtimeSignal,
        );
        const abortFailure = abortedLessonResultError(
          result,
          runtimeSignal,
          attempts,
          firstFailureKind,
        );
        if (abortFailure) throw abortFailure;
        const delivered = await persistLesson(savedIdentity, {
          content: includeCoreRecallKnowledge(result.content, lessonInput.coreRecallKnowledge).slice(0, 12_000),
          delivery_mode: "generated", model: result.model,
        });
        const teachingContent = delivered.content;
        const teachingWordCount = countWords(teachingContent);
        if ((attempts > 1 || result.truncatedToBudget || teachingContent !== streamedLessonText) && teachingContent.trim()) {
          // The learner may have watched a partial or overlong first attempt
          // stream in; swap in the finished lesson atomically.
          controller.enqueue(encodeLessonStreamEvent({
            type: "lesson.replace",
            content: teachingContent.slice(0, 12_000),
          }));
        }
        await settleSuccessfulLessonClaim(supabase, aiUsageClaimId, requestId);
        controller.enqueue(encodeLessonStreamEvent({
          type: "lesson.complete",
          deliveryMode: delivered.delivery_mode,
          persisted: delivered.persisted,
          elapsedMs: result.elapsedMs,
          latencyToFirstTokenMs: result.latencyToFirstTokenMs,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens,
          wordCount: teachingWordCount,
          model: result.model,
        }));
        controller.close();
        recordGenerationObservationBestEffort(supabase, user?.id, {
          generationType: "lesson",
          environment: generationEnvironment(),
          finalOutcome: "success",
          firstAttemptPassed: attempts === 1,
          failedValidator: firstFailureKind
            ? validatorForLessonFailure(firstFailureKind)
            : null,
          repairAttempted: attempts > 1,
          repairSucceeded: attempts > 1 ? true : null,
          elapsedMs: result.elapsedMs,
          attempts,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          cacheWriteTokens: 0,
          outputTokens: result.outputTokens,
          model: result.model,
          diagnostics: {
            lessonRequestId: requestId,
            latencyToFirstTokenMs: result.latencyToFirstTokenMs,
            wordCount: teachingWordCount,
            streamCompleted: true,
            ...(result.truncatedToBudget ? { lessonTruncatedToBudget: true } : {}),
            ...(result.qualityNote ? { lessonQualityNote: result.qualityNote } : {}),
            ...(firstFailureKind ? { lessonFailureKind: firstFailureKind } : {}),
          },
        });
      } catch (error) {
        await consumeFailedLessonClaim(supabase, aiUsageClaimId, requestId);
        const failure = error instanceof StreamedLessonGenerationError ? error.stats : null;
        const failureAttempts = error instanceof StreamedLessonGenerationError ? error.attemptsMade : 1;
        const failureKind = failure?.failureKind ?? "provider_request_error";
        const initialFailureKind = error instanceof StreamedLessonGenerationError
          ? error.initialFailureKind
          : null;
        const elapsedMs = failure?.elapsedMs ?? Date.now() - startedAt;
        console.error("YOVA streamed lesson generation failed", {
          requestId,
          failureKind,
          initialFailureKind: initialFailureKind ?? "none",
          attempts: failureAttempts,
          elapsedMs,
          latencyToFirstTokenMs: failure?.latencyToFirstTokenMs ?? null,
          wordCount: failure?.wordCount ?? 0,
          model: failure?.model ?? model,
        });
        if (failureKind !== "request_aborted") {
          const delivered = await persistLesson(savedIdentity, {
            content: buildBoundedFallbackLesson(lessonInput, streamedLessonText),
            delivery_mode: "bounded_fallback", model: failure?.model ?? model,
          });
          const fallbackLesson = delivered.content;
          const fallbackWordCount = countWords(fallbackLesson);
          try {
            controller.enqueue(encodeLessonStreamEvent({
              type: "lesson.replace",
              content: fallbackLesson,
            }));
            controller.enqueue(encodeLessonStreamEvent({
              type: "lesson.complete",
              deliveryMode: delivered.delivery_mode,
              persisted: delivered.persisted,
              elapsedMs,
              latencyToFirstTokenMs: failure?.latencyToFirstTokenMs ?? null,
              inputTokens: failure?.inputTokens ?? 0,
              cachedInputTokens: failure?.cachedInputTokens ?? 0,
              outputTokens: failure?.outputTokens ?? 0,
              wordCount: fallbackWordCount,
              model: failure?.model ?? model,
            }));
            controller.close();
          } catch {
            // The learner may have left while the bounded fallback was being prepared.
          }
          recordGenerationObservationBestEffort(supabase, user?.id, {
            generationType: "lesson",
            environment: generationEnvironment(),
            finalOutcome: "fallback",
            firstAttemptPassed: false,
            failedValidator: validatorForLessonFailure(failureKind),
            repairAttempted: failureAttempts > 1,
            repairSucceeded: failureAttempts > 1 ? false : null,
            elapsedMs,
            attempts: failureAttempts,
            inputTokens: failure?.inputTokens ?? 0,
            cachedInputTokens: failure?.cachedInputTokens ?? 0,
            cacheWriteTokens: 0,
            outputTokens: failure?.outputTokens ?? 0,
            model: failure?.model ?? model,
            diagnostics: {
              lessonRequestId: requestId,
              latencyToFirstTokenMs: failure?.latencyToFirstTokenMs ?? null,
              wordCount: fallbackWordCount,
              streamCompleted: true,
              lessonFailureKind: failureKind,
            },
          });
          return;
        }

        recordGenerationObservationBestEffort(supabase, user?.id, {
          generationType: "lesson",
          environment: generationEnvironment(),
          finalOutcome: "failure",
          firstAttemptPassed: false,
          failedValidator: validatorForLessonFailure(failureKind),
          repairAttempted: failureAttempts > 1,
          repairSucceeded: failureAttempts > 1 ? false : null,
          elapsedMs,
          attempts: failureAttempts,
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
            lessonFailureKind: failureKind,
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

async function consumeFailedLessonClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null,
  claimId: string | null,
  requestId: string,
) {
  if (!supabase || !claimId) return;
  try {
    await consumeAIRequestClaimAfterProviderFailure(supabase, claimId);
  } catch {
    console.error("YOVA could not consume a failed streamed-lesson allowance claim", { requestId });
  }
}

async function settleSuccessfulLessonClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null,
  claimId: string | null,
  requestId: string,
) {
  if (!supabase || !claimId) return;
  try {
    if (!await settleAIRequestClaim(supabase, claimId)) {
      console.error("YOVA could not settle a successful streamed-lesson allowance claim", { requestId });
    }
  } catch {
    console.error("YOVA could not settle a successful streamed-lesson allowance claim", { requestId });
  }
}

async function recoverUnknownLessonReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(supabase, "lesson_generation", operationKey, recoveryKey);
  } catch {
    // Its short database lease remains the final recovery boundary.
  }
}

async function boundedLessonFallbackResponse({
  lessonInput,
  savedIdentity,
  requestId,
  model,
  supabase,
  userId,
  failureKind,
  allowanceRetryAfterSeconds,
}: {
  lessonInput: StreamedLessonInput;
  savedIdentity?: SavedLessonIdentity;
  requestId: string;
  model: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null;
  userId: string | undefined;
  failureKind: StreamedLessonFailureKind;
  allowanceRetryAfterSeconds?: number;
}) {
  const delivered = await persistLesson(savedIdentity, {
    content: buildBoundedFallbackLesson(lessonInput), delivery_mode: "bounded_fallback", model,
  });
  const content = delivered.content;
  const wordCount = countWords(content);
  const fallbackReason = allowanceRetryAfterSeconds === undefined
    ? failureKind
    : "allowance_exhausted" as const;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encodeLessonStreamEvent({ type: "lesson.meta", requestId, model }));
      controller.enqueue(encodeLessonStreamEvent({ type: "lesson.replace", content }));
      controller.enqueue(encodeLessonStreamEvent({
        type: "lesson.complete",
        deliveryMode: delivered.delivery_mode,
        persisted: delivered.persisted,
        elapsedMs: 0,
        latencyToFirstTokenMs: null,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        wordCount,
        model,
      }));
      controller.close();
    },
  });
  recordGenerationObservationBestEffort(supabase, userId, {
    generationType: "lesson",
    environment: generationEnvironment(),
    finalOutcome: "fallback",
    firstAttemptPassed: false,
    failedValidator: fallbackReason === "allowance_exhausted"
      ? null
      : validatorForLessonFailure(failureKind),
    repairAttempted: false,
    repairSucceeded: null,
    elapsedMs: 0,
    attempts: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    model,
    diagnostics: {
      lessonRequestId: requestId,
      latencyToFirstTokenMs: null,
      wordCount,
      streamCompleted: true,
      lessonFailureKind: fallbackReason,
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Yova-Request-Id": requestId,
      ...(allowanceRetryAfterSeconds === undefined ? {} : {
        ...guidedSessionAllowanceExhaustedHeaders(allowanceRetryAfterSeconds),
      }),
    },
  });
}

function validatorForLessonFailure(
  failureKind: StreamedLessonFailureKind,
): "lesson_response_status" | "lesson_stream" | "lesson_provider_request" {
  if (failureKind === "provider_failed" || failureKind === "provider_incomplete") {
    return "lesson_response_status";
  }
  if (
    failureKind === "provider_request_error"
    || failureKind === "request_aborted"
    || failureKind === "runtime_timeout"
  ) {
    return "lesson_provider_request";
  }
  return "lesson_stream";
}

function lessonRequestId(request: Request) {
  const candidate = request.headers.get("X-Yova-Request-Id")?.trim() ?? "";
  const parsed = z.string().uuid().safeParse(candidate);
  return parsed.success ? parsed.data : crypto.randomUUID();
}

function recordGenerationObservationBestEffort(
  ...args: Parameters<typeof recordGenerationObservationAfterResponse>
) {
  try {
    recordGenerationObservationAfterResponse(...args);
  } catch {
    // Telemetry must never replace lesson delivery or skip acknowledgement.
  }
}

type LessonRuntimeSource = {
  resourceFingerprint?: string;
  generatedAt?: string;
  routeRevisionId?: string;
  coreRecallKnowledge?: string[];
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
  const parsed = z.union([
    CachedGeneratedSessionV16Schema,
    CachedGeneratedSessionV17Schema,
  ]).safeParse((row.step_data as Record<string, unknown>).generatedSession);
  if (!parsed.success) return null;
  const activity = parsed.data.activities[activityIndex];
  if (!activity || activity.type !== "instruction" || !activity.lessonBrief) return null;
  return {
    resourceFingerprint: savedLessonResourceFingerprint(parsed.data),
    generatedAt: parsed.data.generatedAt,
    routeRevisionId: parsed.data.routeRevisionId,
    activity,
    deliveryInstructions: parsed.data.deliveryInstructions,
    coreRecallKnowledge: coreRecallKnowledgeForLesson(parsed.data.activities, parsed.data.coverage, activityIndex),
  };
}

function lessonInputFromSource(source: LessonRuntimeSource): StreamedLessonInput {
  const brief: LessonBrief = source.activity.lessonBrief!;
  const lessonTitle = conciseTeachingActivityTitle({
    preferredTitle: source.activity.title,
  });
  return {
    lessonTitle,
    coreRecallKnowledge: source.coreRecallKnowledge ?? [],
    plannedMinutes: source.activity.estimatedMinutes,
    topicTitles: [lessonTitle],
    // Older cached sessions may predate lesson-brief allocation and contain a
    // whole plan's targets in one short teaching activity. Defensively cap the
    // retry input so existing learners get the fixed behavior immediately.
    essentialIdeas: brief.essentialIdeas.slice(
      0,
      lessonIdeaCapacityForMinutes(source.activity.estimatedMinutes),
    ),
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

function abortedLessonResultError(
  result: StreamedLessonResult,
  signal: AbortSignal,
  attemptsMade: 1 | 2,
  initialFailureKind: StreamedLessonFailureKind | null,
) {
  if (!signal.aborted) return null;
  const failureKind = signal.reason instanceof DOMException
    && signal.reason.name === "TimeoutError"
    ? "runtime_timeout" as const
    : "request_aborted" as const;
  return new StreamedLessonGenerationError(
    "The lesson stream was interrupted.",
    {
      failureKind,
      model: result.model,
      responseId: result.responseId,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      latencyToFirstTokenMs: result.latencyToFirstTokenMs,
      elapsedMs: result.elapsedMs,
      wordCount: result.wordCount,
    },
    { attemptsMade, initialFailureKind },
  );
}

function countWords(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

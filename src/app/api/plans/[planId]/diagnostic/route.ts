import { NextResponse } from "next/server";
import { z } from "zod";
import { generationEnvironment } from "@/lib/analytics/generation-observation";
import { recordGenerationObservation } from "@/lib/analytics/generation-observation-server";
import { applyDiagnosticAnswers, generateMapDiagnostic, MapDiagnosticGenerationError } from "@/lib/diagnostics/map-diagnostic";
import { PlanKnowledgeMapSchema } from "@/lib/knowledge-map/schema";
import { PlanDiagnosticQuestionSchema } from "@/lib/plan-generation/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SubmissionSchema = z.object({
  questions: z.array(PlanDiagnosticQuestionSchema).min(1).max(8),
  answers: z.array(z.string().trim().min(1).max(180)).min(1).max(8),
}).refine((value) => value.questions.length === value.answers.length, {
  message: "Every placement question needs one answer.",
});

export async function GET(_request: Request, context: { params: Promise<{ planId: string }> }) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const { planId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before taking a placement check." }, { status: 401 });

  const loaded = await loadPlanMap(supabase, user.id, planId);
  if (!loaded) return NextResponse.json({ error: "YOVA could not load this plan's topic map." }, { status: 404 });
  try {
    const generated = await generateMapDiagnostic(loaded.map, `${loaded.title}. ${loaded.topic}`);
    await recordGenerationObservation(supabase, user.id, {
      generationType: "diagnostic",
      environment: generationEnvironment(),
      finalOutcome: "success",
      firstAttemptPassed: generated.stats.firstAttemptPassed,
      failedValidator: generated.stats.failedValidator,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: generated.stats.elapsedMs,
      attempts: generated.stats.attempts,
      inputTokens: generated.stats.inputTokens,
      cachedInputTokens: generated.stats.cachedInputTokens,
      cacheWriteTokens: generated.stats.cacheWriteTokens,
      outputTokens: generated.stats.outputTokens,
      model: generated.stats.model,
      diagnostics: { questionCount: generated.questions.length, topicCount: loaded.map.topics.length },
    });
    return NextResponse.json({ questions: generated.questions, durationMs: Date.now() - startedAt, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failedValidator = error instanceof MapDiagnosticGenerationError ? error.failedValidator : "diagnostic_provider_request" as const;
    await recordGenerationObservation(supabase, user.id, {
      generationType: "diagnostic",
      environment: generationEnvironment(),
      finalOutcome: "failure",
      firstAttemptPassed: false,
      failedValidator,
      repairAttempted: false,
      repairSucceeded: null,
      elapsedMs: Date.now() - startedAt,
      attempts: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      model: null,
    });
    return NextResponse.json({ error: "YOVA could not prepare this placement check yet." }, { status: 503 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ planId: string }> }) {
  const { planId } = await context.params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before saving placement evidence." }, { status: 401 });
  const submission = SubmissionSchema.safeParse(await request.json().catch(() => null));
  if (!submission.success) return NextResponse.json({ error: "Complete each placement question before saving it." }, { status: 422 });
  const loaded = await loadPlanMap(supabase, user.id, planId);
  if (!loaded) return NextResponse.json({ error: "YOVA could not load this plan's topic map." }, { status: 404 });
  const validTopicIds = new Set(loaded.map.topics.map((topic) => topic.id));
  if (submission.data.questions.some((question) => !validTopicIds.has(question.topicId))) {
    return NextResponse.json({ error: "The placement check no longer matches this plan." }, { status: 409 });
  }
  const result = applyDiagnosticAnswers(loaded.map, submission.data.questions, submission.data.answers, false);
  const { error: updateError } = await supabase.from("plans").update({ knowledge_map: result.map }).eq("id", planId).eq("user_id", user.id);
  if (updateError) return NextResponse.json({ error: "YOVA could not save the placement evidence." }, { status: 409 });

  const demonstratedTopicIds = new Set<string>(result.responses.filter((response) => response.evaluation === "correct").map((response) => response.topicId));
  const demonstratedTitles = result.map.topics.filter((topic) => demonstratedTopicIds.has(topic.id)).map((topic) => topic.title);
  const { data: unfinishedRows } = await supabase.from("plan_sessions").select("id,step_data").eq("plan_id", planId).eq("user_id", user.id).in("status", ["ready", "upcoming"]);
  const affectedSessionCount = (unfinishedRows ?? []).filter((row) => {
    const topicIds = readTopicIds(row.step_data);
    return topicIds.some((topicId) => demonstratedTopicIds.has(topicId)) && readLearningMode(row.step_data) === "learn";
  }).length;
  const adjustment = affectedSessionCount > 0 && demonstratedTitles.length > 0 ? {
    title: "Shorten lessons on demonstrated topics?",
    explanation: `You demonstrated ${demonstratedTitles.join(", ")}. YOVA can replace ${affectedSessionCount} unfinished teaching ${affectedSessionCount === 1 ? "session" : "sessions"} with shorter verification checks. Nothing changes unless you approve.`,
    direction: `For unfinished sessions only, replace full teaching for these demonstrated topics with short closed-source verification checks: ${demonstratedTitles.join(", ")}. Keep confirmed gaps teaching first. Preserve all other topic coverage, prerequisites, completed work, and scheduled reviews.`,
  } : null;
  return NextResponse.json({ knowledgeMap: result.map, responses: result.responses, adjustment }, { headers: { "Cache-Control": "no-store" } });
}

async function loadPlanMap(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string, planId: string) {
  const { data: plan } = await supabase.from("plans").select("knowledge_map,learning_item_id").eq("id", planId).eq("user_id", userId).maybeSingle();
  if (!plan) return null;
  const parsed = PlanKnowledgeMapSchema.safeParse(plan.knowledge_map);
  if (!parsed.success) return null;
  const { data: item } = await supabase.from("learning_items").select("title,topic").eq("id", plan.learning_item_id).eq("user_id", userId).maybeSingle();
  if (!item) return null;
  return { map: parsed.data, title: item.title, topic: item.topic };
}

function readTopicIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const topicIds = (value as Record<string, unknown>).topicIds;
  return Array.isArray(topicIds) ? topicIds.filter((topicId): topicId is string => typeof topicId === "string") : [];
}

function readLearningMode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mode = (value as Record<string, unknown>).learningMode;
  return mode === "learn" || mode === "study" ? mode : null;
}

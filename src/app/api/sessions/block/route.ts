import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { evaluateAnswerWithOpenAI } from "@/lib/openai/answer-evaluator";
import { reserveAIRequest, settleAIRequestClaim, consumeAIRequestClaimAfterProviderFailure } from "@/lib/server/ai-usage";
import { checkAnswerEvaluationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { BlockActionSchema, advanceBlockProgress, type BlockAttempt } from "@/lib/session-blocks/progress";
import { BlockBindingSchema, readStoredBlock, saveStoredBlockProgress, publicBlockProgress, readDevelopmentBlock, saveDevelopmentBlockProgress } from "@/lib/session-blocks/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let raw: Record<string, unknown>;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "This block action is not valid JSON." }, { status: 400 }); }
  const binding = BlockBindingSchema.safeParse(raw);
  if (!binding.success) return NextResponse.json({ error: "Reopen the saved block before continuing." }, { status: 422 });
  const { planId: _plan, planSessionId: _session, routeRevisionId: _route, blockId: _block, ...actionFields } = raw;
  void _plan; void _session; void _route; void _block;
  const action = BlockActionSchema.safeParse(actionFields);
  if (!action.success) return NextResponse.json({ error: "Send only your action or answer; YOVA checks the saved question." }, { status: 422 });
  const preview = isDevelopmentPreviewRequest(request);
  const supabase = preview ? null : await createSupabaseServerClient();
  const auth = supabase ? await supabase.auth.getUser() : { data: { user: { id: "development-preview" } }, error: null };
  const user = auth.data.user;
  if (auth.error || !user) return NextResponse.json({ error: "Sign in to resume your practice." }, { status: 401 });
  let claimId: string | null = null;
  try {
    const stored = preview ? readDevelopmentBlock(binding.data) : await readStoredBlock(user.id, binding.data);
    let checked: BlockAttempt | undefined;
    const block = stored.resource.block;
    const requestedQuestionId = action.data.action === "answer" ? action.data.questionId : null;
    if (action.data.action === "answer" && !stored.progress.complete && !stored.progress.attempts.some(item => item.questionId === requestedQuestionId)) {
      const { questionId, answer } = action.data;
      const question = block.questions.find(item => item.id === questionId);
      const key = stored.answerKeys.find(item => item.questionId === questionId);
      if (!question || !key) return NextResponse.json({ error: "That question is not in this saved block." }, { status: 422 });
      if (question.format === "multiple_choice") {
        if (!question.choices.includes(answer)) return NextResponse.json({ error: "Choose one of the saved options." }, { status: 422 });
        const secure = answer === key.answer;
        checked = { questionId, outcome: secure ? "secure" : "needs_review", assisted: false,
          feedback: secure ? key.explanation : `You chose “${answer}”. ${key.explanation}` };
      } else {
        const limit = checkAnswerEvaluationRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
        if (!limit.allowed) return NextResponse.json({ error: "Wait a moment before checking again. Your practice is saved." }, { status: 429 });
        const reservation = supabase ? await reserveAIRequest(supabase, "answer_evaluation", requestId, crypto.randomUUID()) : { allowed: true, claimId: null };
        if (!reservation.allowed) return NextResponse.json({ error: "Answer checking is unavailable right now. Your practice is saved; you can reveal this answer and continue without recording evidence." }, { status: 429 });
        claimId = reservation.claimId;
        const evaluation = await evaluateAnswerWithOpenAI({ ...binding.data, learnerAnswer: answer, activity: {
          title: block.objective, prompt: question.prompt + block.sources.filter(source => key.sourceIds.includes(source.id)).map(source => `\nAssigned section (${source.section}): ${source.text}`).join(""),
          concept: question.prompt, referenceAnswer: key.answer,
          rubric: `Required ideas: ${key.requiredIdeas.join("; ")}. Accept accurate paraphrases. ${key.explanation}`,
        } });
        if (supabase && claimId) await settleAIRequestClaim(supabase, claimId);
        claimId = null;
        checked = { questionId, outcome: evaluation.verdict, feedback: evaluation.feedback, assisted: false };
      }
    }
    const progress = advanceBlockProgress(block, stored.progress, action.data, checked);
    if (JSON.stringify(progress) !== JSON.stringify(stored.progress)) {
      if (preview) saveDevelopmentBlockProgress(binding.data, stored, progress);
      else await saveStoredBlockProgress(user.id, binding.data, stored, progress);
    }
    return NextResponse.json(publicBlockProgress(stored, progress, binding.data));
  } catch (error) {
    if (claimId && supabase) { try { await consumeAIRequestClaimAfterProviderFailure(supabase, claimId); } catch { /* Existing ledger recovery retains the claim. */ } }
    const detail = error instanceof Error ? error.message : "This action could not be saved.";
    return NextResponse.json({ error: `${detail} Your previous practice progress is saved.` }, { status: 409 });
  }
}

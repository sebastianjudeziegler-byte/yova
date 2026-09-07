import { NextResponse } from "next/server";
import { applyDiagnosticAnswers } from "@/lib/diagnostics/map-diagnostic";
import { DiagnosticSubmissionSchema, issueKnowledgeMapReceipt, readDiagnosticChallenge } from "@/lib/diagnostics/diagnostic-authority";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { claimDiagnosticAnswers } from "@/lib/diagnostics/scoring-receipt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const preview = isDevelopmentPreviewRequest(request);
  const user = preview ? {id: "development-preview"} : (await (await createSupabaseServerClient()).auth.getUser()).data.user;
  if (!user) return NextResponse.json({error: "Sign in before saving placement evidence."}, {status: 401});
  const parsed = DiagnosticSubmissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({error: "Complete each placement question before saving it."}, {status: 422});
  try {
    const challenge = readDiagnosticChallenge(parsed.data.challengeToken, user.id, null, preview);
    if (challenge.questions.length !== parsed.data.answers.length
      || challenge.questions.some((question, index) => !question.options.includes(parsed.data.answers[index]!))) {
      return NextResponse.json({error: "Choose one of the answers for every question."}, {status: 422});
    }
    let claimed: boolean;
    try {
      claimed = await claimDiagnosticAnswers({token:parsed.data.challengeToken,answers:parsed.data.answers,userId:user.id,expiresAt:challenge.expiresAt,preview});
    } catch {
      return NextResponse.json({error:"YOVA could not save this check yet. Your answers are still here; try again."},{status:503});
    }
    if (!claimed) return NextResponse.json({error:"You already submitted answers for this check. Start a fresh check to try again."},{status:409});
    const result = applyDiagnosticAnswers(challenge.map, challenge.questions, parsed.data.answers, false);
    return NextResponse.json({knowledgeMap: result.map, responses: result.responses, knowledgeMapReceipt: issueKnowledgeMapReceipt(result.map, user.id, preview)}, {headers: {"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"This placement check expired or could not be verified. Start a fresh check."}, {status:409});
  }
}

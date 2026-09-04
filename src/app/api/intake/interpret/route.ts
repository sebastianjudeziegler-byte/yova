import { NextResponse } from "next/server";
import { interpretIntake } from "@/lib/intake/interpret";
import { interpretIntakeWithOpenAI } from "@/lib/openai/intake-interpreter";
import {
  IntakeInterpretationRequestSchema,
  IntakeInterpretationSchema,
  type IntakeInterpretation,
} from "@/lib/intake/schema";
import { isOpenAISessionConfigured } from "@/lib/openai/config";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import {
  refundAIRequestReservationBeforeProvider,
  reserveAIRequest,
  settleAIRequestClaim,
} from "@/lib/server/ai-usage";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = operationRequestId(request);
  const developmentPreview = isDevelopmentPreviewRequest(request);
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  if (isSupabaseConfigured() && !developmentPreview) {
    supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Sign in before adding something to YOVA." }, { status: 401 });
  }

  const parsed = IntakeInterpretationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe what you need in a little more detail." }, { status: 422 });

  const deterministic = IntakeInterpretationSchema.parse(interpretIntake({
    description: parsed.data.description,
    materialNames: parsed.data.materialNames,
    timeZone: parsed.data.timeZone,
  }));
  if (developmentPreview || !supabase || !isOpenAISessionConfigured()) {
    return intakeResponse(deterministic, requestId);
  }

  const recoveryKey = crypto.randomUUID();
  let reservation: Awaited<ReturnType<typeof reserveAIRequest>>;
  try {
    reservation = await reserveAIRequest(
      supabase,
      "intake_interpretation",
      requestId,
      recoveryKey,
    );
  } catch {
    await recoverUnknownIntakeReservation(supabase, requestId, recoveryKey);
    return intakeResponse(deterministic, requestId);
  }
  if (!reservation.allowed) return intakeResponse(deterministic, requestId);
  if (!await consumeIntakeClaim(supabase, reservation.claimId, requestId)) {
    await recoverUnknownIntakeReservation(supabase, requestId, recoveryKey);
    return intakeResponse(deterministic, requestId);
  }

  let interpretation: IntakeInterpretation;
  try {
    interpretation = await interpretIntakeWithOpenAI({
      description: parsed.data.description,
      materialNames: parsed.data.materialNames,
      timeZone: parsed.data.timeZone,
      deterministic,
    });
  } catch {
    return intakeResponse(deterministic, requestId);
  }

  return intakeResponse(interpretation, requestId);
}

function intakeResponse(interpretation: IntakeInterpretation, requestId: string) {
  return NextResponse.json({ interpretation }, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

async function consumeIntakeClaim(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  claimId: string,
  requestId: string,
) {
  try {
    const consumed = await settleAIRequestClaim(supabase, claimId);
    if (!consumed) {
      console.error("YOVA could not settle an intake-interpretation allowance claim", { requestId });
    }
    return consumed;
  } catch {
    console.error("YOVA could not settle an intake-interpretation allowance claim", { requestId });
    return false;
  }
}

async function recoverUnknownIntakeReservation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  operationKey: string,
  recoveryKey: string,
) {
  try {
    await refundAIRequestReservationBeforeProvider(
      supabase,
      "intake_interpretation",
      operationKey,
      recoveryKey,
    );
  } catch {
    // If recovery cannot be confirmed, lease expiry conservatively consumes
    // the attempt so an ambiguous provider charge can never be refunded.
  }
}

function operationRequestId(request: Request) {
  const candidate = request.headers.get("X-Yova-Request-Id")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

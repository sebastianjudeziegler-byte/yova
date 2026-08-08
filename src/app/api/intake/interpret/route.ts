import { NextResponse } from "next/server";
import { interpretIntake } from "@/lib/intake/interpret";
import { interpretIntakeWithOpenAI } from "@/lib/openai/intake-interpreter";
import {
  IntakeInterpretationRequestSchema,
  IntakeInterpretationSchema,
} from "@/lib/intake/schema";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const developmentPreview = isDevelopmentPreviewRequest(request);
  if (isSupabaseConfigured() && !developmentPreview) {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Sign in before adding something to YOVA." }, { status: 401 });
  }

  const parsed = IntakeInterpretationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe what you need in a little more detail." }, { status: 422 });

  const deterministic = IntakeInterpretationSchema.parse(interpretIntake({
    description: parsed.data.description,
    materialNames: parsed.data.materialNames,
  }));
  const interpretation = developmentPreview
    ? deterministic
    : await interpretIntakeWithOpenAI({
      description: parsed.data.description,
      materialNames: parsed.data.materialNames,
      timeZone: parsed.data.timeZone,
      deterministic,
    }).catch(() => deterministic);
  return NextResponse.json({ interpretation }, { headers: { "Cache-Control": "no-store" } });
}

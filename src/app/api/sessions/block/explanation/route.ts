import { z } from "zod";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { BlockBindingSchema, readStoredBlock, readDevelopmentBlock } from "@/lib/session-blocks/store";
import { streamReviewedBlockExplanation } from "@/lib/session-blocks/explanation-stream";
const RequestSchema = BlockBindingSchema.extend({ activityId: z.string().min(1).max(200) }).strict();
export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Reopen the saved explanation before continuing." }, { status: 422 });
  try {
    const preview = isDevelopmentPreviewRequest(request);
    const supabase = preview ? null : await createSupabaseServerClient();
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    if (!preview && !user) return NextResponse.json({ error: "Sign in to open your saved explanation." }, { status: 401 });
    const stored = preview ? readDevelopmentBlock(parsed.data) : await readStoredBlock(user!.id, parsed.data);
    return new Response(streamReviewedBlockExplanation(stored.resource.block, parsed.data.activityId), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "This saved explanation could not be reopened. Your practice progress is unchanged." }, { status: 409 });
  }
}

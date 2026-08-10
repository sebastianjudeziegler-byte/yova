import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAIClient } from "@/lib/openai/client";
import { getOpenAISessionConfig } from "@/lib/openai/config";
import { checkSessionGenerationRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { claimAIRequest } from "@/lib/server/ai-usage";
import { isDevelopmentPreviewRequest } from "@/lib/server/development-preview";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const TeachingVisualRequestSchema = z.object({
  title: z.string().trim().min(3).max(140),
  keyIdea: z.string().trim().min(10).max(220),
  explanation: z.string().trim().min(40).max(700),
});

export async function POST(request: Request) {
  const developmentPreview = isDevelopmentPreviewRequest(request);
  const supabase = isSupabaseConfigured() ? await createSupabaseServerClient() : null;
  const { data: { user }, error: userError } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null }, error: null };
  if (!developmentPreview && supabase && (userError || !user)) {
    return NextResponse.json({ error: "Sign in to create a teaching visual." }, { status: 401 });
  }

  const parsed = TeachingVisualRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That visual request was not valid." }, { status: 422 });
  const config = getOpenAISessionConfig();
  if (!config) return NextResponse.json({ error: "Teaching visuals are not configured yet." }, { status: 503 });

  const rateLimit = checkSessionGenerationRateLimit(`visual:${user?.id ?? "preview"}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Wait a moment before creating another visual." }, { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } });
  }
  if (supabase && user && !developmentPreview) {
    const usage = await claimAIRequest(supabase, "teaching_visual");
    if (!usage.allowed) return NextResponse.json({ error: "Your teaching visual limit has been reached for today." }, { status: 429, headers: { "Retry-After": String(usage.retryAfterSeconds) } });
  }

  try {
    const response = await getOpenAIClient().responses.create({
      model: config.model,
      input: `Create one accurate educational illustration for a lesson titled "${parsed.data.title}".\n\nCore idea: ${parsed.data.keyIdea}\n\nExplanation: ${parsed.data.explanation}\n\nUse a clean textbook-style composition with a light background, clear spatial relationships, and no decorative AI imagery. Do not include paragraphs, labels, captions, logos, watermarks, or invented facts. The illustration must help a learner understand the concrete structure, process, location, or comparison in the lesson.`,
      tools: [{ type: "image_generation", quality: "low", size: "1024x1024", output_format: "webp" }],
      tool_choice: { type: "image_generation" },
      store: false,
    }, { maxRetries: 0, timeout: 90_000 });
    const imageCall = response.output.find((item) => item.type === "image_generation_call");
    if (!imageCall || !imageCall.result) throw new Error("missing_image");
    return NextResponse.json({ imageDataUrl: `data:image/webp;base64,${imageCall.result}` }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "YOVA could not create this visual right now." }, { status: 503 });
  }
}

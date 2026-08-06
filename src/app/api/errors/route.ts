import { NextResponse } from "next/server";
import { ErrorReportRequestSchema } from "@/lib/monitoring/schema";
import { checkErrorReportRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function accepted() {
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return accepted();

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return accepted();

  const rateLimit = checkErrorReportRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) return accepted();

  const body: unknown = await request.json().catch(() => null);
  const parsed = ErrorReportRequestSchema.safeParse(body);
  if (!parsed.success) return accepted();

  const { error } = await supabase.from("error_reports").insert({
    user_id: user.id,
    surface: parsed.data.surface,
    error_code: parsed.data.errorCode,
    error_digest: parsed.data.digest ?? null,
    route_path: parsed.data.routePath ?? null,
    request_id: parsed.data.requestId ?? null,
  });

  if (error) {
    console.error("YOVA error report persistence failed", {
      surface: parsed.data.surface,
      errorCode: parsed.data.errorCode,
    });
  }

  return accepted();
}

import { NextResponse } from "next/server";
import {
  GuidedSessionAllowanceStatusResponseSchema,
  type GuidedSessionAllowanceStatusResponse,
} from "@/lib/session-generation/allowance-status";
import { readAIUsageStatus } from "@/lib/server/ai-usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return statusError();
  }

  let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    authResult = await supabase.auth.getUser();
  } catch {
    return statusError();
  }
  if (authResult.error || !authResult.data.user) {
    return NextResponse.json(
      { error: "Sign in to check the guided-session allowance." },
      { status: 401, headers: privateHeaders() },
    );
  }

  let usage: Awaited<ReturnType<typeof readAIUsageStatus>>;
  try {
    usage = await readAIUsageStatus(supabase, "session_generation");
  } catch {
    return statusError();
  }

  const body: GuidedSessionAllowanceStatusResponse = usage.allowed
    ? {
      status: "available",
      remainingToday: usage.remainingToday,
      retryAfterSeconds: 0,
      resetAt: null,
    }
    : usage.limitedBy === "day"
      ? {
        status: "exhausted",
        remainingToday: 0,
        retryAfterSeconds: usage.retryAfterSeconds,
        resetAt: usage.resetAt,
      }
      : {
        status: "temporarily_limited",
        remainingToday: usage.remainingToday,
        retryAfterSeconds: usage.retryAfterSeconds,
        resetAt: usage.resetAt,
      };
  const response = GuidedSessionAllowanceStatusResponseSchema.safeParse(body);
  if (!response.success) return statusError();

  return NextResponse.json(response.data, {
    headers: privateHeaders(usage.allowed ? null : usage.retryAfterSeconds),
  });
}

function statusError() {
  return NextResponse.json(
    { error: "YOVA could not check the guided-session allowance right now." },
    { status: 503, headers: privateHeaders() },
  );
}

function privateHeaders(retryAfterSeconds: number | null = null) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    ...(retryAfterSeconds === null ? {} : { "Retry-After": String(retryAfterSeconds) }),
  };
}

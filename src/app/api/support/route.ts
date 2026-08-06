import { NextResponse } from "next/server";
import { checkSupportRequestRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupportRequestSchema } from "@/lib/support/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Support requests require YOVA's cloud connection." }, { status: 503 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to send a private support request." }, { status: 401 });
  }

  const rateLimit = checkSupportRequestRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many support requests were sent at once. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The support request was not valid JSON." }, { status: 400 });
  }

  const parsed = SupportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Add a short subject and a message between 10 and 4,000 characters." },
      { status: 422 },
    );
  }

  const requestId = crypto.randomUUID();
  const { error } = await supabase.from("support_requests").insert({
    id: requestId,
    user_id: user.id,
    category: parsed.data.category,
    subject: parsed.data.subject,
    message: parsed.data.message,
  });
  if (error) {
    return NextResponse.json({ error: "YOVA could not save that support request. Try again." }, { status: 500 });
  }

  return NextResponse.json(
    { requestId },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

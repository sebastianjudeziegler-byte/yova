import { NextResponse } from "next/server";
import { ProductEventRequestSchema } from "@/lib/analytics/schema";
import { checkProductEventRateLimit, requestRateLimitKey } from "@/lib/server/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return new NextResponse(null, { status: 204 });

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before recording product activity." }, { status: 401 });
  }

  const rateLimit = checkProductEventRateLimit(`${user.id}:${requestRateLimitKey(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many product events were received at once." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The product event was not valid JSON." }, { status: 400 });
  }

  const parsed = ProductEventRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That product event is not supported." }, { status: 422 });
  }

  const { error } = await supabase.from("product_events").insert({
    user_id: user.id,
    event_name: parsed.data.eventName,
    event_data: parsed.data.context,
  });
  if (error) {
    return NextResponse.json({ error: "YOVA could not record that product event." }, { status: 500 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { safeAuthCallbackUrl } from "@/lib/auth/callback-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const requestedNext = requestUrl.searchParams.get("next") ?? "/";
  const destination = safeAuthCallbackUrl(requestUrl.origin, requestedNext);

  if (!code || !isSupabaseConfigured()) {
    const errorUrl = new URL("/", requestUrl.origin);
    errorUrl.searchParams.set("auth", "invalid-link");
    return NextResponse.redirect(errorUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("YOVA authentication callback exchange failed", {
      code: error.code ?? "unknown",
      name: error.name,
      status: error.status ?? null,
    });
    const errorUrl = new URL("/", requestUrl.origin);
    errorUrl.searchParams.set("auth", "failed");
    return NextResponse.redirect(errorUrl);
  }

  return NextResponse.redirect(destination);
}

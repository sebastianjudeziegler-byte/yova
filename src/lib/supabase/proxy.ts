import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function updateSupabaseSession(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // This validates and refreshes the cookie-backed session when needed.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (process.env.AUTH_INVITE_ONLY !== "true" || isPublicInviteOnlyPath(request.nextUrl.pathname)) {
    return response;
  }

  const authenticated = typeof claims?.sub === "string" && claims.sub.length > 0;
  if (!authenticated) {
    return request.nextUrl.pathname.startsWith("/api/")
      ? inviteAccessResponse(request, response, 401)
      : response;
  }

  const { data: accessGranted, error: accessError } = await supabase
    .rpc("claim_yova_tester_access");
  if (accessError) return inviteAccessUnavailableResponse(request);
  if (accessGranted === true) return response;

  return inviteAccessResponse(request, response, 403);
}

function inviteAccessUnavailableResponse(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const response = isApi
    ? NextResponse.json(
      { error: "YOVA could not verify tester access right now. Try again." },
      { status: 503 },
    )
    : new NextResponse(
      "YOVA could not verify private-alpha access right now. Refresh in a moment.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function isPublicInviteOnlyPath(pathname: string) {
  return pathname === "/privacy"
    || pathname === "/terms"
    || pathname === "/support"
    || pathname.startsWith("/auth/")
    || pathname === "/api/system/status"
    || pathname === "/api/errors"
    || pathname === "/api/support";
}

function inviteAccessResponse(
  request: NextRequest,
  sessionResponse: NextResponse,
  status: 401 | 403,
) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const denied = isApi
    ? NextResponse.json(
      { error: status === 401 ? "Sign in with an invited tester account." : "This account does not have YOVA tester access." },
      { status },
    )
    : NextResponse.redirect(new URL("/?auth=invite-required", request.url));

  denied.headers.set("Cache-Control", "no-store");
  for (const cookie of sessionResponse.cookies.getAll()) denied.cookies.set(cookie);

  if (status === 403) {
    for (const cookie of request.cookies.getAll()) {
      if (cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")) {
        denied.cookies.set(cookie.name, "", { maxAge: 0, path: "/" });
      }
    }
  }

  return denied;
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const PUBLIC_INVITE_ONLY_PATHS = new Set([
  "/privacy",
  "/terms",
  "/support",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/opengraph-image",
  "/twitter-image",
  "/study-profile",
  "/study-profile/waitlist/confirm",
  "/study-profile/opengraph-image",
  "/study-profile/twitter-image",
  "/api/system/status",
  "/api/errors",
  "/api/internal/account-export-cleanup",
  "/api/study-profile/events",
  "/api/study-profile/responses",
  "/api/study-profile/waitlist",
  "/api/study-profile/waitlist/confirm",
]);

const PUBLIC_STUDY_PROFILE_REPORT_PATH = /^\/study-profile\/report\/[^/]+$/u;
const PUBLIC_STUDY_PROFILE_TOKEN_API_PATH = /^\/api\/study-profile\/(?:reports|interest)\/[^/]+$/u;

export async function updateSupabaseSession(request: NextRequest) {
  const inviteOnly = process.env.AUTH_INVITE_ONLY === "true";
  const publicPath = isPublicInviteOnlyPath(request.nextUrl.pathname);
  const config = getSupabasePublicConfig();
  if (!config) {
    if (!inviteOnly || publicPath || request.nextUrl.pathname === "/") {
      return NextResponse.next({ request });
    }
    return inviteAccessUnavailableResponse(request);
  }

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

  if (!inviteOnly || publicPath) {
    return response;
  }

  const authenticated = typeof claims?.sub === "string" && claims.sub.length > 0;
  if (!authenticated) {
    // Keep the marketing shell visible, but do not let signed-out visitors
    // browse product pages that happen to render without an API request.
    return request.nextUrl.pathname === "/"
      ? response
      : inviteAccessResponse(request, response, 401);
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
  return PUBLIC_INVITE_ONLY_PATHS.has(pathname)
    || pathname.startsWith("/auth/")
    || PUBLIC_STUDY_PROFILE_REPORT_PATH.test(pathname)
    || PUBLIC_STUDY_PROFILE_TOKEN_API_PATH.test(pathname);
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

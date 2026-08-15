import { NextResponse } from "next/server";
import { isOpenAIPlanConfigured, isOpenAISessionConfigured, isOpenAITutorConfigured } from "@/lib/openai/config";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseConfig = getSupabasePublicConfig();
  const [testerInvitations, publicSignup] = await Promise.all([
    testerInvitationStatus(),
    publicSignupStatus(supabaseConfig),
  ]);

  return NextResponse.json({
    planGeneration: isOpenAIPlanConfigured() ? "openai" : "preview",
    guidedSessions: isOpenAISessionConfigured() ? "openai" : "unavailable",
    tutor: isOpenAITutorConfigured() ? "openai" : "unavailable",
    materials: isSupabaseConfigured() ? "private-supabase" : "unavailable",
    persistence: isSupabaseConfigured() ? "supabase" : "browser",
    authentication: isSupabaseConfigured() ? "supabase-email" : "browser-preview",
    testerAccess: process.env.AUTH_INVITE_ONLY === "true" ? "invite-only" : "open",
    testerInvitations,
    emailVerification: process.env.AUTH_EMAIL_CODE_VERIFICATION === "true" ? "code-and-link" : "link-only",
    publicSignup,
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function testerInvitationStatus() {
  if (!isSupabaseAdminConfigured()) return "unavailable";

  try {
    const { error } = await createSupabaseAdminClient()
      .from("tester_invites")
      .select("id", { head: true, count: "exact" });
    return error ? "unavailable" : "founder-managed";
  } catch {
    return "unavailable";
  }
}

async function publicSignupStatus(config: ReturnType<typeof getSupabasePublicConfig>) {
  if (!config) return "unknown";

  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return "unknown";
    const settings: unknown = await response.json();
    if (!settings || typeof settings !== "object" || !("disable_signup" in settings)) return "unknown";
    return settings.disable_signup === true ? "disabled" : "enabled";
  } catch {
    return "unknown";
  }
}

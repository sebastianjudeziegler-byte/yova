import { NextResponse } from "next/server";
import { isAccountExportCleanupConfigured } from "@/lib/account-export/config";
import { isOpenAIPlanConfigured, isOpenAISessionConfigured, isOpenAITutorConfigured } from "@/lib/openai/config";
import { personalizationRolloutConfigurationStatus } from "@/lib/server/personalization-rollout";
import { studyProfilePublicReadinessStatus } from "@/lib/study-profile/readiness";
import { createSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/supabase/config";
import { publicLaunchAbuseReadinessStatus } from "@/lib/supabase/public-launch-abuse-readiness";
import { signedInGenerationReadinessStatus } from "@/lib/supabase/signed-in-generation-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseConfig = getSupabasePublicConfig();
  const [
    testerInvitations,
    authSettings,
    signedInGeneration,
    studyProfilePublic,
    launchAbuseProtection,
  ] = await Promise.all([
    testerInvitationStatus(),
    publicAuthSettingsStatus(supabaseConfig),
    signedInGenerationReadinessStatus(),
    studyProfilePublicReadinessStatus(),
    publicLaunchAbuseReadinessStatus(),
  ]);
  const passwordAccountsEnabled = process.env.AUTH_PASSWORD_ACCOUNTS === "true";
  const captchaRequested = process.env.AUTH_CAPTCHA_ENABLED === "true";
  const turnstileSiteKeyConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  const captchaClient = captchaRequested === turnstileSiteKeyConfigured
    ? captchaRequested ? "turnstile" : "disabled"
    : "misconfigured";

  return NextResponse.json({
    planGeneration: isOpenAIPlanConfigured() ? "openai" : "preview",
    guidedSessions: isOpenAISessionConfigured() ? "openai" : "unavailable",
    signedInGeneration,
    launchAbuseProtection,
    personalizationRollout: personalizationRolloutConfigurationStatus(),
    studyProfilePublic,
    studyProfileEmail: isStudyProfileEmailConfigured() ? "resend" : "unavailable",
    tutor: isOpenAITutorConfigured() ? "openai" : "unavailable",
    materials: isSupabaseConfigured() ? "private-supabase" : "unavailable",
    persistence: isSupabaseConfigured() ? "supabase" : "browser",
    authentication: isSupabaseConfigured()
      ? passwordAccountsEnabled ? "supabase-password-and-email" : "supabase-email"
      : "browser-preview",
    testerAccess: process.env.AUTH_INVITE_ONLY === "true" ? "invite-only" : "open",
    testerInvitations,
    emailVerification: process.env.AUTH_EMAIL_CODE_VERIFICATION === "true" ? "code-and-link" : "link-only",
    passwordAccounts: passwordAccountsEnabled ? "enabled" : "disabled",
    captchaClient,
    publicSignup: authSettings.signup,
    accountDataExport: isAccountExportCleanupConfigured() ? "enabled" : "unavailable",
    accountDeletion: isAccountExportCleanupConfigured() ? "enabled" : "unavailable",
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

function isStudyProfileEmailConfigured() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const sender = process.env.STUDY_PROFILE_FROM_EMAIL?.trim();
  if (!apiKey?.startsWith("re_") || apiKey.length < 20 || !sender) return false;
  const bracketed = sender.match(/^[^<>\r\n]{1,100}<([^<>\r\n]+)>$/u);
  const address = bracketed?.[1]?.trim() || sender;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(address);
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

async function publicAuthSettingsStatus(config: ReturnType<typeof getSupabasePublicConfig>) {
  if (!config) return { signup: "unknown" } as const;

  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { signup: "unknown" } as const;
    const settings: unknown = await response.json();
    if (!settings || typeof settings !== "object") return { signup: "unknown" } as const;
    const signup = "disable_signup" in settings
      ? settings.disable_signup === true ? "disabled" : "enabled"
      : "unknown";
    return { signup } as const;
  } catch {
    return { signup: "unknown" } as const;
  }
}

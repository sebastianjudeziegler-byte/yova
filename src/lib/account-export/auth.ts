import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

const RECENT_AUTH_SECONDS = 10 * 60;
const FUTURE_CLOCK_SKEW_SECONDS = 60;
const HUMAN_AUTH_METHODS = new Set([
  "password",
  "otp",
  "oauth",
  "totp",
  "mfa/totp",
  "mfa/phone",
  "mfa/webauthn",
  "sso/saml",
  "magiclink",
  "web3",
]);

export type AccountExportAuthContext = {
  user: User;
  sessionId: string;
};

export type AccountExportAuthResult =
  | { ok: true; context: AccountExportAuthContext }
  | { ok: false; reason: "signed_out" | "unverified_email" | "reauth_required" };

export async function authenticateAccountExportStart(
  supabase: SupabaseClient,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<AccountExportAuthResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, reason: "signed_out" };
  if (!userData.user.email || !userData.user.email_confirmed_at) {
    return { ok: false, reason: "unverified_email" };
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (
    claimsError
    || !claims
    || claims.sub !== userData.user.id
    || typeof claims.session_id !== "string"
    || !isUuid(claims.session_id)
    || claims.is_anonymous === true
    || !hasRecentHumanAmr(claims.amr, nowSeconds)
  ) {
    return { ok: false, reason: "reauth_required" };
  }

  return {
    ok: true,
    context: { user: userData.user, sessionId: claims.session_id },
  };
}

export async function authenticateAccountExportFinalize(
  supabase: SupabaseClient,
): Promise<AccountExportAuthResult> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, reason: "signed_out" };
  if (!userData.user.email || !userData.user.email_confirmed_at) {
    return { ok: false, reason: "unverified_email" };
  }

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (
    claimsError
    || !claims
    || claims.sub !== userData.user.id
    || typeof claims.session_id !== "string"
    || !isUuid(claims.session_id)
    || claims.is_anonymous === true
  ) {
    return { ok: false, reason: "signed_out" };
  }

  return {
    ok: true,
    context: { user: userData.user, sessionId: claims.session_id },
  };
}

export function hasRecentHumanAmr(value: unknown, nowSeconds: number) {
  if (!Array.isArray(value) || value.length === 0) return false;

  return value.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const candidate = entry as Record<string, unknown>;
    const method = typeof candidate.method === "string" ? candidate.method.toLowerCase() : "";
    const timestamp = candidate.timestamp;
    return HUMAN_AUTH_METHODS.has(method)
      && typeof timestamp === "number"
      && Number.isInteger(timestamp)
      && timestamp >= nowSeconds - RECENT_AUTH_SECONDS
      && timestamp <= nowSeconds + FUTURE_CLOCK_SKEW_SECONDS;
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

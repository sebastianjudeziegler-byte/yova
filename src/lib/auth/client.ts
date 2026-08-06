"use client";

import type { PreviewAccount } from "@/lib/domain";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type EmailAuthRequest = {
  email: string;
  displayName: string;
  shouldCreateUser: boolean;
};

export type EmailAuthResult =
  | { mode: "preview" }
  | { mode: "supabase"; emailSent: true };

const AUTH_CHECK_TIMEOUT_MS = 8_000;

export class AuthConnectionError extends Error {
  constructor() {
    super("YOVA could not reach its secure account service. Check your connection and try again.");
    this.name = "AuthConnectionError";
  }
}

export function getAuthMode() {
  return isSupabaseConfigured() ? "supabase" as const : "preview" as const;
}

export async function requestEmailAuthentication({
  email,
  displayName,
  shouldCreateUser,
}: EmailAuthRequest): Promise<EmailAuthResult> {
  if (!isSupabaseConfigured()) return { mode: "preview" };

  const supabase = createSupabaseBrowserClient();
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", "/");

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser,
      emailRedirectTo: callbackUrl.toString(),
      data: shouldCreateUser ? { display_name: displayName } : undefined,
    },
  });

  if (error) {
    const rateLimited = error.code === "over_email_send_rate_limit"
      || error.message.toLowerCase().includes("rate limit");

    if (rateLimited) {
      throw new Error("Too many sign-in emails were requested. Open the newest email already sent, or wait about an hour and try again.");
    }

    throw new Error("YOVA could not send the sign-in email. Check the address and try again.");
  }
  return { mode: "supabase", emailSent: true };
}

export async function getAuthenticatedAccount(): Promise<PreviewAccount | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabaseBrowserClient();
  const { data: sessionData, error: sessionError } = await withAuthTimeout(supabase.auth.getSession());
  if (sessionError || !sessionData.session) return null;

  const { data, error } = await withAuthTimeout(supabase.auth.getUser());
  if (error || !data.user?.email) return null;

  const displayName = typeof data.user.user_metadata?.display_name === "string"
    ? data.user.user_metadata.display_name.trim()
    : "";

  return {
    id: data.user.id,
    email: data.user.email,
    displayName: displayName || data.user.email.split("@")[0],
    createdAt: data.user.created_at,
    identityMode: "supabase",
  };
}

export async function signOutAuthenticatedAccount() {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

async function withAuthTimeout<T>(request: PromiseLike<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new AuthConnectionError()), AUTH_CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

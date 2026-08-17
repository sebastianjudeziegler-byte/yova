"use client";

import type { PreviewAccount } from "@/lib/domain";
import {
  normalizeAuthEmail,
  normalizeDisplayName,
  validateAuthEmail,
  validateDisplayName,
  validatePassword,
} from "@/lib/auth/password";
import { isCompleteEmailVerificationCode, normalizeEmailVerificationCode } from "@/lib/auth/verification-code";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type EmailAuthRequest = {
  email: string;
  displayName: string;
  shouldCreateUser: boolean;
  captchaToken?: string;
};

export type EmailAuthResult =
  | { mode: "preview" }
  | { mode: "supabase"; emailSent: true };

const AUTH_CHECK_TIMEOUT_MS = 8_000;

export type PasswordAccountRequest = {
  email: string;
  password: string;
  displayName: string;
  captchaToken?: string;
  termsAccepted: boolean;
};

export type PasswordAccountResult =
  | { verificationRequired: true }
  | { verificationRequired: false; account: PreviewAccount };

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
  captchaToken,
}: EmailAuthRequest): Promise<EmailAuthResult> {
  if (!isSupabaseConfigured()) return { mode: "preview" };

  const supabase = createSupabaseBrowserClient();
  const callbackUrl = new URL("/auth/callback", window.location.origin);
  callbackUrl.searchParams.set("next", "/");

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeAuthEmail(email),
    options: {
      shouldCreateUser,
      emailRedirectTo: callbackUrl.toString(),
      data: shouldCreateUser ? { display_name: normalizeDisplayName(displayName) } : undefined,
      captchaToken,
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

export async function createPasswordAccount({
  email,
  password,
  displayName,
  captchaToken,
  termsAccepted,
}: PasswordAccountRequest): Promise<PasswordAccountResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Password accounts are unavailable until YOVA's cloud account service is connected.");
  }

  const emailIssue = validateAuthEmail(email);
  if (emailIssue) throw new Error(emailIssue);
  const displayNameIssue = validateDisplayName(displayName);
  if (displayNameIssue) throw new Error(displayNameIssue);
  const passwordIssue = validatePassword(password);
  if (passwordIssue) throw new Error(passwordIssue);
  if (!termsAccepted) {
    throw new Error("Confirm the age and account terms before creating an account.");
  }

  const supabase = createSupabaseBrowserClient();
  const confirmationUrl = new URL("/auth/confirm", window.location.origin);
  const { data, error } = await withAuthTimeout(supabase.auth.signUp({
    email: normalizeAuthEmail(email),
    password,
    options: {
      data: {
        display_name: normalizeDisplayName(displayName),
        terms_version: "2026-08-16",
        terms_accepted_at: new Date().toISOString(),
        age_confirmation: "13_or_guardian_permission",
      },
      emailRedirectTo: confirmationUrl.toString(),
      captchaToken,
    },
  }));

  if (error) throw passwordAuthError(error, "signup");

  if (data.session) {
    const account = previewAccountFromUser(data.user);
    if (!account) throw new Error("YOVA created the account but could not finish opening it. Try signing in.");
    return { verificationRequired: false, account };
  }

  return { verificationRequired: true };
}

export async function signInWithPasswordAuthentication(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<PreviewAccount> {
  if (!isSupabaseConfigured()) {
    throw new Error("Password sign-in is unavailable until YOVA's cloud account service is connected.");
  }

  const emailIssue = validateAuthEmail(email);
  if (emailIssue) throw new Error(emailIssue);
  if (!password) throw new Error("Enter your password.");

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await withAuthTimeout(supabase.auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
    options: { captchaToken },
  }));

  if (error) throw passwordAuthError(error, "signin");
  const account = previewAccountFromUser(data.user);
  if (!account) throw new Error("YOVA signed in but could not open the account. Try again.");
  return account;
}

export async function requestPasswordResetEmail(email: string, captchaToken?: string) {
  if (!isSupabaseConfigured()) {
    throw new Error("Password reset is unavailable until YOVA's cloud account service is connected.");
  }

  const emailIssue = validateAuthEmail(email);
  if (emailIssue) throw new Error(emailIssue);

  const supabase = createSupabaseBrowserClient();
  const resetUrl = new URL("/auth/set-password", window.location.origin);
  const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(
    normalizeAuthEmail(email),
    {
      redirectTo: resetUrl.toString(),
      captchaToken,
    },
  ));

  // Supabase deliberately avoids revealing whether the address belongs to an
  // account. Preserve that behavior while still reporting delivery failures.
  if (error && error.code !== "user_not_found") throw passwordAuthError(error, "reset");
}

export async function resendPasswordAccountVerification(email: string, captchaToken?: string) {
  if (!isSupabaseConfigured()) {
    throw new Error("Email verification is unavailable until YOVA's cloud account service is connected.");
  }

  const emailIssue = validateAuthEmail(email);
  if (emailIssue) throw new Error(emailIssue);

  const supabase = createSupabaseBrowserClient();
  const confirmationUrl = new URL("/auth/confirm", window.location.origin);
  const { error } = await withAuthTimeout(supabase.auth.resend({
    type: "signup",
    email: normalizeAuthEmail(email),
    options: {
      emailRedirectTo: confirmationUrl.toString(),
      captchaToken,
    },
  }));

  if (error) throw passwordAuthError(error, "resend");
}

export async function updateAuthenticatedPassword(password: string) {
  if (!isSupabaseConfigured()) {
    throw new Error("Password updates are unavailable until YOVA's cloud account service is connected.");
  }

  const passwordIssue = validatePassword(password);
  if (passwordIssue) throw new Error(passwordIssue);

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await withAuthTimeout(supabase.auth.updateUser({ password }));
  if (error) throw passwordAuthError(error, "update");

  const account = previewAccountFromUser(data.user);
  if (!account) throw new Error("YOVA updated the password but could not reopen the account. Sign in again.");
  return account;
}

export async function getAuthenticatedAccount(): Promise<PreviewAccount | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabaseBrowserClient();
  const { data: sessionData, error: sessionError } = await withAuthTimeout(supabase.auth.getSession());
  if (sessionError) throw new AuthConnectionError();
  if (!sessionData.session) return null;

  const { data, error } = await withAuthTimeout(supabase.auth.getUser());
  if (error) throw new AuthConnectionError();
  const account = previewAccountFromUser(data.user);
  if (!account) throw new AuthConnectionError();
  return account;
}

export async function verifyEmailAuthenticationCode(email: string, code: string): Promise<PreviewAccount> {
  if (!isSupabaseConfigured()) throw new Error("Email verification is unavailable until YOVA's cloud account service is connected.");

  const normalizedCode = normalizeEmailVerificationCode(code);
  if (!isCompleteEmailVerificationCode(normalizedCode)) {
    throw new Error("Enter the complete 6-digit code from the newest YOVA email.");
  }

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await withAuthTimeout(supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: normalizedCode,
    type: "email",
  }));

  if (error) {
    throw new Error("That code is incorrect or expired. Check the newest YOVA email and try again.");
  }

  const account = previewAccountFromUser(data.user);
  if (!account) throw new Error("YOVA verified the code but could not finish opening the account. Try again.");
  return account;
}

export async function signOutAuthenticatedAccount() {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();

  try {
    const { error } = await withAuthTimeout(supabase.auth.signOut({ scope: "local" }));
    if (!error) return;
  } catch {
    // Check the browser session below. Some provider failures still remove it.
  }

  // auth-js removes its browser session after some remote logout failures.
  // If that already happened, the requested current-device sign-out succeeded
  // locally and the app should close the authenticated UI. Otherwise leave the
  // screen and all recovery state intact so the learner can retry safely.
  try {
    const { data, error } = await withAuthTimeout(supabase.auth.getSession());
    if (!error && !data.session) return;
  } catch {
    // The account state is unconfirmed, so preserving the current UI is safer.
  }

  throw new Error("YOVA could not confirm sign-out on this device. Check your connection and try again.");
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

function previewAccountFromUser(user: {
  id: string;
  email?: string;
  created_at: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, unknown>;
} | null): PreviewAccount | null {
  if (!user?.email) return null;

  const displayName = typeof user.user_metadata?.display_name === "string"
    ? user.user_metadata.display_name.trim()
    : "";

  return {
    id: user.id,
    email: user.email,
    displayName: displayName || user.email.split("@")[0],
    createdAt: user.created_at,
    identityMode: "supabase",
    emailVerified: Boolean(user.email_confirmed_at),
  };
}

type AuthFailure = {
  code?: string;
  message?: string;
  status?: number;
};

function passwordAuthError(error: AuthFailure, action: "signup" | "signin" | "reset" | "resend" | "update") {
  const code = error.code ?? "";

  if (isRateLimited(error)) {
    return new Error("Too many attempts were made. Wait a minute, then try again.");
  }

  if (isCaptchaFailure(error)) {
    return new Error("Complete the security check, then try again.");
  }

  if (action === "signin") {
    if (code === "email_not_confirmed") {
      return new Error("Confirm your email before signing in. Open the newest YOVA email or send a fresh one.");
    }
    if (code === "weak_password") {
      return new Error("This password is no longer considered secure. Reset it to continue.");
    }
    return new Error("Email or password is incorrect.");
  }

  if (code === "weak_password") {
    return new Error("Choose a longer password that has not appeared in a known data leak.");
  }

  if (code === "signup_disabled") {
    return new Error("New account creation is not open yet. Try again later.");
  }

  if (action === "resend") {
    return new Error("YOVA could not send a new verification email. Check the address and try again.");
  }

  if (action === "reset") {
    return new Error("YOVA could not send the reset email right now. Wait a moment and try again.");
  }

  if (action === "update") {
    return new Error("YOVA could not update the password. Request a fresh reset email and try again.");
  }

  return new Error("YOVA could not create the account. Check the details and try again.");
}

function isRateLimited(error: AuthFailure) {
  const message = error.message?.toLowerCase() ?? "";
  return error.status === 429
    || error.code === "over_email_send_rate_limit"
    || error.code === "over_request_rate_limit"
    || message.includes("rate limit");
}

function isCaptchaFailure(error: AuthFailure) {
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "captcha_failed" || message.includes("captcha");
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  resend: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.configured,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
      signInWithOtp: mocks.signInWithOtp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      resend: mocks.resend,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
      getSession: mocks.getSession,
      getUser: mocks.getUser,
    },
  }),
}));

import {
  AuthConnectionError,
  createPasswordAccount,
  getAuthenticatedAccount,
  requestEmailAuthentication,
  requestPasswordResetEmail,
  resendPasswordAccountVerification,
  signInWithPasswordAuthentication,
  signOutAuthenticatedAccount,
  updateAuthenticatedPassword,
} from "@/lib/auth/client";

const user = {
  id: "user-1",
  email: "learner@example.com",
  created_at: "2026-08-16T12:00:00.000Z",
  email_confirmed_at: "2026-08-16T12:01:00.000Z",
  user_metadata: { display_name: "Ada" },
};

describe("browser password authentication", () => {
  beforeEach(() => {
    mocks.configured = true;
    for (const mock of [
      mocks.signUp,
      mocks.signInWithPassword,
      mocks.signInWithOtp,
      mocks.resetPasswordForEmail,
      mocks.resend,
      mocks.updateUser,
      mocks.signOut,
      mocks.getSession,
      mocks.getUser,
    ]) mock.mockReset();
    vi.stubGlobal("window", { location: { origin: "https://yova.example" } });
  });

  it("creates a bounded account and waits for email confirmation", async () => {
    mocks.signUp.mockResolvedValue({ data: { user, session: null }, error: null });

    const result = await createPasswordAccount({
      email: "  Learner@Example.com ",
      password: "a-safe-long-password",
      displayName: "  Ada   Lovelace ",
      captchaToken: "captcha-signup",
      termsAccepted: true,
    });

    expect(result).toEqual({ verificationRequired: true });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "a-safe-long-password",
      options: {
        data: {
          display_name: "Ada Lovelace",
          terms_version: "2026-08-16",
          terms_accepted_at: expect.any(String),
          age_confirmation: "13_or_guardian_permission",
        },
        emailRedirectTo: "https://yova.example/auth/confirm",
        captchaToken: "captcha-signup",
      },
    });
  });

  it("does not send signup before the learner accepts the age and account terms", async () => {
    await expect(createPasswordAccount({
      email: "learner@example.com",
      password: "a-safe-long-password",
      displayName: "Ada",
      termsAccepted: false,
    })).rejects.toThrow("Confirm the age and account terms");

    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("restores an account after password sign-in without exposing provider errors", async () => {
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user, session: {} }, error: null });

    await expect(signInWithPasswordAuthentication(
      "Learner@Example.com",
      "a-safe-long-password",
      "captcha-signin",
    )).resolves.toMatchObject({ id: "user-1", displayName: "Ada", emailVerified: true });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "a-safe-long-password",
      options: { captchaToken: "captcha-signin" },
    });

    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "invalid_credentials", message: "provider-specific detail", status: 400 },
    });
    await expect(signInWithPasswordAuthentication(
      "learner@example.com",
      "wrong-password",
    )).rejects.toThrow("Email or password is incorrect.");
  });

  it("returns null only when the browser genuinely has no session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(getAuthenticatedAccount()).resolves.toBeNull();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("maps provider email confirmation without guessing from a local session", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
      error: null,
    });
    mocks.getUser.mockResolvedValue({
      data: { user: { ...user, email_confirmed_at: undefined } },
      error: null,
    });

    await expect(getAuthenticatedAccount()).resolves.toMatchObject({
      id: "user-1",
      emailVerified: false,
    });
  });

  it("keeps a session lookup error distinct from a signed-out browser", async () => {
    mocks.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { code: "connection_error", message: "provider unavailable" },
    });

    await expect(getAuthenticatedAccount()).rejects.toBeInstanceOf(AuthConnectionError);
  });

  it("keeps a user lookup error distinct from a signed-out browser", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: { access_token: "token" } }, error: null });
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { code: "connection_error", message: "provider unavailable" },
    });

    await expect(getAuthenticatedAccount()).rejects.toBeInstanceOf(AuthConnectionError);
  });

  it("signs out only the current device and waits for provider confirmation", async () => {
    mocks.signOut.mockResolvedValue({ error: null });

    await expect(signOutAuthenticatedAccount()).resolves.toBeUndefined();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed account open without exposing provider errors", async () => {
    mocks.signOut.mockResolvedValue({
      error: { code: "provider_unavailable", message: "provider-specific detail" },
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "still-local" } },
      error: null,
    });

    await expect(signOutAuthenticatedAccount())
      .rejects.toThrow("YOVA could not confirm sign-out on this device. Check your connection and try again.");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.getSession).toHaveBeenCalledOnce();
  });

  it("accepts a local sign-out completed despite a remote logout error", async () => {
    mocks.signOut.mockResolvedValue({
      error: { code: "provider_unavailable", message: "remote logout failed" },
    });
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(signOutAuthenticatedAccount()).resolves.toBeUndefined();
    expect(mocks.getSession).toHaveBeenCalledOnce();
  });

  it("keeps password-reset success non-enumerating and sends the scanner-safe destination", async () => {
    mocks.resetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: { code: "user_not_found", message: "not found", status: 400 },
    });

    await expect(requestPasswordResetEmail("unknown@example.com", "captcha-reset")).resolves.toBeUndefined();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith(
      "unknown@example.com",
      {
        redirectTo: "https://yova.example/auth/set-password",
        captchaToken: "captcha-reset",
      },
    );

    mocks.resetPasswordForEmail.mockResolvedValueOnce({
      data: {},
      error: { code: "over_email_send_rate_limit", message: "rate limit", status: 429 },
    });
    await expect(requestPasswordResetEmail("learner@example.com"))
      .rejects.toThrow("Too many attempts were made.");
  });

  it("resends signup verification with CAPTCHA and safely updates a recovered password", async () => {
    mocks.resend.mockResolvedValue({ data: {}, error: null });
    mocks.updateUser.mockResolvedValue({ data: { user }, error: null });

    await resendPasswordAccountVerification("Learner@Example.com", "captcha-resend");
    expect(mocks.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "learner@example.com",
      options: {
        emailRedirectTo: "https://yova.example/auth/confirm",
        captchaToken: "captcha-resend",
      },
    });

    await expect(updateAuthenticatedPassword("a-new-safe-password"))
      .resolves.toMatchObject({ email: "learner@example.com" });
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "a-new-safe-password" });
  });

  it("passes fresh CAPTCHA tokens through invite-only email request and resend", async () => {
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    await requestEmailAuthentication({
      email: "Learner@Example.com",
      displayName: "Ada",
      shouldCreateUser: false,
      captchaToken: "captcha-invite-request",
    });
    await requestEmailAuthentication({
      email: "Learner@Example.com",
      displayName: "Ada",
      shouldCreateUser: false,
      captchaToken: "captcha-invite-resend",
    });

    expect(mocks.signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: "learner@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://yova.example/auth/callback?next=%2F",
        data: undefined,
        captchaToken: "captcha-invite-request",
      },
    });
    expect(mocks.signInWithOtp).toHaveBeenNthCalledWith(2, {
      email: "learner@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://yova.example/auth/callback?next=%2F",
        data: undefined,
        captchaToken: "captcha-invite-resend",
      },
    });
  });

  it("keeps no-site-key invite email authentication compatible", async () => {
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    await expect(requestEmailAuthentication({
      email: "Learner@Example.com",
      displayName: "Ada",
      shouldCreateUser: false,
    })).resolves.toEqual({ mode: "supabase", emailSent: true });

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "learner@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://yova.example/auth/callback?next=%2F",
        data: undefined,
        captchaToken: undefined,
      },
    });
  });
});

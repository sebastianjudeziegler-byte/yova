import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/turnstile-challenge", () => ({
  TurnstileChallenge: ({ siteKey }: { siteKey: string }) => `TURNSTILE:${siteKey}`,
}));
vi.mock("@/components/brand-mark", () => ({
  BrandMark: () => null,
}));
vi.mock("@/lib/auth/client", () => ({
  createPasswordAccount: vi.fn(),
  getAuthMode: () => "supabase",
  requestEmailAuthentication: vi.fn(),
  requestPasswordResetEmail: vi.fn(),
  resendPasswordAccountVerification: vi.fn(),
  signInWithPasswordAuthentication: vi.fn(),
  verifyEmailAuthenticationCode: vi.fn(),
}));
vi.mock("@/lib/auth/post-verification", () => ({
  verifyEmailCodeThenRestoreAccount: vi.fn(),
}));

import { AccountEntry } from "@/components/auth/account-entry";

const commonProps = {
  existingAccount: null,
  emailCodeVerificationEnabled: true,
  inviteOnly: false,
  passwordAccountsEnabled: true,
  turnstileSiteKey: "test-site-key",
  browserPreviewMode: false,
  onBack: vi.fn(),
  onContinue: vi.fn(),
  onModeChange: vi.fn(),
};

describe("public password account entry", () => {
  it("renders a password-manager-friendly create form with explicit consent", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry, {
      ...commonProps,
      mode: "create",
    }));

    expect(html).toContain("Create account");
    expect(html).toContain('autoComplete="given-name"');
    expect(html).toContain('autoComplete="email"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('name="age-and-terms"');
    expect(html).toContain("Alpha Terms");
  });

  it("renders password sign-in, recovery, and the email-code fallback", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry, {
      ...commonProps,
      mode: "sign-in",
    }));

    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Forgot password?");
    expect(html).toContain("Use an email code instead");
  });

  it("keeps invite-only entry passwordless but requires CAPTCHA when a site key is present", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry, {
      ...commonProps,
      mode: "sign-in",
      inviteOnly: true,
    }));

    expect(html).toContain("PRIVATE ALPHA ACCESS");
    expect(html).not.toContain('name="password"');
    expect(html).toContain("TURNSTILE:test-site-key");
    expect(html).toContain('disabled=""');
  });

  it("keeps no-site-key invite mode available without CAPTCHA", () => {
    const html = renderToStaticMarkup(createElement(AccountEntry, {
      ...commonProps,
      mode: "sign-in",
      inviteOnly: true,
      turnstileSiteKey: null,
    }));

    expect(html).toContain("PRIVATE ALPHA ACCESS");
    expect(html).toContain("Send sign-in code");
    expect(html).not.toContain("TURNSTILE:");
    expect(html).not.toContain('disabled=""');
  });
});

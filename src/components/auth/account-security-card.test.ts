import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSecurityCard } from "@/components/auth/account-security-card";

const account = {
  id: "user-1",
  email: "learner@example.com",
  displayName: "Ada",
  createdAt: "2026-08-17T12:00:00.000Z",
  identityMode: "supabase" as const,
  emailVerified: true,
};

describe("AccountSecurityCard", () => {
  it("shows verified account identity and the authenticated password route", () => {
    const html = renderToStaticMarkup(createElement(AccountSecurityCard, {
      account,
      passwordAccountsEnabled: true,
      signingOut: false,
      onDisplayNameChange: vi.fn(),
      onSignOut: vi.fn(),
    }));

    expect(html).toContain('aria-labelledby="account-security-title"');
    expect(html).toContain("learner@example.com");
    expect(html).toContain("Email verified");
    expect(html).toContain('href="/auth/set-password?source=account"');
    expect(html).toContain("Set or change password");
    expect(html).toContain("Sign out on this device");
  });

  it("does not promise password or verification controls in browser preview mode", () => {
    const html = renderToStaticMarkup(createElement(AccountSecurityCard, {
      account: { ...account, identityMode: "preview", emailVerified: undefined },
      passwordAccountsEnabled: true,
      signingOut: false,
      onDisplayNameChange: vi.fn(),
      onSignOut: vi.fn(),
    }));

    expect(html).toContain("Browser preview");
    expect(html).toContain("Password settings are available with a cloud account.");
    expect(html).not.toContain('/auth/set-password?source=account');
  });

  it("does not expose the account password route before the email is verified", () => {
    const html = renderToStaticMarkup(createElement(AccountSecurityCard, {
      account: { ...account, emailVerified: false },
      passwordAccountsEnabled: true,
      signingOut: false,
      onDisplayNameChange: vi.fn(),
      onSignOut: vi.fn(),
    }));

    expect(html).toContain("Email not verified");
    expect(html).toContain("Verify your email before setting or changing a password.");
    expect(html).not.toContain('/auth/set-password?source=account');
  });

  it("announces a pending sign-out and disables repeated account actions", () => {
    const html = renderToStaticMarkup(createElement(AccountSecurityCard, {
      account,
      passwordAccountsEnabled: true,
      signingOut: true,
      onDisplayNameChange: vi.fn(),
      onSignOut: vi.fn(),
    }));

    expect(html).toContain("Signing out…");
    expect(html).toContain('disabled=""');
  });
});

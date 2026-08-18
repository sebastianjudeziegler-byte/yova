import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AccountDataExportDialog,
  AccountSecurityCard,
  accountDataExportStateAfterAccountChange,
  type AccountDataExportUiState,
} from "@/components/auth/account-security-card";

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
      turnstileSiteKey: "turnstile-test-key",
      onPrepareDataExport: vi.fn(),
      onDisplayNameChange: vi.fn(),
      onSignOut: vi.fn(),
    }));

    expect(html).toContain('aria-labelledby="account-security-title"');
    expect(html).toContain("learner@example.com");
    expect(html).toContain("Email verified");
    expect(html).toContain('href="/auth/set-password?source=account"');
    expect(html).toContain("Set or change password");
    expect(html).toContain("Download my YOVA data");
    expect(html).toContain("Delete YOVA account");
    expect(html).toContain("Permanently remove this login identity");
    expect(html).toContain("may contain private study information");
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
    expect(html).toContain("Browser preview data");
    expect(html).toContain("does not create a cloud account archive");
    expect(html).toContain("stored only in this browser");
    expect(html).not.toContain("Download my YOVA data");
    expect(html).not.toContain("Delete YOVA account");
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
    expect(html).toContain("Verify your email before downloading private account and learning data.");
    expect(html).not.toContain("Download my YOVA data");
    expect(html).not.toContain("Delete YOVA account");
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

  it("renders an accessible confirmation with truthful scope and a safe first focus", () => {
    const html = renderDialog({ status: "confirm" });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="account-data-export-title"');
    expect(html).toContain("Save it only on a device you trust.");
    expect(html).toContain("sanitized service-usage counters");
    expect(html).toContain("not the original uploaded files");
    expect(html).toContain("separate public Study Profile report or waitlist record");
    expect(html).toContain("Downloading does not delete or change anything in YOVA.");
    expect(html).toContain('data-export-initial-focus="true"');
    expect(html).toContain("Cancel");
  });

  it("renders bounded reauthentication, code-entry, and pending states", () => {
    const reauth = renderDialog({ status: "reauth", issue: null }, { turnstileSiteKey: null });
    expect(reauth).toContain("Verify before downloading private data.");
    expect(reauth).toContain("learner@example.com");
    expect(reauth).toContain("Send verification code");

    const code = renderDialog({ status: "code", issue: "That code is incorrect or expired." }, {
      verificationCode: "123",
    });
    expect(code).toContain('autoComplete="one-time-code"');
    expect(code).toContain('inputMode="numeric"');
    expect(code).toContain('aria-invalid="true"');
    expect(code).toContain("Verify and download");
    expect(code).toContain("Send a new code");

    for (const [state, copy] of [
      [{ status: "sending-code" }, "Sending a verification code…"],
      [{ status: "verifying" }, "Verifying your code…"],
      [{ status: "preparing" }, "Preparing your download…"],
    ] as const) {
      const pending = renderDialog(state);
      expect(pending).toContain('aria-busy="true"');
      expect(pending).toContain('role="status"');
      expect(pending).toContain(copy);
      expect(pending).toContain("Stop waiting");
    }
  });

  it("renders a direct expiring signed link plus expired and bounded failure states", () => {
    const ready = renderDialog({
      status: "ready",
      value: {
        downloadUrl: "https://project.supabase.co/storage/v1/object/sign/account-exports/private-token",
        filename: "yova-data-2026-08-17T22-38-34Z.json",
        expiresAt: "2026-08-18T00:00:00.000Z",
      },
    });
    expect(ready).toContain('href="https://project.supabase.co/storage/v1/object/sign/account-exports/private-token"');
    expect(ready).toContain('download="yova-data-2026-08-17T22-38-34Z.json"');
    expect(ready).toContain('referrerPolicy="no-referrer"');
    expect(ready).toContain('dateTime="2026-08-18T00:00:00.000Z"');
    expect(ready).toContain("Nothing in YOVA was deleted or changed.");

    const expired = renderDialog({ status: "expired" });
    expect(expired).toContain("This private download link expired.");
    expect(expired).toContain("Prepare a new download");

    const failure = renderDialog({
      status: "failure",
      code: "too_large",
      issue: "This account is too large for the self-service download.",
    });
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Nothing in your YOVA account was changed.");
    expect(failure).toContain('href="/support"');
    expect(failure).not.toContain("Try again");

    const rateLimited = renderDialog({
      status: "failure",
      code: "rate_limited",
      issue: "YOVA limits how often private exports can be prepared. Wait before trying again.",
    });
    expect(rateLimited).toContain("Wait before trying again.");
    expect(rateLimited).toContain("Try again");
  });

  it("drops an account A ready link immediately when account B becomes current", () => {
    const readyForAccountA: AccountDataExportUiState = {
      status: "ready",
      value: {
        downloadUrl: "https://example.com/private-account-a-token",
        filename: "yova-data-2026-08-17T22-38-34Z.json",
        expiresAt: "2026-08-18T00:00:00.000Z",
      },
    };

    expect(accountDataExportStateAfterAccountChange("account-a", "account-a", readyForAccountA))
      .toBe(readyForAccountA);
    expect(accountDataExportStateAfterAccountChange("account-a", "account-b", readyForAccountA))
      .toEqual({ status: "closed" });
  });
});

function renderDialog(
  state: Exclude<AccountDataExportUiState, { status: "closed" }>,
  overrides: Partial<Parameters<typeof AccountDataExportDialog>[0]> = {},
) {
  return renderToStaticMarkup(createElement(AccountDataExportDialog, {
    account,
    state,
    verificationCode: "",
    turnstileSiteKey: null,
    captchaToken: null,
    challengeResetNonce: 0,
    onCaptchaTokenChange: vi.fn(),
    onVerificationCodeChange: vi.fn(),
    onCancel: vi.fn(),
    onPrepare: vi.fn(),
    onRequestCode: vi.fn(),
    onVerifyCode: vi.fn(),
    onRequestNewCode: vi.fn(),
    onDownload: vi.fn(),
    ...overrides,
  }));
}

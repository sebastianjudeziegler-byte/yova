import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestEmail: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({
  requestEmailAuthentication: mocks.requestEmail,
  verifyEmailAuthenticationCode: mocks.verifyCode,
}));

import {
  AccountDeletionError,
  deleteAuthenticatedYovaAccount,
  requestAccountDeletionVerification,
  verifyAccountDeletionCode,
} from "@/lib/account-deletion/client";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("account deletion client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.requestEmail.mockReset().mockResolvedValue({ mode: "supabase" });
    mocks.verifyCode.mockReset().mockResolvedValue({ id: USER_ID });
  });

  it("sends only the fixed confirmation and current account id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await deleteAuthenticatedYovaAccount(USER_ID);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/account");
    expect(init).toMatchObject({ method: "DELETE", cache: "no-store", credentials: "same-origin" });
    expect(init?.headers).toMatchObject({ "X-Yova-Confirm": "delete-account", "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ accountId: USER_ID, confirmation: "DELETE" });
  });

  it("preserves bounded server error codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: "Verify again before deleting this account.",
      code: "reauth_required",
    }), { status: 403, headers: { "Content-Type": "application/json" } }));

    await expect(deleteAuthenticatedYovaAccount(USER_ID)).rejects.toMatchObject({
      name: "AccountDeletionError",
      code: "reauth_required",
    });
  });

  it("fails closed when code verification opens another account", async () => {
    mocks.verifyCode.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222" });

    await expect(verifyAccountDeletionCode(USER_ID, "learner@example.com", "123456"))
      .rejects.toBeInstanceOf(AccountDeletionError);
  });

  it("uses an existing-account email code request and never creates a user", async () => {
    await requestAccountDeletionVerification("Learner@Example.com", "captcha-token");

    expect(mocks.requestEmail).toHaveBeenCalledWith({
      email: "Learner@Example.com",
      displayName: "",
      shouldCreateUser: false,
      captchaToken: "captcha-token",
    });
  });
});

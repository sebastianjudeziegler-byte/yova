import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authenticateAccountExportFinalize,
  authenticateAccountExportStart,
  hasRecentHumanAmr,
} from "@/lib/account-export/auth";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = 2_000_000_000;

describe("account-export authentication", () => {
  it("accepts only detailed, recent human AMR entries", () => {
    expect(hasRecentHumanAmr([{ method: "otp", timestamp: NOW - 30 }], NOW)).toBe(true);
    expect(hasRecentHumanAmr([{ method: "sso/saml", timestamp: NOW }], NOW)).toBe(true);
    expect(hasRecentHumanAmr([{ method: "mfa/totp", timestamp: NOW }], NOW)).toBe(true);
    expect(hasRecentHumanAmr([{ method: "mfa/phone", timestamp: NOW }], NOW)).toBe(true);
    expect(hasRecentHumanAmr([{ method: "mfa/webauthn", timestamp: NOW }], NOW)).toBe(true);
    expect(hasRecentHumanAmr([{ method: "web3", timestamp: NOW }], NOW)).toBe(true);
    expect(hasRecentHumanAmr(["otp"], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "email", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "webauthn", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "oauth_provider/authorization_code", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "recovery", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "invite", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "token_refresh", timestamp: NOW }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "otp", timestamp: NOW - 601 }], NOW)).toBe(false);
    expect(hasRecentHumanAmr([{ method: "otp", timestamp: NOW + 61 }], NOW)).toBe(false);
  });

  it("requires a confirmed user, matching claims, session id, and fresh AMR to start", async () => {
    const client = authClient({ amr: [{ method: "password", timestamp: NOW - 10 }] });
    await expect(authenticateAccountExportStart(client as never, NOW)).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({ sessionId: SESSION_ID }),
    });

    const unverified = authClient(
      { amr: [{ method: "password", timestamp: NOW }] },
      { email_confirmed_at: null },
    );
    await expect(authenticateAccountExportStart(unverified as never, NOW)).resolves.toEqual({
      ok: false,
      reason: "unverified_email",
    });

    const wrongAccount = authClient({
      sub: "33333333-3333-4333-8333-333333333333",
      amr: [{ method: "password", timestamp: NOW }],
    });
    await expect(authenticateAccountExportStart(wrongAccount as never, NOW)).resolves.toEqual({
      ok: false,
      reason: "reauth_required",
    });
  });

  it("lets a valid same-account session finish without treating JWT iat as fresh auth", async () => {
    const client = authClient({
      iat: NOW,
      amr: [{ method: "token_refresh", timestamp: NOW }],
    });
    await expect(authenticateAccountExportFinalize(client as never)).resolves.toEqual({
      ok: true,
      context: expect.objectContaining({ sessionId: SESSION_ID }),
    });
  });
});

function authClient(
  claims: Record<string, unknown>,
  userOverrides: Record<string, unknown> = {},
) {
  const user = {
    id: USER_ID,
    email: "person@example.com",
    email_confirmed_at: "2026-08-17T00:00:00.000Z",
    ...userOverrides,
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      getClaims: vi.fn().mockResolvedValue({
        data: {
          claims: {
            sub: USER_ID,
            session_id: SESSION_ID,
            is_anonymous: false,
            ...claims,
          },
        },
        error: null,
      }),
    },
  };
}

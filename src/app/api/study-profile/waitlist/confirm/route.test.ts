import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  confirmWaitlist: vi.fn(),
  confirmWaitlistForReport: vi.fn(),
  hashToken: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileWaitlistConfirmationRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "confirm-route-test",
}));

vi.mock("@/lib/study-profile/repository", () => {
  class StudyProfilePersistenceUnavailableError extends Error {}
  return {
    StudyProfilePersistenceUnavailableError,
    hashStudyProfileReportToken: mocks.hashToken,
    getStudyProfileRepository: () => ({
      confirmWaitlist: mocks.confirmWaitlist,
      confirmWaitlistForReport: mocks.confirmWaitlistForReport,
    }),
  };
});

import { POST } from "@/app/api/study-profile/waitlist/confirm/route";

const rawConfirmationToken = "a".repeat(43);
const reportToken = "r".repeat(43);
const tokenHash = "b".repeat(64);
const responseId = "11111111-1111-4111-8111-111111111111";

describe("Study Profile waitlist confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.hashToken.mockReturnValue(tokenHash);
    mocks.confirmWaitlist.mockResolvedValue({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
      metaConversionEligible: true,
    });
    mocks.confirmWaitlistForReport.mockResolvedValue({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
      metaRegistrationEligible: true,
      reportUnlocked: true,
      responseId,
      under18: false,
    });
  });

  it("confirms a landing signup without returning its raw credential", async () => {
    const response = await POST(confirmationRequest({ token: rawConfirmationToken }));

    expect(response.status).toBe(200);
    expectPrivateConfirmationHeaders(response);
    const payload = await response.json();
    expect(payload).toEqual({
      waitlistJoined: true,
      metaConversionEligible: true,
    });
    expect(JSON.stringify(payload)).not.toContain(rawConfirmationToken);
    expect(mocks.hashToken).toHaveBeenCalledWith(rawConfirmationToken);
    expect(mocks.confirmWaitlist).toHaveBeenCalledWith(tokenHash);
    expect(mocks.confirmWaitlistForReport).not.toHaveBeenCalled();
  });

  it("rejects a report-scoped token when the report credential is omitted", async () => {
    mocks.confirmWaitlist.mockResolvedValueOnce({
      status: "invalid",
      waitlistJoined: false,
      newlyJoined: false,
      metaConversionEligible: false,
    });

    const response = await POST(confirmationRequest({ token: rawConfirmationToken }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "This confirmation link is invalid or has already been used.",
    });
    expect(mocks.confirmWaitlist).toHaveBeenCalledWith(tokenHash);
    expect(mocks.confirmWaitlistForReport).not.toHaveBeenCalled();
  });

  it("confirms a report-bound signup and returns only safe report handoff fields", async () => {
    const response = await POST(confirmationRequest({
      token: rawConfirmationToken,
      reportToken,
    }));

    expect(response.status).toBe(200);
    expectPrivateConfirmationHeaders(response);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      waitlistJoined: true,
      reportUnlocked: true,
      responseId,
      metaLeadEligible: true,
      metaRegistrationEligible: true,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "metaLeadEligible",
      "metaRegistrationEligible",
      "reportUnlocked",
      "reportUrl",
      "responseId",
      "waitlistJoined",
    ]);
    expect(new URL(String(payload.reportUrl), "https://www.yovaapp.com").pathname)
      .toBe(`/study-profile/report/${reportToken}`);
    expect(payload).not.toHaveProperty("token");
    expect(payload).not.toHaveProperty("reportToken");
    expect(JSON.stringify(payload)).not.toContain(rawConfirmationToken);
    expect(mocks.confirmWaitlistForReport).toHaveBeenCalledWith(tokenHash, reportToken);
    expect(mocks.confirmWaitlist).not.toHaveBeenCalled();
  });

  it("keeps both Meta eligibility signals false for an under-18 bound confirmation", async () => {
    mocks.confirmWaitlistForReport.mockResolvedValueOnce({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
      metaRegistrationEligible: false,
      reportUnlocked: true,
      responseId,
      under18: true,
    });

    const response = await POST(confirmationRequest({
      token: rawConfirmationToken,
      reportToken,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metaLeadEligible: false,
      metaRegistrationEligible: false,
      reportUnlocked: true,
    });
  });

  it("rejects malformed, unbound, and extra input before persistence", async () => {
    for (const body of [
      { token: "short" },
      { token: rawConfirmationToken, reportToken: "short" },
      { token: rawConfirmationToken, email: "student@example.com" },
      {},
    ]) {
      const response = await POST(confirmationRequest(body));
      expect(response.status).toBe(422);
    }
    expect(mocks.confirmWaitlist).not.toHaveBeenCalled();
    expect(mocks.confirmWaitlistForReport).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", 410],
    ["invalid", 404],
    ["mismatch", 404],
  ] as const)("does not leak handoff data for a %s report binding", async (status, expectedStatus) => {
    mocks.confirmWaitlistForReport.mockResolvedValueOnce({
      status,
      waitlistJoined: false,
      newlyJoined: false,
      metaRegistrationEligible: false,
      reportUnlocked: false,
      responseId: null,
      under18: null,
    });

    const response = await POST(confirmationRequest({
      token: rawConfirmationToken,
      reportToken,
    }));
    const payload = await response.json();

    expect(response.status).toBe(expectedStatus);
    expect(payload).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(payload)).not.toContain(rawConfirmationToken);
    expect(JSON.stringify(payload)).not.toContain(reportToken);
    expect(JSON.stringify(payload)).not.toContain(responseId);
  });
});

function confirmationRequest(body: unknown) {
  return new Request("https://www.yovaapp.com/api/study-profile/waitlist/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.yovaapp.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function expectPrivateConfirmationHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag"))
    .toBe("noindex, nofollow, noarchive, nosnippet");
}

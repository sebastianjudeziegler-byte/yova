import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  confirmWaitlist: vi.fn(),
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
    }),
  };
});

import { POST } from "@/app/api/study-profile/waitlist/confirm/route";

const rawToken = "a".repeat(43);
const tokenHash = "b".repeat(64);

describe("Study Profile waitlist confirmation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.hashToken.mockReturnValue(tokenHash);
    mocks.confirmWaitlist.mockResolvedValue({
      status: "confirmed",
      waitlistJoined: true,
      newlyJoined: true,
    });
  });

  it("confirms only by POST and never returns the raw token", async () => {
    const response = await POST(confirmationRequest({ token: rawToken }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag"))
      .toBe("noindex, nofollow, noarchive, nosnippet");
    const payload = await response.json();
    expect(payload).toEqual({ waitlistJoined: true });
    expect(JSON.stringify(payload)).not.toContain(rawToken);
    expect(mocks.hashToken).toHaveBeenCalledWith(rawToken);
    expect(mocks.confirmWaitlist).toHaveBeenCalledWith(tokenHash);
  });

  it("rejects malformed and extra input before persistence", async () => {
    for (const body of [
      { token: "short" },
      { token: rawToken, email: "student@example.com" },
      {},
    ]) {
      const response = await POST(confirmationRequest(body));
      expect(response.status).toBe(422);
    }
    expect(mocks.confirmWaitlist).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", 410],
    ["invalid", 404],
  ] as const)("returns a safe %s link response", async (status, expectedStatus) => {
    mocks.confirmWaitlist.mockResolvedValueOnce({
      status,
      waitlistJoined: false,
      newlyJoined: false,
    });

    const response = await POST(confirmationRequest({ token: rawToken }));
    expect(response.status).toBe(expectedStatus);
    expect(JSON.stringify(await response.json())).not.toContain(rawToken);
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

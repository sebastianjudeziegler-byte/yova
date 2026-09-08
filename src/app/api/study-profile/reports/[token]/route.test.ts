import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getReportByToken: vi.fn(),
  toPublicStoredResponse: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/study-profile", () => ({
  StudyProfileReportTokenSchema: {
    safeParse: (value: unknown) => (
      typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
        ? { success: true, data: value }
        : { success: false, error: new Error("invalid report token") }
    ),
  },
  toStudyProfilePublicStoredResponse: mocks.toPublicStoredResponse,
}));

vi.mock("@/lib/study-profile/repository", () => {
  class StudyProfilePersistenceUnavailableError extends Error {}
  return {
    StudyProfilePersistenceUnavailableError,
    getStudyProfileRepository: () => ({
      getReportByToken: mocks.getReportByToken,
    }),
  };
});

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileReportRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "report-route-test",
}));

import { GET } from "@/app/api/study-profile/reports/[token]/route";

const reportToken = "r".repeat(43);
const privateEmail = "student@example.com";
const report = {
  pattern: {
    name: "The Deep Diver",
    tell: "private-result-copy-that-must-stay-locked",
  },
};
const storedResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  reportToken,
  email: privateEmail,
  rawAnswers: { q1: "private-answer" },
};

describe("Study Profile report route waitlist gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.toPublicStoredResponse.mockReturnValue({
      id: storedResponse.id,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("returns 403 without report or response data while confirmation is pending", async () => {
    mocks.getReportByToken.mockResolvedValueOnce({
      storedResponse,
      report,
      waitlistJoined: false,
      confirmationPending: true,
    });

    const response = await GET(reportRequest(), reportContext());
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      error: "Confirm the email connected to this Study Profile before opening the report.",
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(reportToken);
    expect(serialized).not.toContain(privateEmail);
    expect(serialized).not.toContain(report.pattern.name);
    expect(serialized).not.toContain(report.pattern.tell);
    expect(serialized).not.toContain("private-answer");
    expect(mocks.toPublicStoredResponse).not.toHaveBeenCalled();
  });

  it("returns the public report payload after the bound confirmation succeeds", async () => {
    mocks.getReportByToken.mockResolvedValueOnce({
      storedResponse,
      report,
      waitlistJoined: true,
      confirmationPending: false,
    });

    const response = await GET(reportRequest(), reportContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      storedResponse: {
        id: storedResponse.id,
        createdAt: "2026-09-08T00:00:00.000Z",
      },
      report,
      waitlistJoined: true,
      confirmationPending: false,
    });
    expect(mocks.getReportByToken).toHaveBeenCalledWith(reportToken);
    expect(mocks.toPublicStoredResponse).toHaveBeenCalledWith(storedResponse);
  });
});

function reportRequest() {
  return new Request(`https://www.yovaapp.com/api/study-profile/reports/${reportToken}`);
}

function reportContext() {
  return { params: Promise.resolve({ token: reportToken }) };
}

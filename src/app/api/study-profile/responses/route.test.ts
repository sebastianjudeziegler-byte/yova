import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  saveResponse: vi.fn(),
  requestWaitlistConfirmation: vi.fn(),
  deliverConfirmation: vi.fn(),
  reserveReportEmailDelivery: vi.fn(),
  markEmailDelivery: vi.fn(),
  sendReportEmail: vi.fn(),
}));

const requestData = {
  email: "student@example.com",
  visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
  ageConfirmed: true,
  answers: Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, "a"]),
  ),
  metadata: {
    energyWindow: "morning",
    schoolLevel: "college",
    studyGoal: "upcoming_exams",
    hardestPart: null,
  },
  marketingConsent: false,
  waitlistConsent: true,
};

const report = {
  pattern: { name: "The All-Rounder", tell: "Your habits are balanced." },
  whyThisIsHappening: { body: "No single habit dominates your answers." },
  playbook: {
    methods: [
      { name: "Retrieval practice", tonightVersion: "Try five questions." },
      { name: "Spaced retrieval" },
      { name: "Timeboxing" },
    ],
    nextSession: { title: "A short study session" },
  },
};

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => "https://www.yovaapp.com",
}));

vi.mock("@/lib/study-profile", () => ({
  scoreStudyProfile: () => ({ scoringRevision: "study_profile_scoring_v2" }),
  buildStudyProfileReport: () => report,
  toStudyProfilePublicStoredResponse: () => ({ id: "response-id" }),
}));

vi.mock("@/lib/study-profile/api-schema", () => ({
  StudyProfileResponseRequestSchema: {
    safeParse: () => ({ success: true, data: requestData }),
  },
}));

vi.mock("@/lib/study-profile/email", () => ({
  sendStudyProfileReportEmail: mocks.sendReportEmail,
}));

vi.mock("@/lib/study-profile/request-security", () => ({
  STUDY_PROFILE_RESPONSE_MAX_BYTES: 32_768,
  validateStudyProfileJsonPostRequest: () => ({ ok: true }),
  readStudyProfileBoundedJson: () => Promise.resolve({ ok: true, value: requestData }),
}));

vi.mock("@/lib/study-profile/repository", () => {
  class StudyProfilePersistenceUnavailableError extends Error {}
  class StudyProfileCommittedWriteError extends Error {
    reportToken = "r".repeat(43);
  }
  class StudyProfileSaveOutcomeUnknownError extends Error {
    reportToken = "r".repeat(43);
  }
  return {
    StudyProfilePersistenceUnavailableError,
    StudyProfileCommittedWriteError,
    StudyProfileSaveOutcomeUnknownError,
    generateStudyProfileReportToken: () => "c".repeat(43),
    hashStudyProfileReportToken: () => "h".repeat(64),
    getStudyProfileRepository: () => ({
      saveResponse: mocks.saveResponse,
      requestWaitlistConfirmation: mocks.requestWaitlistConfirmation,
      reserveReportEmailDelivery: mocks.reserveReportEmailDelivery,
      markEmailDelivery: mocks.markEmailDelivery,
    }),
  };
});

vi.mock("@/lib/study-profile/waitlist-confirmation", () => ({
  deliverStudyProfileWaitlistConfirmation: mocks.deliverConfirmation,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileSubmissionRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "response-route-test",
}));

import { POST } from "@/app/api/study-profile/responses/route";

describe("Study Profile response waitlist gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveResponse.mockResolvedValue({
      storedResponse: {
        id: "response-id",
        reportToken: "r".repeat(43),
      },
      report,
    });
    mocks.requestWaitlistConfirmation.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: true,
      confirmationId: "11111111-1111-4111-8111-111111111111",
      email: "student@example.com",
      retryAfterSeconds: 0,
    });
    mocks.deliverConfirmation.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
    mocks.reserveReportEmailDelivery.mockResolvedValue({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 900,
    });
  });

  it("releases the report only after an accepted waitlist request", async () => {
    const response = await POST(responseRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      reportToken: "r".repeat(43),
      report,
      waitlistJoined: false,
      confirmationPending: true,
    });
    expect(mocks.deliverConfirmation).toHaveBeenCalledOnce();
    expect(mocks.reserveReportEmailDelivery).toHaveBeenCalledOnce();
  });

  it("keeps results locked when the recipient has reached the daily cap", async () => {
    mocks.deliverConfirmation.mockResolvedValueOnce({
      waitlistJoined: false,
      confirmationPending: false,
      dailyCapReached: true,
      retryAfterSeconds: 86_400,
    });

    const response = await POST(responseRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: "Your answers were saved, but YOVA could not finish the waitlist signup, so your results are still locked. Try again later.",
      code: "waitlist_signup_unavailable",
    });
    expect(body).not.toHaveProperty("reportToken");
    expect(body).not.toHaveProperty("report");
    expect(mocks.reserveReportEmailDelivery).not.toHaveBeenCalled();
  });

  it("reports a truthful locked state when confirmation delivery fails after save", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deliverConfirmation.mockRejectedValueOnce(new Error("provider rejected"));

    const response = await POST(responseRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("waitlist_signup_unavailable");
    expect(body).not.toHaveProperty("reportToken");
    expect(body).not.toHaveProperty("report");
    expect(mocks.reserveReportEmailDelivery).not.toHaveBeenCalled();
  });
});

function responseRequest() {
  return new Request("https://www.yovaapp.com/api/study-profile/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData),
  });
}

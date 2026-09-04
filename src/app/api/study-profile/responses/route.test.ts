import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  saveResponse: vi.fn(),
  requestWaitlistConfirmation: vi.fn(),
  queueConfirmation: vi.fn(),
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
  queueStudyProfileWaitlistConfirmationDelivery: mocks.queueConfirmation,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileSubmissionRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "response-route-test",
}));

import { POST } from "@/app/api/study-profile/responses/route";

describe("Study Profile response and optional waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestData.waitlistConsent = true;
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
    mocks.queueConfirmation.mockReturnValue(true);
    mocks.reserveReportEmailDelivery.mockResolvedValue({
      allowed: false,
      reason: "cooldown",
      retryAfterSeconds: 900,
    });
  });

  it("creates the report and requests confirmation after an explicit waitlist opt-in", async () => {
    mocks.reserveReportEmailDelivery.mockResolvedValueOnce({
      allowed: true,
      reason: null,
      retryAfterSeconds: 0,
    });
    mocks.sendReportEmail.mockResolvedValueOnce({
      status: "sent",
      provider: "resend",
      providerMessageId: "report-message-id",
    });

    const response = await POST(responseRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      reportToken: "r".repeat(43),
      report,
      emailDelivery: "sent",
      waitlistJoined: false,
      confirmationPending: true,
    });
    expect(mocks.sendReportEmail).toHaveBeenCalledOnce();
    expect(mocks.queueConfirmation).toHaveBeenCalledOnce();
    expect(mocks.reserveReportEmailDelivery).toHaveBeenCalledOnce();
    expect(mocks.sendReportEmail.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.requestWaitlistConfirmation.mock.invocationCallOrder[0]);
  });

  it("creates the report without requesting waitlist confirmation when the option is unchecked", async () => {
    requestData.waitlistConsent = false;

    const response = await POST(responseRequest());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      reportToken: "r".repeat(43),
      report,
      waitlistJoined: false,
      confirmationPending: false,
    });
    expect(mocks.requestWaitlistConfirmation).not.toHaveBeenCalled();
    expect(mocks.queueConfirmation).not.toHaveBeenCalled();
    expect(mocks.reserveReportEmailDelivery).toHaveBeenCalledOnce();
  });

  it("does not lock the report when the waitlist recipient reaches the daily cap", async () => {
    mocks.requestWaitlistConfirmation.mockResolvedValueOnce({
      waitlistJoined: false,
      confirmationPending: false,
      dailyCapReached: true,
      shouldSend: false,
      confirmationId: null,
      email: null,
      retryAfterSeconds: 86_400,
    });

    const response = await POST(responseRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      reportToken: "r".repeat(43),
      report,
      waitlistJoined: false,
      confirmationPending: false,
      waitlistError:
        "YOVA could not complete the waitlist email step. Check your inbox, or try again from this report.",
    });
    expect(mocks.reserveReportEmailDelivery).toHaveBeenCalledOnce();
  });

  it("does not lock the report when confirmation delivery cannot be queued after save", async () => {
    mocks.queueConfirmation.mockReturnValueOnce(false);

    const response = await POST(responseRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      reportToken: "r".repeat(43),
      report,
      waitlistJoined: false,
      confirmationPending: false,
      waitlistError:
        "YOVA could not complete the waitlist email step. Check your inbox, or try again from this report.",
    });
    expect(mocks.reserveReportEmailDelivery).toHaveBeenCalledOnce();
  });
});

function responseRequest() {
  return new Request("https://www.yovaapp.com/api/study-profile/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData),
  });
}

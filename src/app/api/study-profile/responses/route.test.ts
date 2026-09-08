import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  saveResponse: vi.fn(),
  requestWaitlistConfirmation: vi.fn(),
  deliverConfirmation: vi.fn(),
  waitForPublicResponseFloor: vi.fn(),
  sendReportEmail: vi.fn(),
}));

const requestData = {
  email: "student@example.com",
  visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
  ageConfirmed: true,
  under18: false,
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
  waitlistConsent: true as boolean | undefined,
  attribution: {
    utmSource: "instagram",
    utmMedium: "paid_social",
    utmCampaign: "study_profile_quiz",
    utmContent: "static_v1",
    fbclid: "meta_click_123",
  },
};

const reportToken = "r".repeat(43);
const confirmationToken = "c".repeat(43);
const confirmationTokenHash = "h".repeat(64);
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

vi.mock("@/lib/study-profile", () => ({
  scoreStudyProfile: () => ({ scoringRevision: "study_profile_scoring_v2" }),
  buildStudyProfileReport: () => report,
}));

vi.mock("@/lib/study-profile/api-schema", () => ({
  StudyProfileResponseRequestSchema: {
    safeParse: (value: unknown) => {
      const candidate = value as { waitlistConsent?: unknown };
      return candidate.waitlistConsent === true
        ? { success: true, data: candidate }
        : { success: false, error: new Error("waitlist consent required") };
    },
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
    generateStudyProfileReportToken: () => confirmationToken,
    hashStudyProfileReportToken: () => confirmationTokenHash,
    getStudyProfileRepository: () => ({
      saveResponse: mocks.saveResponse,
      requestWaitlistConfirmation: mocks.requestWaitlistConfirmation,
    }),
  };
});

vi.mock("@/lib/study-profile/waitlist-confirmation", () => ({
  deliverStudyProfileWaitlistConfirmation: mocks.deliverConfirmation,
  waitForStudyProfileWaitlistPublicResponseFloor: mocks.waitForPublicResponseFloor,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileSubmissionRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "response-route-test",
}));

import { POST } from "@/app/api/study-profile/responses/route";

describe("Study Profile response confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestData.under18 = false;
    requestData.waitlistConsent = true;
    mocks.saveResponse.mockResolvedValue({
      storedResponse: {
        id: "11111111-1111-4111-8111-111111111111",
        reportToken,
      },
      report,
      under18: false,
    });
    mocks.requestWaitlistConfirmation.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      shouldSend: true,
      confirmationId: "22222222-2222-4222-8222-222222222222",
      email: "student@example.com",
      retryAfterSeconds: 0,
    });
    mocks.deliverConfirmation.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
    mocks.waitForPublicResponseFloor.mockResolvedValue(undefined);
  });

  it("sends the report-bound confirmation before returning only a pending receipt", async () => {
    const response = await POST(responseRequest());

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({ confirmationPending: true });
    expect(Object.keys(payload)).toEqual(["confirmationPending"]);
    expect(JSON.stringify(payload)).not.toContain(reportToken);
    expect(JSON.stringify(payload)).not.toContain("study-profile/report");
    expect(JSON.stringify(payload)).not.toContain(report.pattern.name);

    expect(mocks.requestWaitlistConfirmation).toHaveBeenCalledWith(
      reportToken,
      "email_gate",
      confirmationTokenHash,
      requestData.attribution,
    );
    expect(mocks.deliverConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        saveResponse: mocks.saveResponse,
        requestWaitlistConfirmation: mocks.requestWaitlistConfirmation,
      }),
      expect.objectContaining({ confirmationPending: true, shouldSend: true }),
      confirmationToken,
      reportToken,
    );
    expect(mocks.waitForPublicResponseFloor).toHaveBeenCalledOnce();
    expect(mocks.sendReportEmail).not.toHaveBeenCalled();
  });

  it("rejects a response when waitlist consent is omitted or refused", async () => {
    for (const waitlistConsent of [undefined, false]) {
      requestData.waitlistConsent = waitlistConsent;
      const response = await POST(responseRequest());

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "Complete all 14 questions, add a valid email, confirm your age, and agree to join the YOVA waitlist to get your report.",
      });
    }
    expect(mocks.saveResponse).not.toHaveBeenCalled();
    expect(mocks.deliverConfirmation).not.toHaveBeenCalled();
    expect(mocks.sendReportEmail).not.toHaveBeenCalled();
  });

  it("persists minor status without exposing ad eligibility or report state", async () => {
    requestData.under18 = true;

    const response = await POST(responseRequest());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ confirmationPending: true });
    expect(mocks.saveResponse).toHaveBeenCalledWith(
      expect.objectContaining({ under18: true }),
    );
  });

  it("withholds the report when the confirmation daily cap is reached", async () => {
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
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("86400");
    expect(JSON.stringify(payload)).not.toContain(reportToken);
    expect(JSON.stringify(payload)).not.toContain(report.pattern.name);
    expect(mocks.deliverConfirmation).not.toHaveBeenCalled();
    expect(mocks.sendReportEmail).not.toHaveBeenCalled();
  });

  it("withholds the report when synchronous confirmation delivery fails", async () => {
    mocks.deliverConfirmation.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await POST(responseRequest());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(JSON.stringify(payload)).not.toContain(reportToken);
    expect(JSON.stringify(payload)).not.toContain(report.pattern.name);
    expect(mocks.waitForPublicResponseFloor).toHaveBeenCalledOnce();
    expect(mocks.sendReportEmail).not.toHaveBeenCalled();
  });
});

function responseRequest() {
  return new Request("https://www.yovaapp.com/api/study-profile/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestData),
  });
}

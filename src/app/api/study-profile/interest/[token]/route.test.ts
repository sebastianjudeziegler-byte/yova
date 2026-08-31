import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  return {
    checkRateLimit: vi.fn(),
    requestConfirmation: vi.fn(),
    deliverConfirmation: vi.fn(),
    waitForFloor: vi.fn(),
  };
});

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileInterestRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "interest-route-test",
}));

vi.mock("@/lib/study-profile/repository", () => {
  class StudyProfilePersistenceUnavailableError extends Error {}
  return {
    StudyProfilePersistenceUnavailableError,
    generateStudyProfileReportToken: () => "a".repeat(43),
    hashStudyProfileReportToken: () => "b".repeat(64),
    getStudyProfileRepository: () => ({
      requestWaitlistConfirmation: mocks.requestConfirmation,
    }),
  };
});

vi.mock("@/lib/study-profile/waitlist-confirmation", () => ({
  StudyProfileWaitlistConfirmationDeliveryError: class extends Error {},
  deliverStudyProfileWaitlistConfirmation: mocks.deliverConfirmation,
  waitForStudyProfileWaitlistPublicResponseFloor: mocks.waitForFloor,
}));

import { POST } from "@/app/api/study-profile/interest/[token]/route";
import {
  StudyProfileWaitlistConfirmationDeliveryError,
} from "@/lib/study-profile/waitlist-confirmation";

const REPORT_TOKEN = "r".repeat(43);
const CONTEXT = { params: Promise.resolve({ token: REPORT_TOKEN }) };

describe("Study Profile report waitlist route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.waitForFloor.mockResolvedValue(undefined);
    mocks.requestConfirmation.mockResolvedValue({
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
  });

  it("awaits delivery after validating dynamic route params", async () => {
    const response = await POST(interestRequest({
      waitlist: true,
      ageConfirmed: true,
      source: "report_cta",
    }), CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.deliverConfirmation).toHaveBeenCalledOnce();
    expect(mocks.waitForFloor).toHaveBeenCalledOnce();
  });

  it("fails closed without a literal 13+ affirmation", async () => {
    const response = await POST(interestRequest({
      waitlist: true,
      source: "report_cta",
    }), CONTEXT);

    expect(response.status).toBe(422);
    expect(mocks.requestConfirmation).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", {
      waitlistJoined: false,
      confirmationPending: true,
      shouldSend: false,
      confirmationId: null,
      email: null,
      dailyCapReached: false,
      retryAfterSeconds: 900,
    }],
    ["daily cap", {
      waitlistJoined: false,
      confirmationPending: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      dailyCapReached: true,
      retryAfterSeconds: 86_400,
    }],
    ["shared membership", {
      waitlistJoined: false,
      confirmationPending: true,
      shouldSend: false,
      confirmationId: null,
      email: null,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    }],
  ])("masks the %s state with the same public receipt", async (_label, state) => {
    mocks.requestConfirmation.mockResolvedValueOnce(state);

    const response = await POST(interestRequest({
      waitlist: true,
      ageConfirmed: true,
      source: "report_cta",
    }), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(maskedPendingReceipt());
  });

  it("masks a provider delivery failure instead of exposing recipient state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.deliverConfirmation.mockRejectedValueOnce(
      new StudyProfileWaitlistConfirmationDeliveryError(),
    );

    const response = await POST(interestRequest({
      waitlist: true,
      ageConfirmed: true,
      source: "report_cta",
    }), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(maskedPendingReceipt());
    expect(consoleError).toHaveBeenCalledWith(
      "Study Profile report confirmation delivery failed.",
      "Error",
    );
  });

  it("exposes joined only for confirmation evidence scoped to this report", async () => {
    mocks.requestConfirmation.mockResolvedValueOnce({
      waitlistJoined: true,
      confirmationPending: false,
      shouldSend: false,
      confirmationId: null,
      email: null,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });

    const response = await POST(interestRequest({
      waitlist: true,
      ageConfirmed: true,
      source: "report_cta",
    }), CONTEXT);

    await expect(response.json()).resolves.toEqual({
      waitlistJoined: true,
      confirmationPending: false,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
  });
});

function interestRequest(body: unknown) {
  return new Request(`https://www.yovaapp.com/api/study-profile/interest/${REPORT_TOKEN}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.yovaapp.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function maskedPendingReceipt() {
  return {
    waitlistJoined: false,
    confirmationPending: true,
    dailyCapReached: false,
    retryAfterSeconds: 0,
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  requestWaitlistConfirmationByEmail: vi.fn(),
  deliverConfirmation: vi.fn(),
  waitForFloor: vi.fn(),
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkStudyProfileWaitlistRateLimit: mocks.checkRateLimit,
  requestRateLimitKey: () => "route-test",
}));

vi.mock("@/lib/study-profile/repository", () => {
  class StudyProfilePersistenceUnavailableError extends Error {
    constructor() {
      super("Study Profile persistence is not configured.");
      this.name = "StudyProfilePersistenceUnavailableError";
    }
  }

  return {
    StudyProfilePersistenceUnavailableError,
    generateStudyProfileReportToken: () => "a".repeat(43),
    hashStudyProfileReportToken: () => "b".repeat(64),
    getStudyProfileRepository: () => ({
      requestWaitlistConfirmationByEmail: mocks.requestWaitlistConfirmationByEmail,
    }),
  };
});

vi.mock("@/lib/study-profile/waitlist-confirmation", () => ({
  StudyProfileWaitlistConfirmationDeliveryError: class extends Error {},
  deliverStudyProfileWaitlistConfirmation: mocks.deliverConfirmation,
  waitForStudyProfileWaitlistPublicResponseFloor: mocks.waitForFloor,
}));

import { POST } from "@/app/api/study-profile/waitlist/route";
import {
  StudyProfilePersistenceUnavailableError,
} from "@/lib/study-profile/repository";
import {
  StudyProfileWaitlistConfirmationDeliveryError,
} from "@/lib/study-profile/waitlist-confirmation";

describe("Study Profile landing waitlist route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.waitForFloor.mockResolvedValue(undefined);
    mocks.requestWaitlistConfirmationByEmail.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      shouldSend: true,
      confirmationId: "11111111-1111-4111-8111-111111111111",
      email: "student@example.com",
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
    mocks.deliverConfirmation.mockResolvedValue({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
  });

  it("awaits bounded email delivery before returning the generic receipt", async () => {
    const response = await POST(waitlistRequest({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
    expect(mocks.deliverConfirmation).toHaveBeenCalledOnce();
    expect(mocks.waitForFloor).toHaveBeenCalledOnce();
  });

  it("normalizes and persists an explicitly consented signup", async () => {
    const response = await POST(waitlistRequest({
      email: "  Student@Example.COM ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
    expect(mocks.checkRateLimit.mock.calls).toEqual([
      ["ip:route-test"],
      ["email:student@example.com"],
    ]);
    expect(mocks.requestWaitlistConfirmationByEmail).toHaveBeenCalledOnce();
    expect(mocks.requestWaitlistConfirmationByEmail).toHaveBeenCalledWith({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      confirmationTokenHash: "b".repeat(64),
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    });
  });

  it.each([
    ["missing consent", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
    }],
    ["refused consent", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: false,
    }],
    ["invalid email", {
      email: "not-an-email",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
    }],
    ["invalid visitor", {
      email: "student@example.com",
      visitorId: "visitor-123",
      consent: true,
      ageConfirmed: true,
    }],
    ["missing age confirmation", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
    }],
  ])("returns 422 for %s", async (_label, body) => {
    const response = await POST(waitlistRequest(body));

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Add a valid email, confirm that you want to join, and confirm that you are 13 or older.",
    });
    expect(mocks.requestWaitlistConfirmationByEmail).not.toHaveBeenCalled();
  });

  it("returns a retryable service response when persistence is unavailable", async () => {
    mocks.requestWaitlistConfirmationByEmail.mockRejectedValueOnce(
      new StudyProfilePersistenceUnavailableError(),
    );

    const response = await POST(waitlistRequest({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Waitlist signup is temporarily unavailable.",
    });
  });

  it("masks a provider failure with the same generic accepted receipt", async () => {
    mocks.deliverConfirmation.mockRejectedValueOnce(
      new StudyProfileWaitlistConfirmationDeliveryError(),
    );

    const response = await POST(waitlistRequest({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    });
  });
});

function waitlistRequest(body: unknown) {
  return new Request("https://www.yovaapp.com/api/study-profile/waitlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.yovaapp.com",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

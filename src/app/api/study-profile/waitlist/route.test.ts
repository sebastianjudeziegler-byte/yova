import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  joinWaitlistByEmail: vi.fn(),
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
    getStudyProfileRepository: () => ({
      joinWaitlistByEmail: mocks.joinWaitlistByEmail,
    }),
  };
});

import { POST } from "@/app/api/study-profile/waitlist/route";
import {
  StudyProfilePersistenceUnavailableError,
} from "@/lib/study-profile/repository";

describe("Study Profile landing waitlist route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.joinWaitlistByEmail.mockResolvedValue({
      waitlistJoined: true,
      betaInterest: null,
    });
  });

  it("normalizes and persists an explicitly consented signup", async () => {
    const response = await POST(waitlistRequest({
      email: "  Student@Example.COM ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ waitlistJoined: true });
    expect(mocks.checkRateLimit.mock.calls).toEqual([
      ["ip:route-test"],
      ["email:student@example.com"],
    ]);
    expect(mocks.joinWaitlistByEmail).toHaveBeenCalledOnce();
    expect(mocks.joinWaitlistByEmail).toHaveBeenCalledWith({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
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
    }],
  ])("returns 422 for %s", async (_label, body) => {
    const response = await POST(waitlistRequest(body));

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Add a valid email and confirm that you want to join the waitlist.",
    });
    expect(mocks.joinWaitlistByEmail).not.toHaveBeenCalled();
  });

  it("returns a retryable service response when persistence is unavailable", async () => {
    mocks.joinWaitlistByEmail.mockRejectedValueOnce(
      new StudyProfilePersistenceUnavailableError(),
    );

    const response = await POST(waitlistRequest({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Waitlist signup is temporarily unavailable.",
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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  after: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => "https://www.yovaapp.com",
}));

vi.mock("@/lib/study-profile/email", () => ({
  STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS: 4_000,
  sendStudyProfileWaitlistConfirmationEmail: mocks.send,
}));

import {
  STUDY_PROFILE_WAITLIST_PUBLIC_RESPONSE_FLOOR_MS,
  StudyProfileWaitlistConfirmationDeliveryError,
  deliverStudyProfileWaitlistConfirmation,
  queueStudyProfileWaitlistConfirmationDelivery,
  waitForStudyProfileWaitlistPublicResponseFloor,
} from "@/lib/study-profile/waitlist-confirmation";
import type {
  StudyProfileRepository,
  StudyProfileWaitlistConfirmationRequestState,
} from "@/lib/study-profile/repository";

const pendingState: StudyProfileWaitlistConfirmationRequestState = {
  waitlistJoined: false,
  confirmationPending: true,
  dailyCapReached: false,
  shouldSend: true,
  confirmationId: "11111111-1111-4111-8111-111111111111",
  email: "student@example.com",
  retryAfterSeconds: 0,
};

describe("Study Profile waitlist confirmation delivery", () => {
  const markDelivery = vi.fn();
  const repository = {
    markWaitlistConfirmationDelivery: markDelivery,
  } as unknown as StudyProfileRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues provider delivery after the route response", async () => {
    let scheduled: (() => Promise<void>) | undefined;
    mocks.after.mockImplementationOnce((callback: () => Promise<void>) => {
      scheduled = callback;
    });
    mocks.send.mockResolvedValueOnce({
      status: "sent",
      provider: "resend",
      providerMessageId: "email_after_response",
    });

    expect(queueStudyProfileWaitlistConfirmationDelivery(
      repository,
      pendingState,
      "d".repeat(43),
    )).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();

    await scheduled?.();
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(markDelivery).toHaveBeenCalledWith(
      pendingState.confirmationId,
      "sent",
      "email_after_response",
    );
  });

  it("reports when after-response delivery cannot be scheduled", () => {
    mocks.after.mockImplementationOnce(() => {
      throw new Error("missing request context");
    });

    expect(queueStudyProfileWaitlistConfirmationDelivery(
      repository,
      pendingState,
      "e".repeat(43),
    )).toBe(false);
  });

  it("pads a public response beyond the provider timeout", async () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      const pending = waitForStudyProfileWaitlistPublicResponseFloor(startedAt);
      await vi.advanceTimersByTimeAsync(
        STUDY_PROFILE_WAITLIST_PUBLIC_RESPONSE_FLOOR_MS - 1,
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a provider-accepted message as sent", async () => {
    mocks.send.mockResolvedValueOnce({
      status: "sent",
      provider: "resend",
      providerMessageId: "email_123",
    });

    await expect(deliverStudyProfileWaitlistConfirmation(
      repository,
      pendingState,
      "a".repeat(43),
    )).resolves.toMatchObject({ confirmationPending: true });
    expect(markDelivery).toHaveBeenCalledWith(
      pendingState.confirmationId,
      "sent",
      "email_123",
    );
  });

  it("keeps the token pending after an ambiguous network failure", async () => {
    mocks.send.mockResolvedValueOnce({ status: "failed", reason: "network_error" });

    await expect(deliverStudyProfileWaitlistConfirmation(
      repository,
      pendingState,
      "b".repeat(43),
    )).rejects.toBeInstanceOf(StudyProfileWaitlistConfirmationDeliveryError);
    expect(markDelivery).not.toHaveBeenCalled();
  });

  it("invalidates a token after a definitive provider rejection", async () => {
    mocks.send.mockResolvedValueOnce({
      status: "failed",
      reason: "provider_error",
      providerStatus: 400,
    });

    await expect(deliverStudyProfileWaitlistConfirmation(
      repository,
      pendingState,
      "c".repeat(43),
    )).rejects.toBeInstanceOf(StudyProfileWaitlistConfirmationDeliveryError);
    expect(markDelivery).toHaveBeenCalledWith(
      pendingState.confirmationId,
      "failed",
    );
  });
});

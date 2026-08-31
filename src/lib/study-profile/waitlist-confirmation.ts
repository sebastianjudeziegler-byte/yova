import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import {
  STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS,
  sendStudyProfileWaitlistConfirmationEmail,
} from "@/lib/study-profile/email";
import type {
  StudyProfileRepository,
  StudyProfileWaitlistConfirmationRequestState,
} from "@/lib/study-profile/repository";

export type StudyProfileWaitlistPublicRequestState = {
  waitlistJoined: boolean;
  confirmationPending: boolean;
  dailyCapReached: boolean;
  retryAfterSeconds: number;
};

export const STUDY_PROFILE_WAITLIST_PUBLIC_RESPONSE_FLOOR_MS =
  STUDY_PROFILE_EMAIL_REQUEST_TIMEOUT_MS + 250;

export async function waitForStudyProfileWaitlistPublicResponseFloor(
  startedAtMs: number,
) {
  const remainingMs = Math.max(
    0,
    STUDY_PROFILE_WAITLIST_PUBLIC_RESPONSE_FLOOR_MS - (Date.now() - startedAtMs),
  );
  if (remainingMs === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
}

export class StudyProfileWaitlistConfirmationDeliveryError extends Error {
  constructor() {
    super("YOVA could not send the waitlist confirmation email.");
    this.name = "StudyProfileWaitlistConfirmationDeliveryError";
  }
}

export async function deliverStudyProfileWaitlistConfirmation(
  repository: StudyProfileRepository,
  state: StudyProfileWaitlistConfirmationRequestState,
  rawConfirmationToken: string,
): Promise<StudyProfileWaitlistPublicRequestState> {
  if (state.dailyCapReached) {
    return {
      waitlistJoined: false,
      confirmationPending: false,
      dailyCapReached: true,
      retryAfterSeconds: state.retryAfterSeconds,
    };
  }
  if (state.waitlistJoined) {
    return {
      waitlistJoined: true,
      confirmationPending: false,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    };
  }
  if (!state.confirmationPending) {
    throw new StudyProfileWaitlistConfirmationDeliveryError();
  }
  if (!state.shouldSend) {
    return {
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: state.retryAfterSeconds,
    };
  }
  if (!state.confirmationId || !state.email) {
    throw new StudyProfileWaitlistConfirmationDeliveryError();
  }

  const confirmationPage = new URL("/study-profile/waitlist/confirm", getSiteUrl());
  const confirmationUrl = `${confirmationPage.toString()}#token=${encodeURIComponent(rawConfirmationToken)}`;
  const delivery = await sendStudyProfileWaitlistConfirmationEmail({
    to: state.email,
    confirmationUrl,
    confirmationId: state.confirmationId,
  });

  if (delivery.status === "sent") {
    await repository.markWaitlistConfirmationDelivery(
      state.confirmationId,
      "sent",
      delivery.providerMessageId,
    );
    return {
      waitlistJoined: false,
      confirmationPending: true,
      dailyCapReached: false,
      retryAfterSeconds: 0,
    };
  }

  if (!(delivery.status === "failed" && delivery.reason === "network_error")) {
    try {
      await repository.markWaitlistConfirmationDelivery(state.confirmationId, "failed");
    } catch {
      // The request remains safe when bookkeeping is unavailable. The raw
      // token is not returned to the browser.
    }
  }
  // A network timeout is ambiguous: Resend may have accepted the message even
  // though this process did not receive the response. Leave that token pending
  // so a delivered email never contains a credential we invalidated locally.
  throw new StudyProfileWaitlistConfirmationDeliveryError();
}

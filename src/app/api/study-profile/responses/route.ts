import { NextResponse } from "next/server";
import {
  buildStudyProfileReport,
  scoreStudyProfile,
} from "@/lib/study-profile";
import { StudyProfileResponseRequestSchema } from "@/lib/study-profile/api-schema";
import {
  STUDY_PROFILE_RESPONSE_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfileCommittedWriteError,
  StudyProfilePersistenceUnavailableError,
  StudyProfileSaveOutcomeUnknownError,
  generateStudyProfileReportToken,
  getStudyProfileRepository,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import {
  deliverStudyProfileWaitlistConfirmation,
  waitForStudyProfileWaitlistPublicResponseFloor,
} from "@/lib/study-profile/waitlist-confirmation";
import {
  checkStudyProfileSubmissionRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestGuard = validateStudyProfileJsonPostRequest(request);
  if (!requestGuard.ok) return jsonError(requestGuard.message, requestGuard.status);

  const requestKey = requestRateLimitKey(request);
  const ipLimit = checkStudyProfileSubmissionRateLimit(`ip:${requestKey}`);
  if (!ipLimit.allowed) {
    return jsonError("Too many profiles were submitted at once. Wait a minute and try again.", 429, {
      "Retry-After": String(ipLimit.retryAfterSeconds),
    });
  }

  const body = await readStudyProfileBoundedJson(request, STUDY_PROFILE_RESPONSE_MAX_BYTES);
  if (!body.ok) {
    if (body.reason === "too_large") {
      return jsonError("That Study Profile response was too large.", 413);
    }
    return jsonError("That Study Profile response was not valid JSON.", 400);
  }

  const parsed = StudyProfileResponseRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError("Complete all 14 questions, add a valid email, confirm your age, and agree to join the YOVA waitlist to get your report.", 422);
  }

  const emailLimit = checkStudyProfileSubmissionRateLimit(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return jsonError("That address received several new reports. Wait a minute and try again.", 429, {
      "Retry-After": String(emailLimit.retryAfterSeconds),
    });
  }

  try {
    // Scores and report modules are always recomputed from validated answers on
    // the server. The API deliberately accepts no client-computed profile data.
    const snapshot = scoreStudyProfile(parsed.data.answers);
    const report = buildStudyProfileReport(snapshot, parsed.data.metadata, parsed.data.answers);
    const repository = getStudyProfileRepository();
    const saved = await repository.saveResponse({
      email: parsed.data.email,
      visitorId: parsed.data.visitorId,
      answers: parsed.data.answers,
      snapshot,
      metadata: parsed.data.metadata,
      report,
      marketingConsent: parsed.data.marketingConsent,
      under18: parsed.data.under18,
      attribution: parsed.data.attribution,
    });

    const confirmationToken = generateStudyProfileReportToken();
    const publicResponseStartedAt = Date.now();
    const waitlistState = await repository.requestWaitlistConfirmation(
      saved.storedResponse.reportToken,
      "email_gate",
      hashStudyProfileReportToken(confirmationToken),
      parsed.data.attribution,
    );
    if (!waitlistState) {
      throw new Error("Saved Study Profile report could not be resolved for waitlist confirmation.");
    }
    if (waitlistState.dailyCapReached) {
      await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);
      return jsonError(
        "YOVA could not send another confirmation email right now. Wait and try again later.",
        429,
        { "Retry-After": String(Math.max(1, waitlistState.retryAfterSeconds)) },
      );
    }
    if (!waitlistState.waitlistJoined && !waitlistState.confirmationPending) {
      await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);
      return jsonError("YOVA could not prepare your confirmation email. Try again.", 503);
    }
    if (
      waitlistState.confirmationPending
      && !waitlistState.shouldSend
      && waitlistState.confirmationId === null
    ) {
      await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);
      return jsonError(
        "YOVA could not send a new report confirmation yet. Wait 15 minutes and try again.",
        429,
        { "Retry-After": String(Math.max(1, waitlistState.retryAfterSeconds || 900)) },
      );
    }
    try {
      await deliverStudyProfileWaitlistConfirmation(
        repository,
        waitlistState,
        confirmationToken,
        saved.storedResponse.reportToken,
      );
    } catch (error) {
      console.error(
        "Study Profile report-unlock confirmation delivery failed.",
        safeErrorName(error),
      );
      await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);
      return jsonError(
        "YOVA could not send your confirmation email. Your answers are still saved in this browser, so try again.",
        503,
      );
    }
    await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);

    return NextResponse.json({
      confirmationPending: true,
    }, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return jsonError("Study Profile saving is temporarily unavailable. Try again shortly.", 503);
    }
    if (error instanceof StudyProfileCommittedWriteError) {
      console.error("Study Profile save receipt recovery failed.", safeErrorName(error));
      return NextResponse.json({
        error: "Your Study Profile may have been saved, but YOVA could not prepare the confirmation email. Wait a moment before trying again.",
        code: "saved_response_unavailable",
      }, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof StudyProfileSaveOutcomeUnknownError) {
      console.error("Study Profile save outcome recovery failed.", safeErrorName(error));
      return NextResponse.json({
        error: "YOVA could not confirm whether your Study Profile was saved. Wait a moment before trying again.",
        code: "save_outcome_unknown",
      }, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Study Profile submission failed.", safeErrorName(error));
    return jsonError("YOVA could not save your Study Profile. Your answers are still on this device; try again.", 500);
  }
}

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

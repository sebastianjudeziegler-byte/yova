import { NextResponse } from "next/server";
import { StudyProfileReportTokenSchema } from "@/lib/study-profile";
import { StudyProfileInterestRequestSchema } from "@/lib/study-profile/api-schema";
import {
  STUDY_PROFILE_INTEREST_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfilePersistenceUnavailableError,
  generateStudyProfileReportToken,
  getStudyProfileRepository,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import {
  deliverStudyProfileWaitlistConfirmation,
  waitForStudyProfileWaitlistPublicResponseFloor,
} from "@/lib/study-profile/waitlist-confirmation";
import {
  checkStudyProfileInterestRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const requestGuard = validateStudyProfileJsonPostRequest(request);
  if (!requestGuard.ok) {
    return NextResponse.json({ error: requestGuard.message }, {
      status: requestGuard.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rateLimit = checkStudyProfileInterestRateLimit(requestRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many waitlist requests were received at once. Wait a moment and try again." }, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    });
  }

  const { token: tokenInput } = await context.params;
  const token = StudyProfileReportTokenSchema.safeParse(tokenInput);
  if (!token.success) return notFoundResponse();

  const body = await readStudyProfileBoundedJson(request, STUDY_PROFILE_INTEREST_MAX_BYTES);
  if (!body.ok) {
    const error = body.reason === "too_large"
      ? "That waitlist request was too large."
      : "That waitlist request was not valid JSON.";
    return NextResponse.json({ error }, {
      status: body.reason === "too_large" ? 413 : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const parsed = StudyProfileInterestRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirm that you want to join and that you are 13 or older." }, {
      status: 422,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const repository = getStudyProfileRepository();
    const confirmationToken = generateStudyProfileReportToken();
    const state = await repository.requestWaitlistConfirmation(
      token.data,
      parsed.data.source,
      hashStudyProfileReportToken(confirmationToken),
    );
    if (!state) return notFoundResponse();
    const reportScopedJoined = state.waitlistJoined;
    const publicResponseStartedAt = Date.now();
    try {
      await deliverStudyProfileWaitlistConfirmation(
        repository,
        state,
        confirmationToken,
      );
    } catch (error) {
      console.error(
        "Study Profile report confirmation delivery failed.",
        safeErrorName(error),
      );
    }
    await waitForStudyProfileWaitlistPublicResponseFloor(publicResponseStartedAt);
    // A report bearer may know only whether this exact response already has
    // confirmed evidence. Every other recipient state is intentionally
    // indistinguishable so a fresh report cannot enumerate shared membership
    // or email caps for the submitted address.
    return NextResponse.json(
      reportScopedJoined
        ? {
            waitlistJoined: true,
            confirmationPending: false,
            dailyCapReached: false,
            retryAfterSeconds: 0,
          }
        : maskedPendingResponse(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return NextResponse.json({ error: "Waitlist signup is temporarily unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Study Profile interest update failed.", safeErrorName(error));
    return NextResponse.json({ error: "YOVA could not add you to the waitlist. Try again." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

function maskedPendingResponse() {
  return {
    waitlistJoined: false,
    confirmationPending: true,
    dailyCapReached: false,
    retryAfterSeconds: 0,
  };
}

function notFoundResponse() {
  return NextResponse.json({ error: "This Study Profile report link is invalid or unavailable." }, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

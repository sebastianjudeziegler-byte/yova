import { NextResponse } from "next/server";
import { StudyProfileReportTokenSchema } from "@/lib/study-profile";
import { StudyProfileInterestRequestSchema } from "@/lib/study-profile/api-schema";
import {
  STUDY_PROFILE_INTEREST_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfileInterestStateError,
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
} from "@/lib/study-profile/repository";
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
    return NextResponse.json({ error: "Too many early-access updates were received at once." }, {
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
      ? "That early-access update was too large."
      : "That early-access update was not valid JSON.";
    return NextResponse.json({ error }, {
      status: body.reason === "too_large" ? 413 : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const parsed = StudyProfileInterestRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose an early-access or beta-testing response." }, {
      status: 422,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const repository = getStudyProfileRepository();
    const report = await repository.getReportByToken(token.data);
    if (!report) return notFoundResponse();

    let state = {
      waitlistJoined: report.waitlistJoined,
      betaInterest: report.betaInterest,
    };
    if (parsed.data.waitlist) {
      state = await repository.joinWaitlist(token.data) ?? state;
      void repository.recordEvent({
        responseId: report.storedResponse.id,
        eventName: "study_profile_waitlist_joined",
        eventData: {},
      }).catch(() => {});
    }
    if (typeof parsed.data.betaInterest === "boolean") {
      state = await repository.setBetaInterest(token.data, parsed.data.betaInterest) ?? state;
      void repository.recordEvent({
        responseId: report.storedResponse.id,
        eventName: "study_profile_beta_interest",
        eventData: { betaInterested: parsed.data.betaInterest },
      }).catch(() => {});
    }

    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfileInterestStateError) {
      return NextResponse.json({ error: error.message }, {
        status: 409,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return NextResponse.json({ error: "Early-access updates are temporarily unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Study Profile interest update failed.", safeErrorName(error));
    return NextResponse.json({ error: "YOVA could not save that early-access choice. Try again." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
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

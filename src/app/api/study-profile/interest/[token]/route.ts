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
    return NextResponse.json({ error: "Choose whether to join the waitlist." }, {
      status: 422,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const repository = getStudyProfileRepository();
    const state = await repository.joinWaitlist(token.data, parsed.data.source);
    if (!state) return notFoundResponse();
    if (!state.waitlistJoined) {
      throw new Error("Study Profile waitlist update did not return a joined state.");
    }

    return NextResponse.json({ waitlistJoined: true }, {
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

function notFoundResponse() {
  return NextResponse.json({ error: "This Study Profile report link is invalid or unavailable." }, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

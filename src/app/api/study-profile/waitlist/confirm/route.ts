import { NextResponse } from "next/server";
import { StudyProfileWaitlistConfirmationRequestSchema } from "@/lib/study-profile/api-schema";
import {
  STUDY_PROFILE_WAITLIST_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
  hashStudyProfileReportToken,
} from "@/lib/study-profile/repository";
import {
  checkStudyProfileWaitlistConfirmationRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestGuard = validateStudyProfileJsonPostRequest(request);
  if (!requestGuard.ok) return jsonError(requestGuard.message, requestGuard.status);

  const rateLimit = checkStudyProfileWaitlistConfirmationRateLimit(
    requestRateLimitKey(request),
  );
  if (!rateLimit.allowed) {
    return jsonError("Too many confirmation attempts were received. Wait a minute and try again.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const body = await readStudyProfileBoundedJson(
    request,
    STUDY_PROFILE_WAITLIST_MAX_BYTES,
  );
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large"
        ? "That confirmation request was too large."
        : "That confirmation request was not valid JSON.",
      body.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = StudyProfileWaitlistConfirmationRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError("This waitlist confirmation link is invalid.", 422);
  }

  try {
    const result = await getStudyProfileRepository().confirmWaitlist(
      hashStudyProfileReportToken(parsed.data.token),
    );
    if (result.status === "expired") {
      return jsonError("This confirmation link has expired. Request a new email from the Study Profile page.", 410);
    }
    if (result.status === "invalid") {
      return jsonError("This confirmation link is invalid or has already been used.", 404);
    }
    return NextResponse.json({ waitlistJoined: true }, {
      headers: confirmationHeaders(),
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return jsonError("Waitlist confirmation is temporarily unavailable.", 503);
    }
    console.error(
      "Study Profile waitlist confirmation failed.",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("YOVA could not confirm your place right now. Try again.", 500);
  }
}

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { ...confirmationHeaders(), ...headers },
  });
}

function confirmationHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
  };
}

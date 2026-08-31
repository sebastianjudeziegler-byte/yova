import { NextResponse } from "next/server";
import { StudyProfileLandingWaitlistRequestSchema } from "@/lib/study-profile/api-schema";
import {
  STUDY_PROFILE_WAITLIST_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
} from "@/lib/study-profile/repository";
import {
  checkStudyProfileWaitlistRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestGuard = validateStudyProfileJsonPostRequest(request);
  if (!requestGuard.ok) return jsonError(requestGuard.message, requestGuard.status);

  const ipLimit = checkStudyProfileWaitlistRateLimit(`ip:${requestRateLimitKey(request)}`);
  if (!ipLimit.allowed) {
    return jsonError("Too many waitlist requests were received at once. Wait a minute and try again.", 429, {
      "Retry-After": String(ipLimit.retryAfterSeconds),
    });
  }

  const body = await readStudyProfileBoundedJson(request, STUDY_PROFILE_WAITLIST_MAX_BYTES);
  if (!body.ok) {
    return jsonError(
      body.reason === "too_large"
        ? "That waitlist request was too large."
        : "That waitlist request was not valid JSON.",
      body.reason === "too_large" ? 413 : 400,
    );
  }

  const parsed = StudyProfileLandingWaitlistRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError("Add a valid email and confirm that you want to join the waitlist.", 422);
  }

  const emailLimit = checkStudyProfileWaitlistRateLimit(`email:${parsed.data.email}`);
  if (!emailLimit.allowed) {
    return jsonError("That email was submitted several times. Wait a minute and try again.", 429, {
      "Retry-After": String(emailLimit.retryAfterSeconds),
    });
  }

  try {
    const state = await getStudyProfileRepository().joinWaitlistByEmail({
      email: parsed.data.email,
      visitorId: parsed.data.visitorId,
      attribution: parsed.data.attribution,
    });
    if (!state.waitlistJoined) throw new Error("Waitlist update did not return a joined state.");
    return NextResponse.json({ waitlistJoined: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return jsonError("Waitlist signup is temporarily unavailable.", 503);
    }
    console.error(
      "Study Profile landing waitlist signup failed.",
      error instanceof Error ? error.name : "UnknownError",
    );
    return jsonError("YOVA could not add you to the waitlist. Try again.", 500);
  }
}

function jsonError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

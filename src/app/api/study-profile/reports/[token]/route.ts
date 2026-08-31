import { NextResponse } from "next/server";
import {
  StudyProfileReportTokenSchema,
  toStudyProfilePublicStoredResponse,
} from "@/lib/study-profile";
import {
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
} from "@/lib/study-profile/repository";
import {
  checkStudyProfileReportRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const rateLimit = checkStudyProfileReportRateLimit(requestRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many report requests were received at once." }, {
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

  try {
    const repository = getStudyProfileRepository();
    const saved = await repository.getReportByToken(token.data);
    if (!saved) return notFoundResponse();

    return NextResponse.json({
      storedResponse: toStudyProfilePublicStoredResponse(saved.storedResponse),
      report: saved.report,
      waitlistJoined: saved.waitlistJoined,
      confirmationPending: saved.confirmationPending,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return NextResponse.json({ error: "Study Profile reports are temporarily unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("Study Profile report lookup failed.", safeErrorName(error));
    return NextResponse.json({ error: "YOVA could not open this report right now." }, {
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

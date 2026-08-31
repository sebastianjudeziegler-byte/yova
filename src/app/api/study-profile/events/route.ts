import { NextResponse } from "next/server";
import { StudyProfileAnalyticsEventRequestSchema } from "@/lib/study-profile/analytics";
import { getStudyProfileRepository } from "@/lib/study-profile/repository";
import {
  STUDY_PROFILE_EVENT_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  checkStudyProfileEventRateLimit,
  requestRateLimitKey,
} from "@/lib/server/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestGuard = validateStudyProfileJsonPostRequest(request);
  if (!requestGuard.ok) {
    return NextResponse.json({ error: requestGuard.message }, {
      status: requestGuard.status,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const rateLimit = checkStudyProfileEventRateLimit(requestRateLimitKey(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many Study Profile events were received at once." }, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    });
  }

  const body = await readStudyProfileBoundedJson(request, STUDY_PROFILE_EVENT_MAX_BYTES);
  if (!body.ok) {
    const error = body.reason === "too_large"
      ? "That Study Profile event was too large."
      : "That Study Profile event was not valid JSON.";
    return NextResponse.json({ error }, {
      status: body.reason === "too_large" ? 413 : 400,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const parsed = StudyProfileAnalyticsEventRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "That Study Profile event is not supported." }, {
      status: 422,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    await getStudyProfileRepository().recordEvent({
      visitorId: parsed.data.visitorId,
      eventName: parsed.data.eventName,
      eventData: {
        ...parsed.data.context,
        scoringRevision: parsed.data.scoringRevision,
      },
      attribution: parsed.data.attribution,
    });
  } catch {
    // Funnel instrumentation is best-effort and never interrupts assessment UX.
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}

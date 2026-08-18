import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import {
  buildStudyProfileReport,
  scoreStudyProfile,
  toStudyProfilePublicStoredResponse,
} from "@/lib/study-profile";
import { StudyProfileResponseRequestSchema } from "@/lib/study-profile/api-schema";
import {
  sendStudyProfileReportEmail,
  type StudyProfileEmailDeliveryResult,
} from "@/lib/study-profile/email";
import {
  STUDY_PROFILE_RESPONSE_MAX_BYTES,
  readStudyProfileBoundedJson,
  validateStudyProfileJsonPostRequest,
} from "@/lib/study-profile/request-security";
import {
  StudyProfilePersistenceUnavailableError,
  getStudyProfileRepository,
} from "@/lib/study-profile/repository";
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
    return jsonError("Complete all 12 questions and add a valid email to get your report.", 422);
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
      attribution: parsed.data.attribution,
    });
    const reportUrl = new URL(
      `/study-profile/report/${saved.storedResponse.reportToken}`,
      getSiteUrl(),
    ).toString();

    let emailDelivery: StudyProfileEmailDeliveryResult["status"] = "failed";
    try {
      const delivery = await sendStudyProfileReportEmail({
        to: parsed.data.email,
        reportUrl,
        primaryPatternName: report.primaryPattern.name,
        primaryPatternLabel: report.primaryPattern.label,
        responseId: saved.storedResponse.id,
      });
      emailDelivery = delivery.status;
      try {
        await repository.markEmailDelivery(
          saved.storedResponse.id,
          delivery.status,
          "providerMessageId" in delivery ? delivery.providerMessageId : null,
        );
      } catch {
        // Report access must never depend on secondary delivery bookkeeping.
      }
    } catch {
      // A delivery integration failure must never hide an already-saved report.
    }

    return NextResponse.json({
      reportToken: saved.storedResponse.reportToken,
      reportUrl,
      storedResponse: toStudyProfilePublicStoredResponse(saved.storedResponse),
      report: saved.report,
      waitlistJoined: saved.waitlistJoined,
      emailDelivery,
    }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StudyProfilePersistenceUnavailableError) {
      return jsonError("Study Profile saving is temporarily unavailable. Try again shortly.", 503);
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

"use client";

import {
  StudyProfileAnalyticsAttributionSchema,
  StudyProfileAnalyticsEventSchema,
  StudyProfileVisitorIdSchema,
  type StudyProfileAnalyticsAttribution,
  type StudyProfileEventName,
  type StudyProfileEventProperties,
} from "@/lib/study-profile/analytics";
import { sanitizeStudyProfileAttributionValue } from "@/lib/study-profile/attribution-privacy";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_SCORING_REVISION,
} from "@/lib/study-profile/types";

let ephemeralVisitorId: string | null = null;
let ephemeralAttribution: StudyProfileAnalyticsAttribution | null = null;

function createVisitorId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return null;
}

/** Returns a page-lifetime UUID. It is never written to browser storage. */
export function getStudyProfileVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  ephemeralVisitorId ??= createVisitorId();
  const parsed = StudyProfileVisitorIdSchema.safeParse(ephemeralVisitorId);
  return parsed.success ? parsed.data : null;
}

function boundedCampaignValue(value: string | null, maxLength: number) {
  return sanitizeStudyProfileAttributionValue(value, maxLength);
}

function safeReferrerOrigin(referrer: string | null | undefined) {
  if (!referrer) return null;
  try {
    const parsed = new URL(referrer);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return new URL("/", parsed.origin).toString();
  } catch {
    return null;
  }
}

/** Pure attribution parser used by the browser capture function and tests. */
export function deriveStudyProfileAttribution(
  pageUrl: string,
  referrer?: string | null,
): StudyProfileAnalyticsAttribution {
  let params: URLSearchParams;
  try {
    params = new URL(pageUrl).searchParams;
  } catch {
    params = new URLSearchParams();
  }

  const safeReferrer = safeReferrerOrigin(referrer);
  const utmSource = boundedCampaignValue(params.get("utm_source"), 100);
  const explicitSource = boundedCampaignValue(params.get("source"), 100);
  let referrerHost: string | null = null;
  if (safeReferrer) {
    try {
      referrerHost = new URL(safeReferrer).hostname.slice(0, 100);
    } catch {
      referrerHost = null;
    }
  }

  const candidate = {
    source: explicitSource ?? utmSource ?? referrerHost ?? "direct",
    referrer: safeReferrer,
    utmSource,
    utmMedium: boundedCampaignValue(params.get("utm_medium"), 100),
    utmCampaign: boundedCampaignValue(params.get("utm_campaign"), 160),
    utmContent: boundedCampaignValue(params.get("utm_content"), 160),
    utmTerm: boundedCampaignValue(params.get("utm_term"), 160),
  };

  const parsed = StudyProfileAnalyticsAttributionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { source: "direct" };
}

/**
 * Captures first-touch attribution for the current page lifetime. It remains
 * in memory only, with no analytics identifier or attribution written to web
 * storage before consent.
 */
export function captureStudyProfileAttribution(): StudyProfileAnalyticsAttribution {
  if (typeof window === "undefined") return { source: "direct" };
  if (ephemeralAttribution) return ephemeralAttribution;

  ephemeralAttribution = deriveStudyProfileAttribution(
    window.location.href,
    document.referrer,
  );
  return ephemeralAttribution;
}

type PropertyArguments<Name extends StudyProfileEventName> =
  Name extends "study_profile_question_answered" | "study_profile_share_tapped"
    ? [properties: StudyProfileEventProperties[Name]]
    : [properties?: StudyProfileEventProperties[Name]];

/** Fire-and-forget public funnel telemetry with a closed, privacy-safe shape. */
export function trackStudyProfileEvent<Name extends StudyProfileEventName>(
  name: Name,
  ...[properties]: PropertyArguments<Name>
) {
  const visitorId = getStudyProfileVisitorId();
  if (!visitorId) return;

  const event = StudyProfileAnalyticsEventSchema.safeParse({
    eventName: name,
    visitorId,
    modelVersion: STUDY_PROFILE_MODEL_VERSION,
    scoringRevision: STUDY_PROFILE_SCORING_REVISION,
    attribution: captureStudyProfileAttribution(),
    context: properties ?? {},
  });
  if (!event.success) return;

  void fetch("/api/study-profile/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event.data),
    keepalive: true,
  }).catch(() => {
    // Analytics must never block or interrupt the Study Profile experience.
  });
}

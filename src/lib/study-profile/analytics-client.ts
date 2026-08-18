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
import { STUDY_PROFILE_MODEL_VERSION } from "@/lib/study-profile/types";

const VISITOR_STORAGE_KEY = "yova.study-profile.visitor.v1";
const ATTRIBUTION_STORAGE_KEY = "yova.study-profile.attribution.v1";

let ephemeralVisitorId: string | null = null;

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

/** Returns a pseudonymous, device-local UUID. It never contains lead data. */
export function getStudyProfileVisitorId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    const parsed = StudyProfileVisitorIdSchema.safeParse(stored);
    if (parsed.success) return parsed.data;

    const created = createVisitorId();
    if (!created) return null;
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    return created;
  } catch {
    ephemeralVisitorId ??= createVisitorId();
    return ephemeralVisitorId;
  }
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
 * Captures first-touch attribution for the current tab. Stored data is limited
 * to known UTM fields and a referrer origin with no path or query string.
 */
export function captureStudyProfileAttribution(): StudyProfileAnalyticsAttribution {
  if (typeof window === "undefined") return { source: "direct" };

  try {
    const saved = window.sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (saved) {
      const parsed = StudyProfileAnalyticsAttributionSchema.safeParse(JSON.parse(saved));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Storage can be unavailable in privacy modes; capture still works in-memory.
  }

  const attribution = deriveStudyProfileAttribution(
    window.location.href,
    document.referrer,
  );

  try {
    window.sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Attribution is optional and must never interrupt the assessment.
  }

  return attribution;
}

type PropertyArguments<Name extends StudyProfileEventName> =
  Name extends "study_profile_question_answered" | "study_profile_beta_interest"
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

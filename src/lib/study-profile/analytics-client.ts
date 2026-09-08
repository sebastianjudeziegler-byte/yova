"use client";

import {
  StudyProfileAnalyticsAttributionSchema,
  StudyProfileAnalyticsEventSchema,
  StudyProfileVisitorIdSchema,
  type StudyProfileEventName,
  type StudyProfileEventProperties,
} from "@/lib/study-profile/analytics";
import { sanitizeStudyProfileAttributionValue } from "@/lib/study-profile/attribution-privacy";
import {
  StudyProfileAttributionSchema,
  type StudyProfileAttribution,
} from "@/lib/study-profile/schema";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_SCORING_REVISION,
} from "@/lib/study-profile/types";

let ephemeralVisitorId: string | null = null;
let ephemeralAttribution: StudyProfileAttribution | null = null;
let ephemeralAttributionCapturedAt: number | null = null;

const ATTRIBUTION_STORAGE_KEY = "yova.study-profile.attribution.v1";
const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

type StoredAttribution = {
  version: 1;
  capturedAt: number;
  attribution: StudyProfileAttribution;
};

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

/** Returns an in-memory UUID. It is transferred once to the private report when needed. */
export function getStudyProfileVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  ephemeralVisitorId ??= createVisitorId();
  const parsed = StudyProfileVisitorIdSchema.safeParse(ephemeralVisitorId);
  return parsed.success ? parsed.data : null;
}

/** Restores the anonymous funnel ID after the privacy-safe report page reload. */
export function restoreStudyProfileVisitorId(visitorId: string) {
  const parsed = StudyProfileVisitorIdSchema.safeParse(visitorId);
  if (parsed.success) ephemeralVisitorId = parsed.data;
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
): StudyProfileAttribution {
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

  const parsed = StudyProfileAttributionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { source: "direct" };
}

/**
 * Captures first-touch attribution and keeps it for 30 days. A valid stored
 * first touch always wins over later campaign URLs.
 */
export function captureStudyProfileAttribution(): StudyProfileAttribution {
  if (typeof window === "undefined") return { source: "direct" };
  const now = Date.now();
  if (
    ephemeralAttribution
    && ephemeralAttributionCapturedAt !== null
    && ephemeralAttributionCapturedAt <= now
    && now - ephemeralAttributionCapturedAt <= ATTRIBUTION_TTL_MS
  ) {
    return ephemeralAttribution;
  }
  if (ephemeralAttributionCapturedAt !== null) {
    ephemeralAttribution = null;
    ephemeralAttributionCapturedAt = null;
  }

  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    // Some privacy modes deny access to the storage object itself.
  }
  const persisted = storage
    ? readStoredStudyProfileAttributionEntry(storage, now)
    : null;
  if (persisted) {
    ephemeralAttribution = {
      source: persisted.attribution.utmSource ?? "direct",
      ...persisted.attribution,
    };
    ephemeralAttributionCapturedAt = persisted.capturedAt;
    return ephemeralAttribution;
  }

  ephemeralAttribution = deriveStudyProfileAttribution(
    window.location.href,
    document.referrer,
  );
  const campaignAttribution = toStoredCampaignAttribution(ephemeralAttribution);
  ephemeralAttributionCapturedAt = campaignAttribution ? now : null;
  try {
    if (!campaignAttribution) return ephemeralAttribution;
    const stored: StoredAttribution = {
      version: 1,
      capturedAt: now,
      attribution: campaignAttribution,
    };
    storage?.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage can be unavailable; in-memory attribution still covers this visit.
  }
  return ephemeralAttribution;
}

export function readStoredStudyProfileAttribution(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now: number,
) {
  return readStoredStudyProfileAttributionEntry(storage, now)?.attribution ?? null;
}

function readStoredStudyProfileAttributionEntry(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now: number,
): StoredAttribution | null {
  try {
    const raw = storage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<StoredAttribution>;
    const capturedAt = candidate.capturedAt;
    const parsed = StudyProfileAttributionSchema.safeParse(candidate.attribution);
    if (
      candidate.version !== 1
      || typeof capturedAt !== "number"
      || !Number.isFinite(capturedAt)
      || capturedAt > now
      || now - capturedAt > ATTRIBUTION_TTL_MS
      || !parsed.success
    ) {
      storage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    const campaignAttribution = toStoredCampaignAttribution(parsed.data);
    if (!campaignAttribution) {
      storage.removeItem(ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    return {
      version: 1,
      capturedAt,
      attribution: campaignAttribution,
    };
  } catch {
    try {
      storage.removeItem(ATTRIBUTION_STORAGE_KEY);
    } catch {
      // Ignore browsers that deny storage access entirely.
    }
    return null;
  }
}

function toStoredCampaignAttribution(attribution: StudyProfileAttribution) {
  const candidate = {
    ...(attribution.utmSource ? { utmSource: attribution.utmSource } : {}),
    ...(attribution.utmMedium ? { utmMedium: attribution.utmMedium } : {}),
    ...(attribution.utmCampaign ? { utmCampaign: attribution.utmCampaign } : {}),
    ...(attribution.utmContent ? { utmContent: attribution.utmContent } : {}),
    ...(attribution.utmTerm ? { utmTerm: attribution.utmTerm } : {}),
  };
  return Object.keys(candidate).length > 0 ? candidate : null;
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
  const capturedAttribution = captureStudyProfileAttribution();
  const eventAttribution = StudyProfileAnalyticsAttributionSchema.safeParse({
    source: capturedAttribution.source,
    referrer: capturedAttribution.referrer,
    utmSource: capturedAttribution.utmSource,
    utmMedium: capturedAttribution.utmMedium,
    utmCampaign: capturedAttribution.utmCampaign,
    utmContent: capturedAttribution.utmContent,
    utmTerm: capturedAttribution.utmTerm,
  });
  if (!eventAttribution.success) return;

  const event = StudyProfileAnalyticsEventSchema.safeParse({
    eventName: name,
    visitorId,
    modelVersion: STUDY_PROFILE_MODEL_VERSION,
    scoringRevision: STUDY_PROFILE_SCORING_REVISION,
    attribution: eventAttribution.data,
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

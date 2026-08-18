import { describe, expect, it } from "vitest";
import {
  StudyProfileAnalyticsEventSchema,
} from "@/lib/study-profile/analytics";
import { deriveStudyProfileAttribution } from "@/lib/study-profile/analytics-client";
import { STUDY_PROFILE_MODEL_VERSION } from "@/lib/study-profile/types";

const visitorId = "3f4edc20-e169-4f7f-b2c3-2a1a683b74e9";

describe("StudyProfileAnalyticsEventSchema", () => {
  it("accepts only the bounded context for each of the seven funnel events", () => {
    const base = { visitorId, modelVersion: STUDY_PROFILE_MODEL_VERSION };
    const events = [
      { ...base, eventName: "study_profile_page_viewed", context: {} },
      { ...base, eventName: "study_profile_started", context: {} },
      {
        ...base,
        eventName: "study_profile_question_answered",
        context: { questionNumber: 12 },
      },
      { ...base, eventName: "study_profile_completed", context: {} },
      { ...base, eventName: "study_profile_email_submitted", context: {} },
      { ...base, eventName: "study_profile_report_viewed", context: {} },
      { ...base, eventName: "study_profile_waitlist_joined", context: {} },
    ];

    for (const event of events) {
      expect(StudyProfileAnalyticsEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("rejects lead data, answers, tokens, and arbitrary event properties", () => {
    const unsafeEvents = [
      {
        visitorId,
        modelVersion: STUDY_PROFILE_MODEL_VERSION,
        eventName: "study_profile_email_submitted",
        context: { email: "student@example.com" },
      },
      {
        visitorId,
        modelVersion: STUDY_PROFILE_MODEL_VERSION,
        eventName: "study_profile_question_answered",
        context: { questionNumber: 1, answer: "a" },
      },
      {
        visitorId,
        modelVersion: STUDY_PROFILE_MODEL_VERSION,
        eventName: "study_profile_report_viewed",
        context: {},
        reportToken: "private-token",
      },
      {
        visitorId,
        modelVersion: STUDY_PROFILE_MODEL_VERSION,
        eventName: "study_profile_question_answered",
        context: { questionNumber: 13 },
      },
      {
        visitorId,
        modelVersion: STUDY_PROFILE_MODEL_VERSION,
        eventName: "study_profile_beta_interest",
        context: { betaInterested: true },
      },
    ];

    for (const event of unsafeEvents) {
      expect(StudyProfileAnalyticsEventSchema.safeParse(event).success).toBe(false);
    }
  });

  it("rejects identifiers and private report tokens hidden in attribution", () => {
    const reportToken = "b".repeat(43);
    const base = {
      visitorId,
      modelVersion: STUDY_PROFILE_MODEL_VERSION,
      eventName: "study_profile_page_viewed",
      context: {},
    };

    for (const attribution of [
      { source: "student@example.com" },
      { utmCampaign: "student%40example.com" },
      { utmContent: reportToken },
      { referrer: `https://www.yovaapp.com/study-profile/report/${reportToken}` },
    ]) {
      expect(StudyProfileAnalyticsEventSchema.safeParse({
        ...base,
        attribution,
      }).success).toBe(false);
    }
  });
});

describe("deriveStudyProfileAttribution", () => {
  it("keeps known UTMs while reducing referrers to their origin", () => {
    expect(deriveStudyProfileAttribution(
      "https://www.yovaapp.com/study-profile?utm_source=instagram&utm_medium=social&utm_campaign=fall_launch",
      "https://example.edu/private/path?student=42#section",
    )).toEqual({
      source: "instagram",
      referrer: "https://example.edu/",
      utmSource: "instagram",
      utmMedium: "social",
      utmCampaign: "fall_launch",
      utmContent: null,
      utmTerm: null,
    });
  });

  it("drops email-like campaign values", () => {
    const attribution = deriveStudyProfileAttribution(
      "https://www.yovaapp.com/study-profile?utm_term=student%40example.com",
      null,
    );

    expect(attribution.utmTerm).toBeNull();
    expect(attribution.source).toBe("direct");
  });

  it("drops report-token-like campaign values", () => {
    const attribution = deriveStudyProfileAttribution(
      `https://www.yovaapp.com/study-profile?utm_content=${"c".repeat(43)}`,
      null,
    );

    expect(attribution.utmContent).toBeNull();
  });
});

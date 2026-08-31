import { describe, expect, it } from "vitest";
import {
  StudyProfileInterestRequestSchema,
  StudyProfileLandingWaitlistRequestSchema,
  StudyProfileResponseRequestSchema,
  StudyProfileWaitlistConfirmationRequestSchema,
} from "@/lib/study-profile/api-schema";

const answers = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, "a"]),
);

describe("Study Profile API schemas", () => {
  it("accepts a complete, privacy-bounded response request", () => {
    const result = StudyProfileResponseRequestSchema.safeParse({
      email: " Student@Example.com ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      ageConfirmed: true,
      answers,
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        studyGoal: "upcoming_exams",
        hardestPart: null,
      },
      marketingConsent: false,
      waitlistConsent: true,
      attribution: {
        source: "tiktok",
        referrer: "https://www.tiktok.com/",
        utmCampaign: "prelaunch",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("student@example.com");
      expect(result.data.metadata.hardestPart).toBeNull();
      expect(result.data.metadata.studyGoal).toBe("upcoming_exams");
    }
  });

  it("fails closed when the report email gate lacks a 13+ affirmation", () => {
    expect(StudyProfileResponseRequestSchema.safeParse({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers,
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        studyGoal: "upcoming_exams",
        hardestPart: null,
      },
      marketingConsent: false,
      waitlistConsent: true,
    }).success).toBe(false);
  });

  it("rejects incomplete answers and client-computed scores", () => {
    expect(StudyProfileResponseRequestSchema.safeParse({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers: { q1: "a" },
      metadata: { energyWindow: "morning", schoolLevel: "college" },
      marketingConsent: false,
      waitlistConsent: true,
      scores: { starting_friction: 0 },
    }).success).toBe(false);
  });

  it("does not accept a separate launch-marketing consent flag", () => {
    expect(StudyProfileResponseRequestSchema.safeParse({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers,
      metadata: { energyWindow: "morning", schoolLevel: "college" },
      marketingConsent: true,
      waitlistConsent: true,
    }).success).toBe(false);
  });

  it("requires explicit waitlist consent before creating a report", () => {
    const request = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      ageConfirmed: true,
      answers,
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        studyGoal: "upcoming_exams",
        hardestPart: null,
      },
      marketingConsent: false,
    };

    expect(StudyProfileResponseRequestSchema.safeParse(request).success).toBe(false);
    expect(StudyProfileResponseRequestSchema.safeParse({
      ...request,
      waitlistConsent: false,
    }).success).toBe(false);
    expect(StudyProfileResponseRequestSchema.safeParse({
      ...request,
      waitlistConsent: true,
    }).success).toBe(true);
  });

  it("does not accept the retired optional free-text field", () => {
    expect(StudyProfileResponseRequestSchema.safeParse({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers,
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        hardestPart: "I keep putting off the first step.",
      },
      marketingConsent: false,
      waitlistConsent: true,
    }).success).toBe(false);
  });

  it("rejects direct identifiers and private report tokens in attribution", () => {
    const base = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      ageConfirmed: true,
      answers,
      metadata: { energyWindow: "morning", schoolLevel: "college" },
      marketingConsent: false,
      waitlistConsent: true,
    };
    const reportToken = "a".repeat(43);

    for (const attribution of [
      { utmCampaign: "student@example.com" },
      { utmContent: "student%40example.com" },
      { utmTerm: reportToken },
      { referrer: `https://www.yovaapp.com/study-profile/report/${reportToken}` },
    ]) {
      expect(StudyProfileResponseRequestSchema.safeParse({
        ...base,
        attribution,
      }).success).toBe(false);
    }
  });

  it("accepts only a waitlist signup", () => {
    expect(StudyProfileInterestRequestSchema.safeParse({}).success).toBe(false);
    expect(StudyProfileInterestRequestSchema.safeParse({ waitlist: true }).success).toBe(false);
    expect(StudyProfileInterestRequestSchema.safeParse({
      waitlist: true,
      ageConfirmed: true,
    }).success).toBe(true);
    expect(StudyProfileInterestRequestSchema.safeParse({ betaInterest: false }).success).toBe(false);
    expect(StudyProfileInterestRequestSchema.safeParse({
      waitlist: true,
      ageConfirmed: true,
      betaInterest: true,
    }).success).toBe(false);
    expect(StudyProfileInterestRequestSchema.safeParse({
      waitlist: true,
      ageConfirmed: false,
    }).success).toBe(false);
  });

  it("accepts an explicit landing waitlist consent and normalizes the email", () => {
    const result = StudyProfileLandingWaitlistRequestSchema.safeParse({
      email: "  Student@Example.COM ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
      attribution: {
        source: "instagram",
        referrer: "https://www.instagram.com/",
        utmCampaign: "study-profile-launch",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        email: "student@example.com",
        visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
        consent: true,
        ageConfirmed: true,
        attribution: {
          source: "instagram",
          referrer: "https://www.instagram.com/",
          utmCampaign: "study-profile-launch",
        },
      });
    }
  });

  it.each([
    ["missing consent", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
    }],
    ["refused consent", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: false,
    }],
    ["invalid email", {
      email: "not-an-email",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
    }],
    ["invalid visitor", {
      email: "student@example.com",
      visitorId: "visitor-123",
      consent: true,
    }],
    ["unexpected private state", {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      reportToken: "a".repeat(43),
    }],
  ])("rejects landing waitlist input with %s", (_label, input) => {
    expect(StudyProfileLandingWaitlistRequestSchema.safeParse(input).success).toBe(false);
  });

  it("rejects identifiers and private report tokens in landing waitlist attribution", () => {
    const base = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      consent: true,
      ageConfirmed: true,
    };
    const reportToken = "b".repeat(43);

    for (const attribution of [
      { source: "another-student@example.com" },
      { utmCampaign: "another-student%40example.com" },
      { utmContent: reportToken },
      { referrer: `https://www.yovaapp.com/study-profile/report/${reportToken}` },
    ]) {
      expect(StudyProfileLandingWaitlistRequestSchema.safeParse({
        ...base,
        attribution,
      }).success).toBe(false);
    }
  });

  it("accepts only one opaque waitlist confirmation token", () => {
    expect(StudyProfileWaitlistConfirmationRequestSchema.safeParse({
      token: "a".repeat(43),
    }).success).toBe(true);
    expect(StudyProfileWaitlistConfirmationRequestSchema.safeParse({
      token: "short",
    }).success).toBe(false);
    expect(StudyProfileWaitlistConfirmationRequestSchema.safeParse({
      token: "a".repeat(43),
      email: "student@example.com",
    }).success).toBe(false);
  });
});

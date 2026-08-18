import { describe, expect, it } from "vitest";
import {
  StudyProfileInterestRequestSchema,
  StudyProfileResponseRequestSchema,
} from "@/lib/study-profile/api-schema";

const answers = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [`q${index + 1}`, "a"]),
);

describe("Study Profile API schemas", () => {
  it("accepts a complete, privacy-bounded response request", () => {
    const result = StudyProfileResponseRequestSchema.safeParse({
      email: " Student@Example.com ",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers,
      metadata: {
        energyWindow: "morning",
        schoolLevel: "college",
        hardestPart: null,
      },
      marketingConsent: false,
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
    }
  });

  it("rejects incomplete answers and client-computed scores", () => {
    expect(StudyProfileResponseRequestSchema.safeParse({
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers: { q1: "a" },
      metadata: { energyWindow: "morning", schoolLevel: "college" },
      marketingConsent: false,
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
    }).success).toBe(false);
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
    }).success).toBe(false);
  });

  it("rejects direct identifiers and private report tokens in attribution", () => {
    const base = {
      email: "student@example.com",
      visitorId: "4d621251-2df6-4fa3-985e-df63b6d27f5f",
      answers,
      metadata: { energyWindow: "morning", schoolLevel: "college" },
      marketingConsent: false,
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
    expect(StudyProfileInterestRequestSchema.safeParse({ waitlist: true }).success).toBe(true);
    expect(StudyProfileInterestRequestSchema.safeParse({ betaInterest: false }).success).toBe(false);
    expect(StudyProfileInterestRequestSchema.safeParse({
      waitlist: true,
      betaInterest: true,
    }).success).toBe(false);
  });
});

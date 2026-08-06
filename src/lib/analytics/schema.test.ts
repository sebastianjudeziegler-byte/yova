import { describe, expect, it } from "vitest";
import { ProductEventRequestSchema } from "@/lib/analytics/schema";

describe("ProductEventRequestSchema", () => {
  it("accepts useful funnel facts without study content", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "plan_created",
      context: {
        intent: "study_now",
        sourceMode: "yova_generated",
        studyMode: "inside_yova",
        learningApproach: "study",
        sessionCount: 1,
      },
    }).success).toBe(true);
  });

  it("rejects raw learner questions and extra private context", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "tutor_message_sent",
      context: {
        linkedToPlan: true,
        surface: "ask_yova",
        question: "Here is my private study question",
      },
    }).success).toBe(false);
  });

  it("rejects impossible or unbounded session counts", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "session_completed",
      context: {
        plannedMinutes: 25,
        actualMinutes: 10_000,
        correctAnswers: 2,
        totalAnswers: 3,
        feedback: "about_right",
        adaptedNextSession: false,
        calibrationPattern: "well_calibrated",
      },
    }).success).toBe(false);
  });

  it("accepts a privacy-safe confidence calibration pattern", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "session_completed",
      context: {
        plannedMinutes: 25,
        actualMinutes: 22,
        correctAnswers: 2,
        totalAnswers: 3,
        feedback: "about_right",
        adaptedNextSession: true,
        calibrationPattern: "possible_misconception",
      },
    }).success).toBe(true);
  });

  it("accepts privacy-safe session generation performance facts", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "session_generated",
      context: {
        mode: "openai",
        latencyMs: 24_500,
        attempts: 1,
        promptCacheHit: true,
      },
    }).success).toBe(true);
  });

  it("rejects impossible session generation attempts", () => {
    expect(ProductEventRequestSchema.safeParse({
      eventName: "session_generated",
      context: {
        mode: "openai",
        latencyMs: 24_500,
        attempts: 4,
        promptCacheHit: false,
      },
    }).success).toBe(false);
  });
});

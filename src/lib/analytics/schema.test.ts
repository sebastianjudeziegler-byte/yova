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
      },
    }).success).toBe(false);
  });
});

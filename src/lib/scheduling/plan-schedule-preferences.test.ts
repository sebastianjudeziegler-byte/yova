import { describe, expect, it } from "vitest";
import { readPlanSchedulePreferences } from "./plan-schedule-preferences";

describe("saved plan schedule preferences", () => {
  const saved = { intent: "plan", timeZone: "Europe/London", availability: [{ day: "Monday", window: "Morning", minutes: 25 }] };
  it("recovers just the original schedule from stored generation inputs", () => {
    expect(readPlanSchedulePreferences({ ...saved, goal: "Private learner goal" })).toEqual({ timeZone: saved.timeZone, availability: saved.availability });
  });
  it("does not apply recurring windows to one-off or legacy plans", () => {
    expect(readPlanSchedulePreferences({ ...saved, intent: "study_now" })).toBeUndefined();
    expect(readPlanSchedulePreferences({ learningIntent: "learn" })).toBeUndefined();
    expect(readPlanSchedulePreferences({ ...saved, timeZone: "invalid" })).toBeUndefined();
  });
});

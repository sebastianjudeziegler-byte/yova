import { describe, expect, it } from "vitest";
import { explainStudyRouteDuration } from "@/lib/study-route/duration-explanation";

describe("visible StudyRoute duration explanation", () => {
  it("explains a cap without exposing internal rule identifiers", () => {
    expect(explainStudyRouteDuration({
      activeMinutes: 15,
      elapsedMinutes: 15,
      durationSource: "availability_cap",
      hardMaximumMinutes: 20,
    })).toBe("YOVA fit this to the 20-minute window you gave it.");
  });

  it.each([
    ["profile_recommendation", "current profile"],
    ["observed_outcome_adjustment", "comparable recent sessions"],
    ["learner_override", "You selected"],
    ["router_default", "safe starting length"],
    ["legacy_reconstruction", "already saved"],
  ] as const)("gives %s a bounded learner-facing reason", (durationSource, phrase) => {
    expect(explainStudyRouteDuration({
      activeMinutes: 25,
      elapsedMinutes: 25,
      durationSource,
    })).toContain(phrase);
  });
});

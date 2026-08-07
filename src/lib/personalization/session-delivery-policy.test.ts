import { describe, expect, it } from "vitest";
import {
  buildSessionDeliveryPolicy,
  validateSessionDeliveryPolicy,
} from "@/lib/personalization/session-delivery-policy";

type DeliveryInput = Parameters<typeof buildSessionDeliveryPolicy>[0];

const noResults: DeliveryInput["recentResults"] = [];
const noInterruptions: DeliveryInput["recentInterruptions"] = [];

describe("session delivery policy", () => {
  it("turns different learner profiles into different delivery for the same conceptual lesson", () => {
    const exampleLed = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "A concrete example before the rule",
        memoryChallenge: "I understand it but cannot apply it",
        supportPreference: "Show me a different example",
        workspacePreference: "Show one step at a time",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    const contrastLed = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "Comparing similar ideas side by side",
        memoryChallenge: "I confuse similar ideas",
        supportPreference: "Explain the mistake directly",
        workspacePreference: "Keep the full path visible",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });

    expect(exampleLed.presentation.mode).toBe("example_first");
    expect(exampleLed.retention.mode).toBe("transfer");
    expect(exampleLed.repair.mode).toBe("alternate_example");
    expect(exampleLed.workspace.mode).toBe("one_step");
    expect(contrastLed.presentation.mode).toBe("compare_first");
    expect(contrastLed.retention.mode).toBe("discrimination");
    expect(contrastLed.repair.mode).toBe("direct_correction");
    expect(contrastLed.workspace.mode).toBe("full_path");
    expect(exampleLed).not.toEqual(contrastLed);
  });

  it("keeps self-reported preferences labeled as hypotheses until behavior adds evidence", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "The big picture before the details",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });

    expect(policy.evidenceStatus).toBe("starting_hypothesis");
    expect(policy.learnerFacingReasons.join(" ")).toContain("asked for the big picture");
    expect(policy.learnerFacingReasons.join(" ")).not.toMatch(/learn best|brain type/i);
  });

  it("personalizes the first session from the initial onboarding answers", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        explanationPreference: "A concrete example first",
        commonBlocker: "I struggle to start",
        startingPattern: "I intend to begin but often delay",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });

    expect(policy.presentation.mode).toBe("example_first");
    expect(policy.pacing.firstActionMinutes).toBe(2);
    expect(policy.evidenceStatus).toBe("starting_hypothesis");
    expect(policy.learnerFacingReasons.join(" ")).toContain("getting started");
  });

  it("uses repeated early exits to narrow pacing without changing the learning target", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "A concrete example before the rule",
      },
      recentResults: noResults,
      recentInterruptions: [
        { plannedMinutes: 30, actualMinutes: 8, completedSteps: 1, totalSteps: 5 },
        { plannedMinutes: 30, actualMinutes: 12, completedSteps: 2, totalSteps: 5 },
      ],
      learningMode: "learn",
      estimatedMinutes: 30,
    });

    expect(policy.evidenceStatus).toBe("blended");
    expect(policy.pacing.firstActionMinutes).toBe(2);
    expect(policy.pacing.maximumActivities).toBe(4);
    expect(policy.learnerFacingReasons.join(" ")).toContain("pacing adjustment");
  });

  it("requires a delayed return when the learner reports forgetting after a few days", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: { memoryChallenge: "I forget it after a few days" },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    const issue = validateSessionDeliveryPolicy({
      policy,
      learningMode: "learn",
      activities: [
        { methodPhase: "model", type: "instruction", estimatedMinutes: 4, teaching: { example: null, commonMistake: null } },
        { methodPhase: "guided_practice", type: "multiple_choice", estimatedMinutes: 4, teaching: null },
        { methodPhase: "independent_practice", type: "free_response", estimatedMinutes: 5, teaching: null },
      ],
    });

    expect(issue).toContain("delayed retrieval return");
  });

  it("accepts an example-led transfer session that executes the policy", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        processingPreference: "A concrete example before the rule",
        memoryChallenge: "I understand it but cannot apply it",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    const issue = validateSessionDeliveryPolicy({
      policy,
      learningMode: "learn",
      activities: [
        {
          methodPhase: "model",
          type: "instruction",
          estimatedMinutes: 4,
          teaching: {
            example: { steps: ["Set up the case", "Apply the relationship", "Interpret the result"] },
            commonMistake: null,
          },
        },
        { methodPhase: "guided_practice", type: "multiple_choice", estimatedMinutes: 4, teaching: null },
        { methodPhase: "independent_practice", type: "free_response", estimatedMinutes: 5, teaching: null },
        { methodPhase: "transfer", type: "free_response", estimatedMinutes: 5, teaching: null },
      ],
    });

    expect(issue).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import { eligibleMethodIdsFor, KNOWLEDGE_STAGES } from "@/lib/learning/method-eligibility";
import { methodFidelityContractForPrompt } from "@/lib/learning/method-fidelity";
import type { PersonalizationDecision } from "@/lib/personalization/personalization-evidence";
import {
  PERSONALIZATION_DECISION_CHANNELS,
  type PersonalizationDecisionSetting,
} from "@/lib/personalization/personalization-decision";
import {
  buildLessonDeliveryInstructions,
  buildSessionDeliveryPolicy,
  buildStatedPreferenceLessonDelivery,
  reconcileSessionDeliveryPolicyWithMethodRecipe,
  SessionDeliveryPolicySchema,
  validateSessionDeliveryPolicy,
} from "@/lib/personalization/session-delivery-policy";
import { NORMAL_STUDY_DURATION_LEVELS } from "@/lib/study-route/duration-levels";

type DeliveryInput = Parameters<typeof buildSessionDeliveryPolicy>[0];
type DeliveryPolicyDecisionSetting = {
  [Setting in PersonalizationDecisionSetting]:
    (typeof PERSONALIZATION_DECISION_CHANNELS)[Setting]["channel"] extends "delivery_policy"
      ? Setting
      : never;
}[PersonalizationDecisionSetting];

const noResults: DeliveryInput["recentResults"] = [];
const noInterruptions: DeliveryInput["recentInterruptions"] = [];

describe("session delivery policy", () => {
  it("keeps every eligible method recipe feasible across every normal session duration", () => {
    const checked = new Set<string>();
    for (const taskType of LEARNING_TASK_TYPES) {
      for (const knowledgeStage of KNOWLEDGE_STAGES) {
        for (const learningMode of ["learn", "study"] as const) {
          for (const methodId of eligibleMethodIdsFor({ taskType, knowledgeStage, learningMode })) {
            for (const estimatedMinutes of NORMAL_STUDY_DURATION_LEVELS) {
              const key = `${methodId}:${learningMode}:${estimatedMinutes}`;
              if (checked.has(key)) continue;
              checked.add(key);
              const requiredPhases = methodFidelityContractForPrompt(methodId, learningMode).requiredPhases;
              const baseline = buildSessionDeliveryPolicy({
                learnerProfile: { functionalSupportNeed: "Shorter sections with frequent check-ins" },
                recentResults: noResults,
                recentInterruptions: noInterruptions,
                learningMode,
                estimatedMinutes,
              });
              const reconciled = reconcileSessionDeliveryPolicyWithMethodRecipe({
                policy: baseline,
                methodId,
                learningMode,
              });
              const requiredFocusedActivities = requiredPhases.filter((phase) => phase !== "schedule_return").length;

              expect(requiredPhases.length, `${key} minimum active minutes`).toBeLessThanOrEqual(estimatedMinutes);
              expect(reconciled.pacing.maximumActivities, `${key} required focused phases`)
                .toBeGreaterThanOrEqual(requiredFocusedActivities);
              expect(reconciled.pacing.maximumActivities, `${key} renderer ceiling`).toBeLessThanOrEqual(8);
              expect(reconciled.learnerFacingReasons).toEqual(baseline.learnerFacingReasons);
              expect(reconciled.signalsUsed).toEqual(baseline.signalsUsed);
            }
          }
        }
      }
    }
  });

  it.each([
    ["concept_mapping", 5],
    ["read_recall_review", 6],
  ] as const)("lets the immutable %s Learn recipe outrank a shorter-section transition cap", (methodId, expectedMaximum) => {
    for (const estimatedMinutes of [10, 15] as const) {
      const policy = buildSessionDeliveryPolicy({
        learnerProfile: { functionalSupportNeed: "Shorter sections with frequent check-ins" },
        recentResults: noResults,
        recentInterruptions: noInterruptions,
        learningMode: "learn",
        estimatedMinutes,
      });
      const reconciled = reconcileSessionDeliveryPolicyWithMethodRecipe({
        policy,
        methodId,
        learningMode: "learn",
      });

      expect(policy.pacing.maximumActivities).toBe(3);
      expect(reconciled.pacing.maximumActivities).toBe(expectedMaximum);
      expect(reconciled.pacing.reason).toContain(`${expectedMaximum} distinct evidence phases`);
    }
  });

  it("applies every delivery-policy decision to its declared field", () => {
    const examples = {
      first_action: "small_active_start",
      path_visibility: "current_and_next",
      activity_cadence: "short_active_rounds",
      knowledge_check: "closed_note_first",
      confidence_check: "show_success_evidence",
      attempt_safety: "private_revisable_attempt",
      block_length: "shorter_rounds",
      presentation: "overview_first",
      retention: "transfer",
      first_repair: "hint_first",
      layout: "one_step",
    } as const satisfies Record<DeliveryPolicyDecisionSetting, string>;
    const baseline = buildSessionDeliveryPolicy({
      learnerProfile: null,
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });

    for (const [setting, value] of Object.entries(examples) as Array<
      [keyof typeof examples, (typeof examples)[keyof typeof examples]]
    >) {
      const route = PERSONALIZATION_DECISION_CHANNELS[setting];
      expect(route.channel).toBe("delivery_policy");
      if (route.channel !== "delivery_policy") continue;
      const personalized = buildSessionDeliveryPolicy({
        learnerProfile: null,
        recentResults: noResults,
        recentInterruptions: noInterruptions,
        learningMode: "learn",
        estimatedMinutes: 30,
        personalizationDecisions: [personalizationDecision(setting, value)],
      });

      expect(
        personalized[route.deliveryPolicyField],
        `${setting} must change ${route.deliveryPolicyField}`,
      ).not.toEqual(baseline[route.deliveryPolicyField]);
    }
  });

  it("does not send visual decisions through the lesson delivery policy", () => {
    const baseline = buildSessionDeliveryPolicy({
      learnerProfile: null,
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });
    const withVisualDecisions = buildSessionDeliveryPolicy({
      learnerProfile: null,
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
      personalizationDecisions: [
        personalizationDecision("text_density", "reduced"),
        personalizationDecision("motion", "reduced"),
        personalizationDecision("visual_structure", "more"),
        personalizationDecision("check_ins", "more"),
      ],
    });

    expect(withVisualDecisions).toEqual(baseline);
  });

  it("fills the new teaching channels when reading a legacy policy", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: null,
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });
    const legacyPolicy = Object.fromEntries(
      Object.entries(policy).filter(([key]) => ![
        "activityCadence",
        "attemptSafety",
        "knowledgeCheck",
      ].includes(key)),
    );

    expect(SessionDeliveryPolicySchema.parse(legacyPolicy)).toMatchObject({
      activityCadence: { mode: "task_aligned" },
      attemptSafety: { mode: "task_aligned" },
      knowledgeCheck: { mode: "task_aligned" },
    });
  });

  it("keeps streamed lesson delivery bounded to explicit learner preferences", () => {
    const learnerProfile = {
      processingPreference: "A concrete example before the rule",
      explanationPreference: "Keep explanations concise",
    };
    const outcomeDrivenPolicy = buildSessionDeliveryPolicy({
      learnerProfile,
      recentResults: noResults,
      recentInterruptions: [
        { plannedMinutes: 30, actualMinutes: 8, completedSteps: 1, totalSteps: 5 },
        { plannedMinutes: 30, actualMinutes: 10, completedSteps: 2, totalSteps: 5 },
      ],
      learningMode: "learn",
      estimatedMinutes: 30,
    });
    const streamed = buildStatedPreferenceLessonDelivery({
      learnerProfile,
      estimatedMinutes: 30,
      taskType: "conceptual_learning",
    });

    expect(outcomeDrivenPolicy.evidenceStatus).toBe("blended");
    expect(outcomeDrivenPolicy.learnerFacingReasons.join(" ")).toContain("pacing adjustment");
    expect(streamed.policy.evidenceStatus).toBe("starting_hypothesis");
    expect(streamed.policy.signalsUsed).toEqual(["A concrete example before the rule"]);
    expect(streamed.instructions.explanationDensity).toBe("concise");
    expect(streamed.policy.learnerFacingReasons.join(" ")).not.toContain("pacing adjustment");
    expect(streamed.instructions.learnerContext.join(" ")).not.toContain("pacing adjustment");
  });

  it("turns preferences into bounded delivery instructions without declaring a learning style", () => {
    const learnerProfile = {
      explanationPreference: "Keep explanations concise",
      processingPreference: "A concrete example before the rule",
      guidancePreference: "Show one step at a time",
    };
    const policy = buildSessionDeliveryPolicy({
      learnerProfile,
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });
    const instructions = buildLessonDeliveryInstructions({
      policy,
      learnerProfile,
      taskType: "conceptual_learning",
    });

    expect(instructions.explanationDensity).toBe("concise");
    expect(instructions.contentRequirements).toMatchObject({
      coverAllEssentialIdeas: true,
      includeCommonMixup: true,
      preservePrerequisiteOrder: true,
    });
    expect(instructions.learnerContext.join(" ")).not.toMatch(/brain type|learns best/i);
  });

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

  it("turns a practical support need into concrete presentation and workspace changes", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        functionalSupportNeed: "Less text and more visual structure",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 25,
    });

    expect(policy.presentation.mode).toBe("overview_first");
    expect(policy.workspace.mode).toBe("one_step");
    expect(policy.evidenceStatus).toBe("starting_hypothesis");
    expect(policy.signalsUsed).toContain("Less text and more visual structure");
  });

  it("turns a concise explanation request into a visible delivery decision", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        explanationPreference: "Keep grammar explanations concise and tied to speech",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 20,
    });

    expect(policy.presentation.label).toBe("Concise explanation");
    expect(policy.presentation.instruction).toContain("tie every rule to the action");
    expect(policy.learnerFacingReasons.join(" ")).toContain("concise explanations");
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

  it("does not count the future-return marker as another focused activity", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: { memoryChallenge: "I forget it after a few days" },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 15,
    });
    const issue = validateSessionDeliveryPolicy({
      policy,
      learningMode: "learn",
      activities: [
        { methodPhase: "model", type: "instruction", estimatedMinutes: 4, teaching: { example: null, commonMistake: null } },
        { methodPhase: "guided_practice", type: "multiple_choice", estimatedMinutes: 3, teaching: null },
        { methodPhase: "independent_practice", type: "free_response", estimatedMinutes: 3, teaching: null },
        { methodPhase: "reflect", type: "reflection", estimatedMinutes: 1, teaching: null },
        { methodPhase: "schedule_return", type: "reflection", estimatedMinutes: 1, teaching: null },
      ],
    });

    expect(policy.pacing.maximumActivities).toBe(4);
    expect(issue).toBeNull();
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

  it("allows a five-minute opening when a small first action is only a starting hypothesis", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        commonBlocker: "Vague writing tasks feel overwhelming",
        startingPattern: "Starts after the task is narrowed",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });
    const issue = validateSessionDeliveryPolicy({
      policy,
      learningMode: "learn",
      activities: [
        {
          methodPhase: "model",
          type: "instruction",
          estimatedMinutes: 5,
          teaching: {
            example: { steps: ["Open the source", "Choose evidence", "Draft the first claim"] },
            commonMistake: null,
          },
        },
        { methodPhase: "guided_practice", type: "multiple_choice", estimatedMinutes: 4, teaching: null },
        { methodPhase: "independent_practice", type: "free_response", estimatedMinutes: 5, teaching: null },
      ],
    });

    expect(policy.pacing.firstActionMinutes).toBe(2);
    expect(issue).toBeNull();
  });

  it("still rejects a long opening block when the learner needs an easy start", () => {
    const policy = buildSessionDeliveryPolicy({
      learnerProfile: {
        commonBlocker: "Vague writing tasks feel overwhelming",
        startingPattern: "Starts after the task is narrowed",
      },
      recentResults: noResults,
      recentInterruptions: noInterruptions,
      learningMode: "learn",
      estimatedMinutes: 30,
    });
    const issue = validateSessionDeliveryPolicy({
      policy,
      learningMode: "learn",
      activities: [
        {
          methodPhase: "model",
          type: "instruction",
          estimatedMinutes: 6,
          teaching: {
            example: { steps: ["Open the source", "Choose evidence", "Draft the first claim"] },
            commonMistake: null,
          },
        },
        { methodPhase: "guided_practice", type: "multiple_choice", estimatedMinutes: 4, teaching: null },
        { methodPhase: "independent_practice", type: "free_response", estimatedMinutes: 5, teaching: null },
      ],
    });

    expect(issue).toContain("no more than 5 minutes");
  });
});

function personalizationDecision(
  setting: PersonalizationDecisionSetting,
  value: string,
): PersonalizationDecision {
  return {
    id: `decision:test:${setting}`,
    artifact: "method_delivery",
    setting,
    value,
    title: `Use ${value.replaceAll("_", " ")}`,
    explanation: `Apply ${value.replaceAll("_", " ")} to this session while preserving the learning target.`,
    signalIds: [`signal:test:${setting}`],
    evidenceLabel: "You told YOVA",
    methodCandidates: [],
    experimental: false,
  };
}

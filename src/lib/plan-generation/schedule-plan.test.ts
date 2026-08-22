import { describe, expect, it } from "vitest";
import {
  alignGeneratedPlanToAvailability,
  PlanScheduleCapacityError,
} from "@/lib/plan-generation/schedule-plan";
import {
  GeneratedPlanDraftSchema,
  PlanGenerationRequestSchema,
} from "@/lib/plan-generation/schema";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";

const request = PlanGenerationRequestSchema.parse({
  intent: "plan",
  learningIntent: "learn",
  goal: "Prepare for a World War I unit test from the beginning.",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: "2026-08-24T23:59:00.000-07:00",
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [],
  availability: [
    { day: "Monday", window: "Evening", minutes: 15 },
    { day: "Wednesday", window: "Evening", minutes: 15 },
    { day: "Saturday", window: "Morning", minutes: 15 },
  ],
  profileSummary: "The learner wants the big picture first and uses short sessions.",
});

const draft = GeneratedPlanDraftSchema.parse({
  title: "World War I Study Plan",
  topic: "The causes, course, and consequences of World War I",
  kind: "test",
  deadline: request.deadline,
  rationale: "Build the overall map, teach each major relationship, and then retrieve and apply it.",
  deferredTopics: [],
  sessions: Array.from({ length: 5 }, (_, index) => ({
    title: `Session ${index + 1}`,
    objective: `Build and explain the bounded World War I relationship for session ${index + 1}.`,
    method: index < 3 ? "Self-explanation" : "Retrieval practice",
    methodReason: "This sequence establishes the model before checking independent recall.",
    scheduledFor: "2026-08-09T12:00:00.000Z",
    estimatedMinutes: 15,
    amountLabel: "One focused target and one evidence check",
    learningMode: index < 3 ? "learn" : "study",
    topicIds: [TOPIC_ID],
    contentTargets: [`World War I target ${index + 1}`],
    completionEvidence: [`Explain World War I target ${index + 1} without copying the model`],
  })),
});

describe("plan schedule alignment", () => {
  it("maps the instructional sequence onto the learner's chosen days and windows", () => {
    const aligned = alignGeneratedPlanToAvailability(
      draft,
      request,
      new Date("2026-08-08T12:00:00.000-07:00"),
    );
    const formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      hour: "numeric",
      timeZone: request.timeZone,
    });

    expect(aligned.sessions.map((session) => formatter.format(new Date(session.scheduledFor)))).toEqual([
      "Monday 7 PM",
      "Wednesday 7 PM",
      "Saturday 9 AM",
      "Monday 7 PM",
      "Wednesday 7 PM",
    ]);
  });

  it("schedules study-now work immediately", () => {
    const now = new Date("2026-08-08T20:15:00.000Z");
    const aligned = alignGeneratedPlanToAvailability(draft, {
      ...request,
      intent: "study_now",
      availability: [{ day: "Saturday", window: "Now", minutes: 15 }],
      deadline: null,
    }, now);

    expect(aligned.sessions[0].scheduledFor).toBe(now.toISOString());
  });

  it("packs short connected lessons back-to-back without exceeding the day's total window", () => {
    const shortDraft = {
      ...draft,
      sessions: draft.sessions.slice(0, 2).map((session, index) => ({
        ...session,
        estimatedMinutes: index === 0 ? 7 : 8,
      })),
    };
    const aligned = alignGeneratedPlanToAvailability(
      shortDraft,
      request,
      new Date("2026-08-08T12:00:00.000-07:00"),
    );

    expect(new Date(aligned.sessions[1].scheduledFor).getTime() - new Date(aligned.sessions[0].scheduledFor).getTime()).toBe(7 * 60_000);
  });

  it("fails closed when the complete sequence cannot fit before the deadline", () => {
    expect(() => alignGeneratedPlanToAvailability(
      draft,
      {
        ...request,
        deadline: "2026-08-09T23:59:00.000-07:00",
        availability: [{ day: "Monday", window: "Evening", minutes: 15 }],
      },
      new Date("2026-08-08T12:00:00.000-07:00"),
    )).toThrow(PlanScheduleCapacityError);
  });

  it("does not let a session run beyond the learner's deadline", () => {
    const oneSession = {
      ...draft,
      sessions: [{ ...draft.sessions[0], estimatedMinutes: 15 }],
    };

    expect(() => alignGeneratedPlanToAvailability(
      oneSession,
      {
        ...request,
        deadline: "2026-08-10T19:10:00.000-07:00",
        availability: [{ day: "Monday", window: "Evening", minutes: 15 }],
      },
      new Date("2026-08-08T12:00:00.000-07:00"),
    )).toThrow(PlanScheduleCapacityError);
  });
});

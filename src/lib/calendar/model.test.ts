import { describe, expect, it } from "vitest";
import type { DeadlineMilestone, LearningPlan, LearningPlanSession } from "@/lib/domain";
import { emptyCalendarPrototypeState } from "@/lib/calendar/persistence";
import {
  calendarPersonalizationReasons,
  deriveCalendarModel,
  previewCourseSeedsForEmptyState,
} from "@/lib/calendar/model";
import type { CalendarPrototypeState } from "@/lib/calendar/types";
import { createCanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import { writeCanonicalLearnerProfileToAnswers } from "@/lib/personalization/canonical-profile-storage";
import {
  setPersonalizationControl,
  updatePersonalizationStateInAnswers,
} from "@/lib/personalization/personalization-state";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";

const NOW = new Date("2026-09-02T12:00:00.000Z");

function session(
  id: string,
  scheduledFor: string,
  minutes: number,
  status: LearningPlanSession["status"] = "upcoming",
  sequence = 1,
): LearningPlanSession {
  return {
    id,
    sequence,
    title: `Session ${id}`,
    objective: "Produce observable evidence for the target.",
    method: "Retrieval practice",
    methodReason: "This method matches the current task and evidence stage.",
    scheduledFor,
    estimatedMinutes: minutes,
    amountLabel: `${minutes} minutes`,
    learningMode: "study",
    topicIds: [],
    contentTargets: ["Explain the target accurately"],
    completionEvidence: ["Explain the target without support"],
    status,
  };
}

function plan(id: string, sessions: LearningPlanSession[], deadline = "2026-09-05T23:59:59.000Z"): LearningPlan {
  return {
    id,
    learningItemId: `item-${id}`,
    title: `Plan ${id}`,
    topic: `Topic ${id}`,
    kind: "test",
    deadline,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    rationale: "Preserve the learning sequence before the deadline.",
    createdAt: "2026-09-01T10:00:00.000Z",
    sessions,
  };
}

function milestone(id: string): DeadlineMilestone {
  return {
    id,
    title: "Unplanned paper",
    description: "Submit the final paper",
    dueAt: "2026-09-04T23:59:59.000Z",
    status: "open",
    linkedLearningItemId: null,
    createdAt: "2026-09-01T10:00:00.000Z",
  };
}

function issueState(): CalendarPrototypeState {
  const base = emptyCalendarPrototypeState("account", NOW);
  return {
    ...base,
    manualEvents: [
      {
        id: "fixed-a",
        title: "Communications seminar",
        eventType: "class",
        startsAt: "2026-09-03T14:00:00.000Z",
        endsAt: "2026-09-03T15:30:00.000Z",
        dueAt: null,
        fixed: true,
        done: false,
        courseId: null,
        courseLabel: "Communications",
        outcomeId: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      {
        id: "fixed-b",
        title: "Public Speaking class",
        eventType: "class",
        startsAt: "2026-09-03T15:00:00.000Z",
        endsAt: "2026-09-03T16:00:00.000Z",
        dueAt: null,
        fixed: true,
        done: false,
        courseId: null,
        courseLabel: "Public Speaking",
        outcomeId: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ],
    suggestions: [{
      id: "suggestion",
      title: "Move source retrieval",
      startsAt: "2026-09-03T18:00:00.000Z",
      durationMinutes: 25,
      planId: null,
      planSessionId: null,
      courseId: null,
      outcomeId: null,
      status: "pending",
      flexibility: "movable",
      reason: {
        text: "This avoids the fixed afternoon classes while keeping the deadline protected.",
        source: "suggestion",
        evidenceRefs: ["fixed-a", "fixed-b"],
      },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }],
    availabilityOverrides: [{
      dateKey: "2026-09-02",
      availableMinutes: 20,
      reason: "You said only twenty minutes are available on Wednesday.",
      updatedAt: NOW.toISOString(),
    }],
  };
}

describe("calendar derived model", () => {
  it("projects authoritative plan sessions with readable placement and method reasons", () => {
    const learningPlan = plan("history", [session("history-1", "2026-09-03T17:00:00.000Z", 25, "ready")]);
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [],
      localState: emptyCalendarPrototypeState("account", NOW),
      now: NOW,
      timeZone: "UTC",
    });
    const block = model.blocks.find((item) => item.source === "plan_session");

    expect(block).toMatchObject({
      source: "plan_session",
      blockType: "yova",
      courseId: "item-history",
      methodReason: "This method matches the current task and evidence stage.",
      placementReason: {
        source: "plan_sequence",
        evidenceRefs: ["history", "history-1", learningPlan.deadline],
      },
    });
    expect(block && "placementReason" in block ? block.placementReason.text : "").toMatch(/session 1 of 1/i);
  });

  it("projects method, mode, and active time from one stored StudyRoute authority", () => {
    const authoritative = session("route-authority", "2026-09-03T17:00:00.000Z", 45, "ready");
    authoritative.method = "Self-explanation";
    authoritative.methodReason = "Teach the causal model, explain it, repair it, then transfer it.";
    authoritative.learningMode = "learn";
    const learningPlan = plan("route-authority", [authoritative]);
    learningPlan.learningIntent = "learn";
    const route = adaptLegacySessionToStudyRoute({ plan: learningPlan, session: authoritative }).route;
    expect(route).not.toBeNull();

    const driftedScalar = {
      ...authoritative,
      method: "Retrieval practice",
      methodReason: "Stale scalar reason",
      estimatedMinutes: 15,
      learningMode: "study" as const,
      studyRoute: route!,
    };
    const model = deriveCalendarModel({
      plans: [{ ...learningPlan, sessions: [driftedScalar] }],
      milestones: [],
      localState: emptyCalendarPrototypeState("account", NOW),
      now: NOW,
      timeZone: "UTC",
    });
    const block = model.blocks.find((item) => item.source === "plan_session");

    expect(block).toMatchObject({
      methodName: "Self-explanation",
      methodReason: "Teach the causal model, explain it, repair it, then transfer it.",
      learningMode: "learn",
    });
    expect(block && Date.parse(block.endsAt) - Date.parse(block.startsAt)).toBe(45 * 60_000);
  });

  it("does not claim an after-deadline session ends before the deadline", () => {
    const learningPlan = plan(
      "late",
      [session("late-1", "2026-09-06T17:00:00.000Z", 25, "ready")],
      "2026-09-05T23:59:59.000Z",
    );
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [],
      localState: emptyCalendarPrototypeState("account", NOW),
      now: NOW,
      timeZone: "UTC",
    });
    const block = model.blocks.find((item) => item.source === "plan_session");
    const reason = block && "placementReason" in block ? block.placementReason.text : "";

    expect(reason).toMatch(/currently ends after/i);
    expect(reason).not.toMatch(/ends before/i);
  });

  it("uses a linked milestone due time as Calendar placement and capacity authority", () => {
    const learningPlan = plan(
      "linked-deadline",
      [session("linked-deadline-1", "2026-09-04T17:00:00.000Z", 25, "ready")],
      "2026-09-10T23:59:59.000Z",
    );
    const linkedMilestone: DeadlineMilestone = {
      id: "linked-milestone",
      title: "History exam",
      description: "The corrected registrar deadline.",
      dueAt: "2026-09-03T18:00:00.000Z",
      status: "open",
      linkedLearningItemId: learningPlan.learningItemId,
      createdAt: "2026-09-01T10:00:00.000Z",
    };
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [linkedMilestone],
      localState: emptyCalendarPrototypeState("account", NOW),
      now: NOW,
      timeZone: "UTC",
    });
    const block = model.blocks.find((item) => item.source === "plan_session");
    const reason = block && "placementReason" in block ? block.placementReason : null;

    expect(reason).toMatchObject({
      source: "plan_sequence",
      evidenceRefs: [learningPlan.id, "linked-deadline-1", linkedMilestone.dueAt],
    });
    expect(reason?.text).toMatch(/currently ends after the Sep 3 deadline/i);
    expect(model.issues).toContainEqual(expect.objectContaining({
      kind: "deadline_capacity_gap",
      action: { kind: "fit_into_week", label: "Review plan timing", targetId: learningPlan.id },
    }));
    expect(model.outcomes).toContainEqual(expect.objectContaining({
      planId: learningPlan.id,
      milestoneId: linkedMilestone.id,
      dueAt: linkedMilestone.dueAt,
      status: "at_risk",
    }));
  });

  it("flags fixed local commitments against YOVA work and excludes free blocks from planned load", () => {
    const learningPlan = plan("commitment", [
      session("commitment-1", "2026-09-03T14:30:00.000Z", 25, "ready"),
    ]);
    const base = emptyCalendarPrototypeState("account", NOW);
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [],
      localState: {
        ...base,
        manualEvents: [{
          id: "class",
          title: "Communications seminar",
          eventType: "class",
          startsAt: "2026-09-03T14:00:00.000Z",
          endsAt: "2026-09-03T15:00:00.000Z",
          dueAt: null,
          fixed: true,
          done: false,
          courseId: null,
          courseLabel: "Communications",
          outcomeId: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        }, {
          id: "free",
          title: "Open study window",
          eventType: "free_block",
          startsAt: "2026-09-03T16:00:00.000Z",
          endsAt: "2026-09-03T17:00:00.000Z",
          dueAt: null,
          fixed: false,
          done: false,
          courseId: null,
          courseLabel: null,
          outcomeId: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        }],
      },
      now: NOW,
      timeZone: "UTC",
    });

    expect(model.issues).toContainEqual(expect.objectContaining({
      kind: "fixed_event_conflict",
      title: "Communications seminar conflicts with Session commitment-1",
      reason: expect.stringMatching(/is fixed and overlaps YOVA work/i),
      action: {
        kind: "resolve_conflict",
        label: "Resolve conflict",
        targetId: "plan-session:commitment-1",
      },
    }));
    expect(model.dayLoads.find((load) => load.dateKey === "2026-09-03")).toMatchObject({
      plannedMinutes: 25,
      fixedMinutes: 60,
      overloaded: false,
    });
  });

  it("derives every supported attention kind from real input rather than hard-coded rows", () => {
    const crowded = plan("crowded", [
      session("crowded-ready", "2026-09-02T13:00:00.000Z", 60, "ready"),
      session("late", "2026-09-06T13:00:00.000Z", 30, "upcoming", 2),
    ], "2026-09-05T12:00:00.000Z");
    crowded.knowledgeMap = {
      version: 1,
      scopeJudgment: {
        band: "unit_or_exam",
        label: "A bounded unit",
        minimumSessions: 1,
        recommendedSessions: 2,
        maximumSessions: 4,
        minimumTeachingSessions: 0,
        explanation: "The accepted scope requires multiple evidence-producing sessions.",
      },
      placementCheck: {
        status: "skipped",
        completedAt: null,
        demonstratedTopicIds: [],
        gapTopicIds: [],
      },
      topics: [{
        id: "10000000-1000-4000-8000-000000000001",
        title: "Deferred causation",
        description: "Explain the deferred causal relationship accurately.",
        subtopics: [],
        prerequisiteTopicIds: [],
        status: "not_started",
        initialEvidence: null,
        sourceReferences: [],
        origin: "ai_generated",
        deferred: { reason: "The current deadline cannot fit this topic safely." },
      }],
    };
    const missed = plan("missed", [session("missed-ready", "2026-09-01T01:00:00.000Z", 20, "ready")]);
    const model = deriveCalendarModel({
      plans: [crowded, missed],
      milestones: [milestone("paper")],
      localState: issueState(),
      materials: [{ id: "bad-material", name: "syllabus.pdf", processingStatus: "failed", learningItemId: null }],
      importedItems: [{ id: "import", title: "IR reading", dueAt: null, status: "pending", sourceLabel: "Imported syllabus" }],
      now: NOW,
      timeZone: "UTC",
    });

    expect(new Set(model.issues.map((issue) => issue.kind))).toEqual(new Set([
      "assignment_without_plan",
      "deadline_capacity_gap",
      "overloaded_day",
      "missed_unrescheduled_session",
      "material_failed",
      "flexible_block_pending",
      "imported_item_pending",
      "fixed_event_conflict",
      "deferred_content_unscheduled",
    ]));
    expect(model.issues.every((issue) => issue.reason.length >= 8 && issue.action.label.length > 0)).toBe(true);
  });

  it("raises a review action only for failed material lifecycle rows", () => {
    const learningPlan = plan("materials", [
      session("materials-ready", "2026-09-03T13:00:00.000Z", 25, "ready"),
    ]);
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [],
      localState: emptyCalendarPrototypeState("account", NOW),
      materials: [
        { id: "ready", name: "ready.pdf", processingStatus: "ready", learningItemId: learningPlan.learningItemId },
        { id: "processing", name: "mapping.pdf", processingStatus: "processing", learningItemId: learningPlan.learningItemId },
        { id: "failed", name: "broken.pdf", processingStatus: "failed", learningItemId: learningPlan.learningItemId },
      ],
      now: NOW,
      timeZone: "UTC",
    });

    expect(model.issues.filter((issue) => issue.kind === "material_failed")).toEqual([{
      id: "material-failed:failed",
      kind: "material_failed",
      severity: "warning",
      title: "broken.pdf did not process",
      reason: "YOVA cannot use this material to ground a plan or session until processing succeeds.",
      action: { kind: "retry_material", label: "Review material", targetId: "failed" },
    }]);
  });

  it("uses only the bounded outcome vocabulary and never creates numeric risk scores", () => {
    const learningPlan = plan("ir", [
      session("done", "2026-09-01T10:00:00.000Z", 20, "complete"),
      session("next", "2026-09-03T10:00:00.000Z", 20, "ready", 2),
    ]);
    const model = deriveCalendarModel({
      plans: [learningPlan],
      milestones: [],
      localState: emptyCalendarPrototypeState("account", NOW),
      now: NOW,
      timeZone: "UTC",
    });

    expect(model.outcomes).toHaveLength(1);
    expect(["on_track", "needs_planning", "at_risk", "ready", "complete"]).toContain(model.outcomes[0]!.status);
    expect(JSON.stringify(model.outcomes)).not.toMatch(/riskScore|preparedPercent|% prepared/i);
    expect(model.outcomes[0]).toMatchObject({ totalBlocks: 2, doneBlocks: 1 });
  });

  it("keeps a quick-added tonight block connected to its later due outcome", () => {
    const base = emptyCalendarPrototypeState("account", NOW);
    const model = deriveCalendarModel({
      plans: [],
      milestones: [],
      localState: {
        ...base,
        manualEvents: [{
          id: "pset",
          title: "Stats Pset",
          eventType: "deadline",
          startsAt: "2026-09-02T19:00:00.000Z",
          endsAt: "2026-09-02T20:30:00.000Z",
          dueAt: "2026-09-04T23:59:59.999Z",
          fixed: false,
          done: false,
          courseId: null,
          courseLabel: "Stats",
          outcomeId: "stats-pset-outcome",
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        }],
      },
      now: NOW,
      timeZone: "UTC",
    });

    expect(model.blocks.find((block) => block.id === "manual:pset")?.startsAt)
      .toBe("2026-09-02T19:00:00.000Z");
    expect(model.outcomes.find((outcome) => outcome.id === "stats-pset-outcome"))
      .toMatchObject({ dueAt: "2026-09-04T23:59:59.999Z", manualEventId: "pset" });
  });

  it("flags a manually added deadline until preparation work or a plan is linked", () => {
    const state = emptyCalendarPrototypeState("account", NOW);
    const model = deriveCalendarModel({
      plans: [],
      milestones: [],
      localState: {
        ...state,
        manualEvents: [{
          id: "speech-due",
          title: "Persuasive speech",
          eventType: "deadline",
          startsAt: "2026-09-04T19:00:00.000Z",
          endsAt: "2026-09-04T19:30:00.000Z",
          dueAt: "2026-09-05T10:00:00.000Z",
          fixed: false,
          done: false,
          courseId: null,
          courseLabel: "Public Speaking",
          outcomeId: null,
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        }],
      },
      now: NOW,
      timeZone: "UTC",
    });

    expect(model.issues).toContainEqual(expect.objectContaining({
      kind: "assignment_without_plan",
      title: "Persuasive speech has no preparation plan",
      action: {
        kind: "build_plan",
        label: "Build plan",
        targetId: "outcome:manual:speech-due",
      },
    }));
  });

  it("builds calendar explanations from canonical signals and bounded behavior evidence", () => {
    const profile = createCanonicalLearnerProfile([
      { signalId: "preferred_working_period", value: "evening", source: "canonical_questionnaire", sourceQuestionId: "working-period", provenance: "direct_answer" },
      { signalId: "realistic_session_length", value: "minutes_20_30", source: "canonical_questionnaire", sourceQuestionId: "session-length", provenance: "direct_answer" },
      { signalId: "focus_pacing", value: "clear_checkpoints", source: "canonical_questionnaire", sourceQuestionId: "focus-pacing", provenance: "direct_answer" },
      { signalId: "starting_friction", value: "unclear_first_step", source: "canonical_questionnaire", sourceQuestionId: "starting-friction", provenance: "direct_answer" },
    ]);
    const answers = writeCanonicalLearnerProfileToAnswers([], profile);
    const reasons = calendarPersonalizationReasons({
      answers,
      completions: [1, 2].map((index) => ({
        id: `completion-${index}`,
        planId: "plan",
        planSessionId: `session-${index}`,
        startedAt: `2026-09-0${index}T18:00:00.000Z`,
        completedAt: `2026-09-0${index}T18:25:00.000Z`,
        plannedMinutes: 30,
        actualMinutes: 24,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right" as const,
        observedGap: "No major gap",
        conceptEvidence: [],
        confidenceEvidence: [],
      })),
      interruptions: [1, 2].map((index) => ({
        id: `interruption-${index}`,
        planId: "plan",
        planSessionId: `interrupted-${index}`,
        startedAt: `2026-08-2${index}T18:00:00.000Z`,
        interruptedAt: `2026-08-2${index}T18:05:00.000Z`,
        plannedMinutes: 30,
        actualMinutes: 5,
        completedSteps: 1,
        totalSteps: 5,
      })),
      now: NOW,
      timeZone: "UTC",
    });

    expect(reasons.map((reason) => reason.source)).toEqual(expect.arrayContaining([
      "learner_profile",
      "completion_history",
    ]));
    expect(reasons.some((reason) => reason.evidenceRefs.includes("signal:preferred_working_period:working-period"))).toBe(true);
    expect(reasons.some((reason) => reason.evidenceRefs.includes("completion-1"))).toBe(true);
    expect(reasons.every((reason) => !/personalized for you/i.test(reason.text))).toBe(true);
  });

  it("does not surface profile or behavior reasons when the learner disabled those controls", () => {
    const profile = createCanonicalLearnerProfile([
      { signalId: "preferred_working_period", value: "evening", source: "canonical_questionnaire", sourceQuestionId: "working-period", provenance: "direct_answer" },
    ]);
    let answers = writeCanonicalLearnerProfileToAnswers([], profile);
    answers = updatePersonalizationStateInAnswers(answers, (state) => (
      setPersonalizationControl(
        setPersonalizationControl(state, "selfReport", false, "2026-09-02T10:00:00.000Z"),
        "behavior",
        false,
        "2026-09-02T10:01:00.000Z",
      )
    ));

    const reasons = calendarPersonalizationReasons({
      answers,
      completions: [{
        id: "completion-private",
        planId: "plan",
        planSessionId: "session",
        startedAt: "2026-09-01T18:00:00.000Z",
        completedAt: "2026-09-01T18:25:00.000Z",
        plannedMinutes: 30,
        actualMinutes: 24,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right",
        observedGap: "No major gap",
        conceptEvidence: [],
        confidenceEvidence: [],
      }, {
        id: "completion-private-2",
        planId: "plan",
        planSessionId: "session-2",
        startedAt: "2026-08-31T18:00:00.000Z",
        completedAt: "2026-08-31T18:25:00.000Z",
        plannedMinutes: 30,
        actualMinutes: 24,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right",
        observedGap: "No major gap",
        conceptEvidence: [],
        confidenceEvidence: [],
      }],
      interruptions: [],
      now: NOW,
      timeZone: "UTC",
    });

    expect(reasons).toEqual([]);
  });

  it("honors paused signals, corrections, excluded receipts, and the timing control", () => {
    const profile = createCanonicalLearnerProfile([
      { signalId: "preferred_working_period", value: "evening", source: "canonical_questionnaire", sourceQuestionId: "working-period", provenance: "direct_answer" },
      { signalId: "focus_pacing", value: "clear_checkpoints", source: "canonical_questionnaire", sourceQuestionId: "focus-pacing", provenance: "direct_answer" },
    ]);
    let answers = writeCanonicalLearnerProfileToAnswers([], profile);
    answers = updatePersonalizationStateInAnswers(answers, (state) => ({
      ...state,
      controls: { ...state.controls, timing: false },
      pausedSignalIds: ["signal:preferred_working_period"],
      excludedEvidenceRefs: ["completion-1", "completion-2", "interruption-1", "interruption-2"],
      corrections: [{
        signalId: "signal:focus_pacing",
        correctedValue: "Shorter blocks",
        note: "The old checkpoint preference is no longer accurate.",
        doNotInfer: true,
        updatedAt: "2026-09-02T10:00:00.000Z",
      }],
    }));

    const reasons = calendarPersonalizationReasons({
      answers,
      completions: [1, 2].map((index) => ({
        id: `completion-${index}`,
        planId: "plan",
        planSessionId: `session-${index}`,
        startedAt: `2026-09-0${index}T18:00:00.000Z`,
        completedAt: `2026-09-0${index}T18:20:00.000Z`,
        plannedMinutes: 30,
        actualMinutes: 20,
        correctAnswers: 1,
        totalAnswers: 1,
        feedback: "about_right" as const,
        observedGap: "No major gap",
        conceptEvidence: [],
        confidenceEvidence: [],
      })),
      interruptions: [1, 2].map((index) => ({
        id: `interruption-${index}`,
        planId: "plan",
        planSessionId: `interrupted-${index}`,
        startedAt: `2026-08-2${index}T18:00:00.000Z`,
        interruptedAt: `2026-08-2${index}T18:05:00.000Z`,
        plannedMinutes: 30,
        actualMinutes: 5,
        completedSteps: 1,
        totalSteps: 5,
      })),
      now: NOW,
      timeZone: "UTC",
    });

    expect(reasons).toEqual([]);
  });

  it("exposes the four course labels only for a truly empty preview", () => {
    expect(previewCourseSeedsForEmptyState({
      previewMode: true,
      authoritativePlanCount: 0,
      manualEventCount: 0,
    }).map((course) => course.label)).toEqual([
      "World History",
      "Communications",
      "Public Speaking",
      "International Relations",
    ]);
    expect(previewCourseSeedsForEmptyState({
      previewMode: false,
      authoritativePlanCount: 0,
      manualEventCount: 0,
    })).toEqual([]);
    expect(previewCourseSeedsForEmptyState({
      previewMode: true,
      authoritativePlanCount: 1,
      manualEventCount: 0,
    })).toEqual([]);
  });
});

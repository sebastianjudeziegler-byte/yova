import { describe, expect, it } from "vitest";
import type {
  LearningPlan,
  LearningPlanSession,
  SessionCompletion,
} from "@/lib/domain";
import { selectCanonicalStudyMethod } from "@/lib/learning/canonical-method-selection";
import {
  defaultPersonalizationState,
  writePersonalizationStateToAnswers,
} from "@/lib/personalization/personalization-state";
import { adaptLegacySessionToStudyRoute } from "@/lib/study-route/adapters";
import {
  buildAuthorizedMethodDecisionEvidence,
  METHOD_DECISION_MAX_SESSIONS_PER_METHOD,
} from "@/lib/study-route/method-decision-evidence";
import { commitStudyRouteRevision } from "@/lib/study-route/revisions";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const PLAN_ID = uuid(1);
const NOW = new Date("2026-08-24T12:00:00.000Z");

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function evidencePlan(count = 4) {
  const sessions = Array.from({ length: count }, (_, index): LearningPlanSession => ({
    id: uuid(100 + index),
    sequence: index + 1,
    title: `Retrieve biology terms ${index + 1}`,
    objective: "Recall the biology vocabulary and distinguish similar definitions.",
    method: "Spaced retrieval",
    methodReason: "Return after a delay and retrieve each definition before checking.",
    scheduledFor: `2026-08-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
    estimatedMinutes: 15,
    amountLabel: "Focused session · about 15 min",
    learningMode: "study",
    topicIds: [uuid(300 + index)],
    contentTargets: ["Recall and distinguish the core biology terms"],
    completionEvidence: ["Recall every target without notes and correct each gap"],
    status: "complete",
  }));
  const plan: LearningPlan = {
    id: PLAN_ID,
    learningItemId: uuid(2),
    title: "Biology vocabulary",
    topic: "Biology vocabulary and definitions",
    kind: "test",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "inside_yova",
    learningIntent: "study",
    creationIntent: "plan",
    rationale: "Use delayed retrieval to build durable recall.",
    createdAt: "2026-08-01T08:00:00.000Z",
    sessions,
  };
  plan.sessions = sessions.map((session, index) => {
    const adapted = adaptLegacySessionToStudyRoute({
      plan,
      session,
      adaptedAt: "2026-08-01T08:00:00.000Z",
      identity: {
        routeLineageId: uuid(500 + index),
        routeRevisionId: uuid(600 + index),
        lifecycleStatus: "provisional",
        createdAt: "2026-08-01T08:00:00.000Z",
      },
    }).route;
    if (!adapted) throw new Error("The fixture needs a route.");
    return {
      ...session,
      studyRoute: StudyRouteSchema.parse(
        commitStudyRouteRevision(adapted, "2026-08-01T08:01:00.000Z"),
      ),
    };
  });
  return plan;
}

function completionsFor(
  plan: LearningPlan,
  dates = ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"],
) {
  return plan.sessions.slice(0, dates.length).map((session, index): SessionCompletion => ({
    id: uuid(700 + index),
    planId: plan.id,
    planSessionId: session.id,
    routeRevisionId: session.studyRoute!.identity.routeRevisionId,
    startedAt: `${dates[index]}T08:00:00.000Z`,
    completedAt: `${dates[index]}T08:15:00.000Z`,
    plannedMinutes: session.studyRoute!.timing.activeMinutes,
    actualMinutes: 15,
    correctAnswers: 4,
    totalAnswers: 4,
    feedback: "about_right",
    observedGap: "",
    conceptEvidence: [],
    confidenceEvidence: [],
  }));
}

function evidenceInput(plan: LearningPlan, completions: SessionCompletion[]) {
  return {
    answers: [] as string[],
    plans: [{
      id: plan.id,
      sessions: plan.sessions,
    }],
    completions,
    now: NOW,
  };
}

describe("authorized method decision evidence", () => {
  it("turns four exact completions across separate days into bounded method authority", () => {
    const plan = evidencePlan();
    const result = buildAuthorizedMethodDecisionEvidence(
      evidenceInput(plan, completionsFor(plan)),
    );
    const observed = result.observedEvidence[0];

    expect(observed).toMatchObject({
      signal: {
        methodId: "spaced_retrieval",
        taskType: "memorization",
        knowledgeStage: "developing",
        sessions: 4,
        checkedAnswers: 16,
        status: "promising",
      },
      distinctStudyDays: 4,
      latestObservedAt: "2026-08-23T08:15:00.000Z",
    });
    expect(observed?.evidenceRefs).toHaveLength(8);

    const selection = selectCanonicalStudyMethod({
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      personalization: result.personalization,
      observedEvidence: result.observedEvidence,
    });
    expect(selection).toMatchObject({
      selectedMethodId: "spaced_retrieval",
      authority: "observed_outcomes",
    });
    expect(selection.learnerFacingReason).toContain("4 separate study days");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.observedEvidence)).toBe(true);
  });

  it("does not treat four repetitions on one day as stable cross-day evidence", () => {
    const plan = evidencePlan();
    const completions = completionsFor(plan, [
      "2026-08-23",
      "2026-08-23",
      "2026-08-23",
      "2026-08-23",
    ]).map((completion, index) => ({
      ...completion,
      startedAt: `2026-08-23T${String(8 + index * 2).padStart(2, "0")}:00:00.000Z`,
      completedAt: `2026-08-23T${String(8 + index * 2).padStart(2, "0")}:15:00.000Z`,
    }));
    const result = buildAuthorizedMethodDecisionEvidence(evidenceInput(plan, completions));
    const selection = selectCanonicalStudyMethod({
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      observedEvidence: result.observedEvidence,
    });

    expect(result.observedEvidence[0]?.distinctStudyDays).toBe(1);
    expect(selection.authority).toBe("task_baseline");
  });

  it("counts at most one completion per immutable route revision", () => {
    const plan = evidencePlan();
    const completions = completionsFor(plan);
    completions.push({
      ...completions[0]!,
      id: uuid(799),
      startedAt: "2026-08-20T09:00:00.000Z",
      completedAt: "2026-08-20T09:15:00.000Z",
    });
    const result = buildAuthorizedMethodDecisionEvidence(evidenceInput(plan, completions));

    expect(result.observedEvidence[0]?.signal.sessions).toBe(4);
    expect(result.observedEvidence[0]?.signal.checkedAnswers).toBe(16);
    expect(result.observedEvidence[0]?.evidenceRefs).not.toContain(completions[0]!.id);
    expect(result.observedEvidence[0]?.evidenceRefs).toContain(uuid(799));
  });

  it("builds typed, correctable self-report context without raw profile prose", () => {
    const answers = Array.from({ length: 17 }, () => "");
    answers[11] = "delayed_forgetting";
    const result = buildAuthorizedMethodDecisionEvidence({
      answers,
      plans: [],
      completions: [],
      now: NOW,
    });
    const selection = selectCanonicalStudyMethod({
      taskType: "memorization",
      knowledgeStage: "developing",
      learningMode: "study",
      personalization: result.personalization,
    });

    expect(selection).toMatchObject({
      selectedMethodId: "spaced_retrieval",
      authority: "authorized_declaration",
    });
    expect(selection.evidenceRefs).toEqual(["signal:memory_breakdown"]);
  });

  it("honors behavior controls, exclusions, stale evidence, and route identity", () => {
    const plan = evidencePlan();
    const completions = completionsFor(plan);
    const behaviorOff = {
      ...defaultPersonalizationState(),
      controls: {
        ...defaultPersonalizationState().controls,
        behavior: false,
      },
    };
    const behaviorOffResult = buildAuthorizedMethodDecisionEvidence({
      ...evidenceInput(plan, completions),
      answers: writePersonalizationStateToAnswers([], behaviorOff),
    });
    expect(behaviorOffResult.observedEvidence).toEqual([]);

    const excluded = {
      ...defaultPersonalizationState(),
      excludedEvidenceRefs: [completions[0]!.id],
    };
    const excludedResult = buildAuthorizedMethodDecisionEvidence({
      ...evidenceInput(plan, completions),
      answers: writePersonalizationStateToAnswers([], excluded),
    });
    expect(excludedResult.observedEvidence[0]?.signal.sessions).toBe(3);

    const stale = completions.map((completion, index) => ({
      ...completion,
      startedAt: `2026-01-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
      completedAt: `2026-01-${String(10 + index).padStart(2, "0")}T08:15:00.000Z`,
    }));
    expect(buildAuthorizedMethodDecisionEvidence(
      evidenceInput(plan, stale),
    ).observedEvidence).toEqual([]);

    const wrongRevision = completions.map((completion) => ({
      ...completion,
      routeRevisionId: uuid(999),
    }));
    expect(buildAuthorizedMethodDecisionEvidence(
      evidenceInput(plan, wrongRevision),
    ).observedEvidence).toEqual([]);
  });

  it("caps the recent comparable window and rejects route-free or review authority", () => {
    const plan = evidencePlan(10);
    const dates = Array.from({ length: 10 }, (_, index) => (
      `2026-08-${String(10 + index).padStart(2, "0")}`
    ));
    const completions = completionsFor(plan, dates);
    const bounded = buildAuthorizedMethodDecisionEvidence(evidenceInput(plan, completions));
    expect(bounded.observedEvidence[0]?.signal.sessions).toBe(
      METHOD_DECISION_MAX_SESSIONS_PER_METHOD,
    );

    const routeFree = evidencePlan();
    const routeFreeCompletions = completionsFor(routeFree);
    routeFree.sessions[0] = { ...routeFree.sessions[0]!, studyRoute: undefined };
    const routeFreeResult = buildAuthorizedMethodDecisionEvidence(
      evidenceInput(routeFree, routeFreeCompletions),
    );
    expect(routeFreeResult.observedEvidence[0]?.signal.sessions).toBe(3);

    const review = evidencePlan();
    review.sessions[0] = { ...review.sessions[0]!, reviewType: "verify" };
    const reviewResult = buildAuthorizedMethodDecisionEvidence(
      evidenceInput(review, completionsFor(review)),
    );
    expect(reviewResult.observedEvidence[0]?.signal.sessions).toBe(3);
  });
});

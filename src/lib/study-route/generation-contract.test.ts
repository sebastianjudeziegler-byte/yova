import { describe, expect, it } from "vitest";
import { generatedSessionStudyRouteIssue } from "@/lib/study-route/generation-contract";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";
import type { StudyRoute } from "@/lib/study-route/schema";

describe("generated session StudyRoute contract", () => {
  it("accepts repeated execution phases while preserving the committed order", () => {
    expect(generatedSessionStudyRouteIssue(session(), route())).toBeNull();
  });

  it("rejects a personalized method substitution under the old revision", () => {
    const changed = session();
    changed.methodBriefing.methodId = "self_explanation";
    expect(generatedSessionStudyRouteIssue(changed, route())).toContain("method");
  });

  it("rejects relabeling an immutable route even when the method ID is unchanged", () => {
    const changed = session();
    changed.methodBriefing.name = "Active Recall";
    expect(generatedSessionStudyRouteIssue(changed, route())).toContain("method name");
  });

  it("rejects a different target or phase order", () => {
    const changedTarget = session();
    changedTarget.topicIds = ["99999999-9999-4999-8999-999999999999"];
    expect(generatedSessionStudyRouteIssue(changedTarget, route())).toContain("targets");

    const changedPhases = session();
    changedPhases.activities.reverse();
    expect(generatedSessionStudyRouteIssue(changedPhases, route())).toContain("phase order");
  });

  it("accepts the taught target subset only when omitted route work is exactly deferred", () => {
    const committedRoute = route();
    committedRoute.target.targetStates.push({
      targetId: "55555555-5555-4555-8555-555555555555",
    } as never);
    const scoped = session();
    scoped.coverage = {
      ...scoped.coverage,
      deferredContent: ["ATP hydrolysis energy coupling"],
    };

    expect(generatedSessionStudyRouteIssue(
      scoped,
      committedRoute,
      targetContext(),
    )).toBeNull();
    expect(scoped.topicIds).toEqual([
      "44444444-4444-4444-8444-444444444444",
    ]);
  });

  it("rejects an unrelated target, missing deferral, or non-matching deferred label", () => {
    const committedRoute = route();
    committedRoute.target.targetStates.push({
      targetId: "55555555-5555-4555-8555-555555555555",
    } as never);
    const unrelated = session();
    unrelated.topicIds = ["99999999-9999-4999-8999-999999999999"];
    unrelated.coverage = {
      ...unrelated.coverage,
      deferredContent: ["ATP hydrolysis energy coupling"],
    };
    const silent = session();
    const inexact = session();
    inexact.coverage = {
      ...inexact.coverage,
      deferredContent: ["Some deferred work"],
    };

    expect(generatedSessionStudyRouteIssue(unrelated, committedRoute, targetContext())).toContain("targets");
    expect(generatedSessionStudyRouteIssue(silent, committedRoute, targetContext())).toContain("targets");
    expect(generatedSessionStudyRouteIssue(inexact, committedRoute, targetContext())).toContain("targets");
    expect(generatedSessionStudyRouteIssue(
      { ...inexact, coverage: { ...inexact.coverage, deferredContent: ["ATP hydrolysis energy coupling"] } },
      committedRoute,
    )).toContain("targets");
  });

  it("accepts only the mapped remaining target for a durable continuation", () => {
    const committedRoute = route();
    committedRoute.target.targetStates.push({
      targetId: "55555555-5555-4555-8555-555555555555",
    } as never);
    const continuation = session();
    continuation.topicIds = ["55555555-5555-4555-8555-555555555555"];
    const continuationContext = {
      ...targetContext(),
      plannedContentTargets: ["ATP hydrolysis energy coupling"],
      isDeferredContinuation: true,
    };

    expect(generatedSessionStudyRouteIssue(
      continuation,
      committedRoute,
      continuationContext,
    )).toBeNull();
    expect(continuation.topicIds).toEqual([
      "55555555-5555-4555-8555-555555555555",
    ]);

    const fullSuperset = session();
    fullSuperset.topicIds = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ];
    const unrelated = session();
    unrelated.topicIds = ["99999999-9999-4999-8999-999999999999"];

    expect(generatedSessionStudyRouteIssue(
      fullSuperset,
      committedRoute,
      continuationContext,
    )).toContain("targets");
    expect(generatedSessionStudyRouteIssue(
      unrelated,
      committedRoute,
      continuationContext,
    )).toContain("targets");
    expect(generatedSessionStudyRouteIssue(
      continuation,
      committedRoute,
      { ...continuationContext, isDeferredContinuation: false },
    )).toContain("targets");
    expect(generatedSessionStudyRouteIssue(
      continuation,
      committedRoute,
      { ...continuationContext, plannedContentTargets: ["Unmapped remaining work"] },
    )).toContain("targets");
  });
});

function session() {
  return {
    topicIds: ["44444444-4444-4444-8444-444444444444"],
    coverage: {
      focus: "Retrieve the committed target.",
      essentialIdeas: ["The committed target remains the active retrieval focus."],
      completionEvidence: ["Retrieve the target without notes."],
      evidenceMap: [],
      deferredContent: [],
    },
    methodBriefing: {
      learningMode: "study",
      methodId: "retrieval_practice",
      name: "Retrieval practice",
    },
    activities: [
      { methodPhase: "retrieve" },
      { methodPhase: "retrieve" },
      { methodPhase: "feedback" },
      { methodPhase: "repair" },
    ],
  } as unknown as GeneratedSessionDraft;
}

function route() {
  return {
    approach: {
      mode: "practice",
      primaryMethodId: "retrieval_practice",
      visibleMethodName: "Retrieval practice",
    },
    target: {
      targetStates: [{ targetId: "44444444-4444-4444-8444-444444444444" }],
    },
    execution: {
      deferredTargets: [],
      orderedPhases: [
        { methodPhase: "retrieve" },
        { methodPhase: "feedback" },
        { methodPhase: "repair" },
      ],
    },
  } as unknown as StudyRoute;
}

function targetContext() {
  return {
    plannedTopicIds: [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ],
    plannedContentTargets: [
      "Sodium export transport ratio",
      "ATP hydrolysis energy coupling",
    ],
    knowledgeTopics: [{
      id: "44444444-4444-4444-8444-444444444444",
      title: "Sodium export transport ratio",
      description: "The pump exports three sodium ions while importing two potassium ions.",
      subtopics: ["sodium export"],
      prerequisiteTopicIds: [],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
    }, {
      id: "55555555-5555-4555-8555-555555555555",
      title: "ATP hydrolysis energy coupling",
      description: "ATP hydrolysis supplies energy for transport against the ion gradients.",
      subtopics: ["ATP hydrolysis"],
      prerequisiteTopicIds: ["44444444-4444-4444-8444-444444444444"],
      status: "not_started" as const,
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated" as const,
      deferred: null,
    }],
  };
}

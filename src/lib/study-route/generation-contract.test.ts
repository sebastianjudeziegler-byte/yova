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
});

function session() {
  return {
    topicIds: ["44444444-4444-4444-8444-444444444444"],
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
  } as GeneratedSessionDraft;
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

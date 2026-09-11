import { describe, expect, it } from "vitest";
import type { LearningMaterial, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { routingEvidenceForTopic, routingInputForSession, sessionTopic } from "./route-for-session";

const topicId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const materialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function topic(overrides: Partial<KnowledgeMapTopic> = {}): KnowledgeMapTopic {
  return { id: topicId, title: "Glycolysis", description: "Explain how glucose becomes pyruvate and where ATP and NADH come from.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null, ...overrides };
}

function session(overrides: Partial<LearningPlanSession> = {}): Pick<LearningPlanSession, "topicIds" | "studyRoute" | "title" | "objective" | "learningMode"> {
  return { topicIds: [topicId], title: "Glycolysis", objective: "Explain glycolysis.", learningMode: "learn", ...overrides };
}

const plan = (topics: KnowledgeMapTopic[], materials: LearningMaterial[] = [], sourceMode: "user_materials" | "yova_generated" = "yova_generated") => ({
  topic: "AP Biology cellular energetics",
  title: "Cellular energetics",
  materials,
  sourceMode,
  knowledgeMap: { version: 1 as const, scopeJudgment: { band: "unit_or_exam" as const, label: "Cellular energetics", minimumSessions: 2, recommendedSessions: 2, maximumSessions: 2, minimumTeachingSessions: 1, explanation: "Learn glycolysis, then practise it independently." }, topics, placementCheck: { status: "skipped" as const, completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] } },
});

describe("routing input for a plan session", () => {
  it("finds the session's topic and skips removed ones", () => {
    expect(sessionTopic(plan([topic()]), session())?.id).toBe(topicId);
    expect(sessionTopic(plan([topic({ removed: true })]), session())).toBeNull();
    expect(sessionTopic(plan([]), session({ topicIds: [] }))).toBeNull();
  });

  it.each([
    [null, "not_assessed"],
    [{ source: "placement_check", outcome: "gap", observedAt: "2026-09-01T00:00:00.000Z" }, "gap"],
    [{ source: "placement_check", outcome: "demonstrated", observedAt: "2026-09-01T00:00:00.000Z" }, "demonstrated"],
    [{ source: "learner_report", outcome: "covered_elsewhere", checked: false }, "learner_reported_covered"],
  ] as const)("maps placement evidence %j → %s", (initialEvidence, expected) => {
    expect(routingEvidenceForTopic(topic({ initialEvidence: initialEvidence as never }))).toBe(expected);
  });

  it("uses the committed route's task family before classifying text", () => {
    const routed = session({ studyRoute: { target: { taskFamily: "problem_solving" } } as never });
    expect(routingInputForSession({ plan: plan([topic()]), session: routed, topic: topic(), answers: emptyOnboardingAnswers() }).taskType).toBe("problem_solving");
    expect(routingInputForSession({ plan: plan([topic()]), session: session(), topic: topic(), answers: emptyOnboardingAnswers() }).taskType).toBe("conceptual_learning");
  });

  it("derives block kind, source and problems from the session and topic", () => {
    const material: LearningMaterial = { id: materialId, name: "notes.txt", mimeType: "text/plain", sizeBytes: 10, textContent: "Glycolysis notes", processingStatus: "ready" };
    const mapped = topic({ sourceReferences: [{ materialId, chunkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", chunkIndex: 0, startCharacter: 0, endCharacter: 10, locationLabel: "page 1", sectionRole: "content_source" }] });
    const learn = routingInputForSession({ plan: plan([mapped], [material], "user_materials"), session: session(), topic: mapped, answers: emptyOnboardingAnswers() });
    expect(learn).toMatchObject({ blockKind: "learn", hasSource: true, topicHasProblems: false, evidence: "not_assessed" });
    const practice = routingInputForSession({ plan: plan([topic()]), session: session({ learningMode: "study" }), topic: topic(), answers: emptyOnboardingAnswers() });
    expect(practice).toMatchObject({ blockKind: "practice", hasSource: false });
  });

  it("flags problems inside a mixed-assessment session from the topic's own classification", () => {
    const solve = topic({ title: "Solve quadratic equations", description: "Solve quadratic equations by factoring and the quadratic formula." });
    const mixed = session({ studyRoute: { target: { taskFamily: "mixed_assessment" } } as never });
    expect(routingInputForSession({ plan: plan([solve]), session: mixed, topic: solve, answers: emptyOnboardingAnswers() }).topicHasProblems).toBe(true);
    expect(routingInputForSession({ plan: plan([topic()]), session: mixed, topic: topic(), answers: emptyOnboardingAnswers() }).topicHasProblems).toBe(false);
  });
});

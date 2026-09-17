import { describe, expect, it } from "vitest";
import type { LearningMaterial, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import type { SessionCompletion } from "@/lib/domain";
import { interleavedKeyPointsForSession, passedRelatedTopicIds, routingEvidenceForTopic, routingInputForSession, sessionTopic } from "./route-for-session";

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

// Brief 1.5 item 3: routing input for practice labels.
describe("practice label inputs", () => {
  const second = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const unrelated = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const topics = [
    topic(),
    topic({ id: second, title: "Link reaction", description: "Explain how pyruvate becomes acetyl-CoA before the Krebs cycle.", prerequisiteTopicIds: [topicId] }),
    topic({ id: unrelated, title: "Photosynthesis", description: "Explain how light energy is captured as chemical energy in chloroplasts." }),
  ];
  function completion(forTopic: string, outcomes: Array<"secure" | "needs_review">, concepts = outcomes.map((_, index) => `Key idea number ${index + 1} for ${forTopic.slice(0, 4)}.`)): SessionCompletion {
    return {
      id: crypto.randomUUID(), planId: "p", planSessionId: crypto.randomUUID(), startedAt: "2026-09-10T10:00:00.000Z", completedAt: "2026-09-10T10:20:00.000Z",
      plannedMinutes: 20, actualMinutes: 20, correctAnswers: outcomes.filter((outcome) => outcome === "secure").length, totalAnswers: outcomes.length,
      feedback: null, observedGap: "", completionMode: "guided", confidenceEvidence: [],
      conceptEvidence: outcomes.map((outcome, index) => ({ topicId: forTopic, concept: concepts[index]!, outcome, activityType: "multiple_choice" as const })),
    } as SessionCompletion;
  }

  it("counts days to the plan deadline from now", () => {
    const input = routingInputForSession({ plan: { ...plan(topics), deadline: "2026-09-13T12:00:00.000Z" }, session: session({ learningMode: "study" }), topic: topics[0]!, answers: emptyOnboardingAnswers(), now: new Date("2026-09-11T12:00:00.000Z") });
    expect(input.daysToDeadline).toBe(2);
    expect(routingInputForSession({ plan: { ...plan(topics), deadline: null }, session: session(), topic: topics[0]!, answers: emptyOnboardingAnswers(), now: new Date() }).daysToDeadline).toBeNull();
  });

  it("finds prerequisite-linked topics that each passed a practice round clean at least once", () => {
    const completions = [completion(topicId, ["secure", "secure"]), completion(second, ["secure", "needs_review"]), completion(second, ["secure", "secure"]), completion(unrelated, ["secure"])];
    expect(passedRelatedTopicIds({ plan: plan(topics), topic: topics[0]!, completions }).sort()).toEqual([topicId, second].sort());
    expect(passedRelatedTopicIds({ plan: plan(topics), topic: topics[0]!, completions: [completion(second, ["secure", "needs_review"])] })).toEqual([]);
  });

  it("sweeps the passed related topics' key points for an Interleaved Review, with unique ids", () => {
    const completions = [completion(topicId, ["secure", "secure"]), completion(second, ["secure", "secure"])];
    const keyPoints = interleavedKeyPointsForSession({ plan: plan(topics), topic: topics[0]!, completions });
    expect(keyPoints).toHaveLength(4);
    expect(new Set(keyPoints.map((keyPoint) => keyPoint.id)).size).toBe(4);
    expect(keyPoints.map((keyPoint) => keyPoint.text)).toEqual(expect.arrayContaining(["Key idea number 1 for cccc.", "Key idea number 1 for dddd."]));
  });
});

// Brief 1.5 item 4: difficulty inputs come from the knowledge map, not the model.
describe("difficulty inputs", () => {
  it("passes the topic's subtopic count and prerequisite depth to routing", () => {
    const first = topic({ subtopics: ["Investment phase", "Payoff phase"] });
    const second = topic({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Link reaction", description: "Explain how pyruvate becomes acetyl-CoA before the Krebs cycle.", subtopics: ["Decarboxylation"], prerequisiteTopicIds: [topicId] });
    const input = routingInputForSession({ plan: plan([first, second]), session: session({ topicIds: [second.id] }), topic: second, answers: emptyOnboardingAnswers() });
    expect(input.subtopicCount).toBe(1);
    expect(input.prerequisiteDepth).toBe(1);
  });
});


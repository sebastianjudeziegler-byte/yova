import { describe, expect, it } from "vitest";
import {
  allowsLegacySessionFallback,
  LEGACY_SESSION_ARCHITECTURE,
  STREAMED_SESSION_ARCHITECTURE,
  readSessionArchitectureVersion,
  resolveSessionArchitectureVersion,
  sessionArchitectureForGeneration,
  usesStreamedTeaching,
} from "@/lib/session-generation/architecture";

const validKnowledgeMap = {
  version: 1,
  scopeJudgment: {
    band: "focused_skill",
    label: "Focused skill",
    minimumSessions: 1,
    recommendedSessions: 2,
    maximumSessions: 3,
    minimumTeachingSessions: 1,
    explanation: "A focused prerequisite sequence that can be taught and checked in a few sessions.",
  },
  topics: [{
    id: "00000000-0000-4000-8000-000000000001",
    title: "Core relationship",
    description: "Understand the central relationship before applying it independently.",
    subtopics: [],
    prerequisiteTopicIds: [],
    status: "not_started",
    initialEvidence: null,
    sourceReferences: [],
    origin: "ai_generated",
    deferred: null,
    curriculumReference: null,
  }],
  placementCheck: {
    status: "available",
    completedAt: null,
    demonstratedTopicIds: [],
    gapTopicIds: [],
  },
  curriculum: null,
};

describe("session architecture versioning", () => {
  it("treats missing and unknown versions as legacy so existing plans do not change", () => {
    expect(readSessionArchitectureVersion(undefined)).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(readSessionArchitectureVersion({})).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(readSessionArchitectureVersion({ sessionArchitectureVersion: "future" })).toBe(LEGACY_SESSION_ARCHITECTURE);
  });

  it("opts in only plans explicitly stamped for streamed teaching", () => {
    const plan = { sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE };
    expect(readSessionArchitectureVersion(plan)).toBe(STREAMED_SESSION_ARCHITECTURE);
    expect(usesStreamedTeaching(plan)).toBe(true);
  });

  it("recovers mapped plans that predate the streamed architecture stamp", () => {
    expect(resolveSessionArchitectureVersion({}, validKnowledgeMap)).toBe(STREAMED_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion(undefined, validKnowledgeMap)).toBe(STREAMED_SESSION_ARCHITECTURE);
  });

  it("does not upgrade missing versions unless the knowledge map is valid and non-empty", () => {
    expect(resolveSessionArchitectureVersion({}, undefined)).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion({}, { ...validKnowledgeMap, topics: [] })).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion({}, { version: 1, topics: [{}] })).toBe(LEGACY_SESSION_ARCHITECTURE);
  });

  it("keeps every explicitly stored value authoritative", () => {
    expect(resolveSessionArchitectureVersion(
      { sessionArchitectureVersion: LEGACY_SESSION_ARCHITECTURE },
      validKnowledgeMap,
    )).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion(
      { sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE },
      undefined,
    )).toBe(STREAMED_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion(
      { sessionArchitectureVersion: "future_version" },
      validKnowledgeMap,
    )).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion(
      { sessionArchitectureVersion: 2 },
      validKnowledgeMap,
    )).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(resolveSessionArchitectureVersion(
      { sessionArchitectureVersion: null },
      validKnowledgeMap,
    )).toBe(LEGACY_SESSION_ARCHITECTURE);
  });

  it("never substitutes a legacy built-in lesson for a streamed plan", () => {
    expect(allowsLegacySessionFallback({ sessionArchitectureVersion: STREAMED_SESSION_ARCHITECTURE })).toBe(false);
    expect(allowsLegacySessionFallback({ sessionArchitectureVersion: LEGACY_SESSION_ARCHITECTURE })).toBe(true);
  });

  it("streams teaching-first sessions even when an older saved plan is stamped legacy", () => {
    expect(sessionArchitectureForGeneration({
      storedVersion: LEGACY_SESSION_ARCHITECTURE,
      learningMode: "learn",
      studyMode: "inside_yova",
      reviewType: null,
    })).toBe(STREAMED_SESSION_ARCHITECTURE);
    expect(sessionArchitectureForGeneration({
      storedVersion: LEGACY_SESSION_ARCHITECTURE,
      learningMode: "study",
      studyMode: "inside_yova",
      reviewType: null,
    })).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(sessionArchitectureForGeneration({
      storedVersion: LEGACY_SESSION_ARCHITECTURE,
      learningMode: "learn",
      studyMode: "outside_yova",
      reviewType: null,
    })).toBe(LEGACY_SESSION_ARCHITECTURE);
  });

  it("keeps committed Learn methods on the architecture their generator can deliver", () => {
    expect(sessionArchitectureForGeneration({
      storedVersion: STREAMED_SESSION_ARCHITECTURE,
      learningMode: "learn",
      studyMode: "inside_yova",
      reviewType: null,
      selectedMethodId: "read_recall_review",
    })).toBe(LEGACY_SESSION_ARCHITECTURE);
    expect(sessionArchitectureForGeneration({
      storedVersion: LEGACY_SESSION_ARCHITECTURE,
      learningMode: "learn",
      studyMode: "inside_yova",
      reviewType: null,
      selectedMethodId: "self_explanation",
    })).toBe(STREAMED_SESSION_ARCHITECTURE);
  });
});

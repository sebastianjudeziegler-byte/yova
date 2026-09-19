import { describe, expect, it, vi } from "vitest";
import { deltaFixture } from "@/evals/personalization-delta-fixture";
import { resolveLearningIntent } from "@/lib/learning/learning-intent";
import { emptyOnboardingAnswers } from "@/lib/onboarding/answers";
import { composeNormalPlanEnvelopes, type NormalPlanEnvelopeInput } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { PlanGenerationRequestSchema } from "@/lib/plan-generation/schema";
import { routingInputForSession, sessionTopic } from "@/lib/routing/route-for-session";
import { routeSession } from "@/lib/routing/session-route";
import { baselineSourceForTopic } from "@/lib/session-shapes/source-context";

vi.mock("server-only", () => ({}));
const { templateDirection } = await import("@/lib/openai/shape-slot-generator");

/**
 * Brief 2.5 root cause 1 (audit findings 1-7 and 3). A goal that mentions a
 * test used to route every topic to practice, so every topic read "Teaching
 * skipped" and a topic's attached notes were never studied. This drives the
 * same chain the plan route runs - the intent resolved from the goal, the
 * plan composer, then the session router - with a plain test-prep goal, no
 * placement and no ticks.
 */
const NOTES_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOPICS = ["dddddddd-dddd-4ddd-8ddd-dddddddddd01", "dddddddd-dddd-4ddd-8ddd-dddddddddd02", "dddddddd-dddd-4ddd-8ddd-dddddddddd03"];
const NOTES_TEXT = "DNA replication is semi-conservative. Helicase unwinds the double helix at the origin, primase lays an RNA primer, and DNA polymerase III extends the new strand 5' to 3'. The lagging strand is built in Okazaki fragments that DNA ligase joins.";

function testPrepPlan(goal: string) {
  const learningIntent = resolveLearningIntent({ goal });
  const request = PlanGenerationRequestSchema.parse({
    intent: "plan", learningIntent: learningIntent.intent, goal,
    materialMode: "upload",
    materials: [{ id: NOTES_ID, name: "Chapter 12 notes.pdf", mimeType: "application/pdf", sizeBytes: NOTES_TEXT.length, textContent: NOTES_TEXT, processingStatus: "ready" }],
    studyMode: "inside", deadline: "2026-09-26T20:00:00.000Z", timeZone: "UTC", diagnosticResponses: [],
    availability: [{ day: "Every day", window: "Evening", minutes: 45 }],
    profileSummary: "Use my saved learner profile.",
    knowledgeMap: {
      version: 1,
      scopeJudgment: { band: "unit_or_exam", label: "Molecular genetics", minimumSessions: 3, recommendedSessions: 3, maximumSessions: 6, minimumTeachingSessions: 1, explanation: "Three connected topics for a unit test." },
      topics: ["DNA replication", "Transcription", "Translation"].map((title, index) => ({
        id: TOPICS[index]!, title, description: `Explain ${title.toLowerCase()} and its role in gene expression.`,
        subtopics: ["Enzymes involved", "Steps in order"], prerequisiteTopicIds: index ? [TOPICS[index - 1]!] : [],
        status: "not_started", initialEvidence: null, origin: index ? "ai_generated" : "material", deferred: null,
        // Only the first topic is taught by the learner's own notes.
        sourceReferences: index ? [] : [{ materialId: NOTES_ID, chunkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", chunkIndex: 0, startCharacter: 0, endCharacter: NOTES_TEXT.length, locationLabel: "pages 1-2", sectionRole: "content_source" }],
      })),
      placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    },
  });
  const input: NormalPlanEnvelopeInput = {
    now: new Date("2026-09-19T08:00:00Z"),
    learningIntentRecommendation: { intent: request.learningIntent, basis: learningIntent.reason },
    durationContext: {
      profileVersion: "brief-2.5:test-goal",
      profile: { sustainableMinutes: 45, preferredWindow: null, fatigueRisk: null, startingFrictionRisk: null, evidenceRefs: { sustainableMinutes: [], preferredWindow: [], fatigueRisk: [], startingFrictionRisk: [] } },
      recentOutcomes: [],
      onboardingAnswers: emptyOnboardingAnswers(),
    },
    request,
  };
  const composition = composeNormalPlanEnvelopes(input);
  return buildNormalPlanFromFixedEnvelope({ ...input, methodContext: deltaFixture(2).methodContext, composition, fill: buildNormalPlanFallbackFill({ request, composition }) });
}

describe("a test-prep goal still teaches every untouched topic", () => {
  it.each([
    "I have a biology test next Friday",
    "Prepare for my AP Biology Unit 6 test",
  ])("gives every topic a learn block, and the notes-backed topic studies the notes: %s", (goal) => {
    const plan = testPrepPlan(goal);
    for (const topicId of TOPICS) {
      const first = plan.sessions.find((session) => session.topicIds?.includes(topicId));
      expect(first?.learningMode, `first block for ${topicId}`).toBe("learn");
    }
    const withNotes = plan.sessions.find((session) => session.topicIds?.includes(TOPICS[0]!))!;
    const topic = sessionTopic(plan, withNotes)!;
    const route = routeSession(routingInputForSession({ plan, session: withNotes, topic, answers: emptyOnboardingAnswers() }));
    // Finding 3: the learner's notes are what gets studied, not an AI explanation.
    expect(route.learnPath).toBe("source");
    // A saved plan names the file; for signed-in sessions the server attaches the
    // excerpts from the stored material when the session runs.
    const source = baselineSourceForTopic(plan, topic);
    expect(source.description).toMatchObject({ name: "Chapter 12 notes.pdf", kind: "document" });
    const direction = templateDirection({
      requestId: "11111111-1111-4111-8111-111111111111", recoveryKey: "22222222-2222-4222-8222-222222222222",
      planId: "33333333-3333-4333-8333-333333333333", planSessionId: withNotes.id, action: "direction",
      topic: { id: topic.id, title: topic.title, description: topic.description, subtopics: topic.subtopics, taskType: route.input.taskType },
      modifiers: { instructionStyle: route.instructionStyle, questionMix: route.questionMix, produceStep: route.produceStep, explanationFocus: route.explanationFocus, questionCap: route.questionCap, questionTarget: route.questionTarget },
      tips: [], source: source.description, purpose: "study_inside", entry: "study_full", excerpts: source.excerpts, wantsExample: false,
    });
    expect(direction.whatToLookAt).toMatch(/^Review Chapter 12 notes\.pdf/);

    const withoutNotes = plan.sessions.find((session) => session.topicIds?.includes(TOPICS[1]!))!;
    const plainTopic = sessionTopic(plan, withoutNotes)!;
    expect(routeSession(routingInputForSession({ plan, session: withoutNotes, topic: plainTopic, answers: emptyOnboardingAnswers() })).learnPath).toBe("ai_explanation");
  });
});

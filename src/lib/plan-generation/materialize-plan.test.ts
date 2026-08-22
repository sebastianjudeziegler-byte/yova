import { describe, expect, it } from "vitest";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import type { GeneratedPlanDraft, PlanGenerationRequest } from "@/lib/plan-generation/schema";

const request: PlanGenerationRequest = {
  intent: "plan",
  learningIntent: "learn",
  goal: "I know nothing about World War I and need to prepare for a test",
  materialMode: "none",
  materials: [],
  studyMode: "inside",
  deadline: null,
  timeZone: "America/Los_Angeles",
  diagnosticResponses: [
    { question: "Where are you starting?", answer: "Completely new", evaluation: "self_report" },
  ],
  availability: [{ day: "Friday", window: "Evening", minutes: 25 }],
  profileSummary: "The learner wants a clear big-picture explanation before independent work.",
  knowledgeMap: {
    version: 1,
    scopeJudgment: { band: "focused_skill", label: "Focused history foundation", minimumSessions: 1, recommendedSessions: 1, maximumSessions: 2, minimumTeachingSessions: 1, explanation: "The first plan builds one prerequisite causal relationship before later expansion." },
    topics: [{ id: "11111111-1111-4111-8111-111111111111", title: "World War I escalation", description: "How alliances and mobilization widened the conflict after the July Crisis.", subtopics: [], prerequisiteTopicIds: [], status: "not_started", initialEvidence: null, sourceReferences: [], origin: "ai_generated", deferred: null, curriculumReference: null }],
    placementCheck: { status: "skipped", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
    curriculum: null,
  },
};

const staleDraft: GeneratedPlanDraft = {
  title: "World War I",
  topic: "World War I causes and escalation",
  kind: "test",
  deadline: null,
  rationale: "Prepare for the assessment with a sequence of focused learning sessions.",
  deferredTopics: [],
  sessions: [{
    title: "Recall the July Crisis",
    objective: "Recall the causes of World War I without looking at an explanation.",
    method: "Retrieval practice",
    methodReason: "Starting with recall can expose gaps.",
    scheduledFor: "2026-08-07T18:00:00.000-07:00",
    estimatedMinutes: 25,
    amountLabel: "One target and one check",
    learningMode: "study",
    topicIds: ["11111111-1111-4111-8111-111111111111"],
    contentTargets: ["How alliances and mobilization widened the war"],
    completionEvidence: ["Answer one question about the July Crisis"],
  }],
};

describe("materializePlanDraft", () => {
  it("treats the learner's requested starting approach as authoritative", () => {
    const plan = materializePlanDraft(staleDraft, request);

    expect(plan.sessions[0]).toMatchObject({
      learningMode: "learn",
      method: "Guided explanation and self-explanation",
    });
    expect(plan.sessions[0].objective).toMatch(/first mental model/i);
    expect(plan.sessionArchitectureVersion).toBe("streamed_teaching_v1");
  });

  it("repairs generic generated titles before a plan reaches Learning", () => {
    const plan = materializePlanDraft({
      ...staleDraft,
      title: "Personalized learning plan",
    }, {
      ...request,
      goal: "I want to learn new vocabulary words so I can be better in conversation",
    });

    expect(plan.title).toMatch(/vocabulary/i);
    expect(plan.title).not.toMatch(/personalized learning plan/i);
  });

  it("shortens a long generated title at a phrase boundary before it reaches Learning", () => {
    const goal = "Analyze comparative political institutions across historical regions through evidence";
    const plan = materializePlanDraft({
      ...staleDraft,
      title: "Analyze Comparative Political Institutions Across Historical Regions Through Evidence",
    }, {
      ...request,
      goal,
    });

    expect(plan.title).toBe("Analyze Comparative Political Institutions…");
    expect(plan.title.length).toBeLessThanOrEqual(72);
  });

  it("replaces a material-backed leading-fragment topic before persistence", () => {
    const goal = "Biology Quiz on Osmosis. Be Able to Explain Water Movement, Tonicity";
    const fragment = ", and the Effects on Animal and Plant Cells Using the Attached Notes";
    const plan = materializePlanDraft({
      ...staleDraft,
      title: goal,
      topic: fragment,
    }, {
      ...request,
      goal,
      materialMode: "upload",
      materials: [{
        id: "22222222-2222-4222-8222-222222222222",
        name: "yova-walkthrough-osmosis-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1_024,
        textContent: "Osmosis moves water across a selectively permeable membrane.",
        processingStatus: "ready",
      }],
    });

    expect(plan).toMatchObject({
      title: goal,
      topic: goal,
      sourceMode: "user_materials",
    });
    expect(plan.topic).not.toMatch(/^[,;:.!?]/);
    expect(plan.materials?.[0]?.textContent).toBeNull();
  });

  it.each(["in two weeks and I have not started yet", "in 14 days and I have not started yet"])(
    "keeps operational metadata out of plan, map, and session subject fields: %s",
    (operationalTail) => {
      const goal = `1,500-word History Essay. I have a 1,500-word history essay due ${operationalTail}`;
      const mappedTopic = {
        ...request.knowledgeMap!.topics[0]!,
        title: operationalTail,
        description: `The knowledge and performance needed for ${operationalTail}.`,
      };
      const plan = materializePlanDraft({
        ...staleDraft,
        title: "1,500-word History Essay Due",
        topic: operationalTail,
        kind: "topic",
        sessions: [{
          ...staleDraft.sessions[0]!,
          title: `Learn ${operationalTail}`,
          objective: `Build an accurate model of ${operationalTail}.`,
          learningMode: "learn",
          contentTargets: [operationalTail],
          completionEvidence: [`Explain ${operationalTail}`],
        }],
      }, {
        ...request,
        goal,
        studyMode: "outside",
        knowledgeMap: {
          ...request.knowledgeMap!,
          topics: [mappedTopic],
        },
      });

      expect(plan).toMatchObject({
        title: "1,500-word History Essay Due",
        topic: "1,500-word History Essay",
        knowledgeMap: {
          topics: [{
            title: "1,500-word History Essay",
            description: "The knowledge and performance needed for 1,500-word History Essay.",
          }],
        },
        sessions: [{
          title: "Learn 1,500-word History Essay",
          objective: "Build an accurate model of 1,500-word History Essay.",
          contentTargets: ["1,500-word History Essay"],
          completionEvidence: ["Explain 1,500-word History Essay"],
        }],
      });
    },
  );
});

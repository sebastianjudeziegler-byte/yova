import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudyMethodBriefing } from "@/components/study-method-briefing";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import { buildFallbackMethodBriefing } from "@/lib/learning/fallback-method-briefing";

function makeSession(overrides: Partial<LearningPlanSession> = {}): LearningPlanSession {
  return {
    id: "session-1",
    sequence: 1,
    title: "Trace an unfamiliar system",
    objective: "Explain how ocean currents redistribute heat around Earth.",
    method: "Self-explanation",
    methodReason: "Explaining the causal chain makes gaps visible before the final check.",
    scheduledFor: "2026-08-19T18:00:00.000Z",
    estimatedMinutes: 20,
    amountLabel: "One explanation and application",
    learningMode: "study",
    contentTargets: [
      "How surface currents move warm water",
      "How deep currents return colder water",
    ],
    completionEvidence: ["Explain the heat-transfer relationship without support"],
    status: "ready",
    ...overrides,
  };
}

function makePlan(session: LearningPlanSession, overrides: Partial<LearningPlan> = {}): LearningPlan {
  return {
    id: "plan-1",
    learningItemId: "item-1",
    title: "Ocean circulation",
    topic: "How ocean currents redistribute heat",
    kind: "topic",
    deadline: null,
    status: "active",
    sourceMode: "yova_generated",
    studyMode: "outside_yova",
    learningIntent: "study",
    rationale: "Use the learner's source while YOVA structures the work.",
    createdAt: "2026-08-19T17:00:00.000Z",
    sessions: [session],
    ...overrides,
  };
}

function renderBriefing(
  session: LearningPlanSession,
  plan: LearningPlan,
  coverage?: {
    focus: string;
    essentialIdeas: string[];
  },
) {
  return renderToStaticMarkup(createElement(StudyMethodBriefing, {
    session,
    briefing: buildFallbackMethodBriefing(plan, session),
    coverage,
  }));
}

describe("StudyMethodBriefing", () => {
  it("shows the complete subject-neutral method briefing for an outside-YOVA session", () => {
    const session = makeSession();
    const html = renderBriefing(session, makePlan(session));

    expect(html).toContain('aria-label="How to study this"');
    expect(html).toContain('data-learning-mode="study"');
    expect(html).toContain("Practice first");
    expect(html).toContain(session.objective);
    expect(html).toContain("How surface currents move warm water");
    expect(html).toContain("How deep currents return colder water");
    expect(html).toContain("Explain the heat-transfer relationship without support");
    expect(html).toContain("Self-explanation");
    expect(html).toContain("Explain how and why an idea works in your own words");
    expect(html).toContain(session.methodReason);
    expect(html).toContain("Study one concise explanation or example");
    expect(html).toContain("Compare with the source and repair the explanation");
    expect(html).toContain("outside source remains the source of truth");
    expect(html).toContain("counts as practice, not proof of topic mastery");
  });

  it("prefers the generated current-session slice over broader planned targets", () => {
    const session = makeSession();
    const html = renderBriefing(session, makePlan(session), {
      focus: "Connect surface and deep circulation in one causal model.",
      essentialIdeas: [
        "Density links temperature to vertical circulation",
        "How surface currents move warm water",
      ],
    });

    expect(html).toContain("Connect surface and deep circulation in one causal model");
    expect(html).not.toContain(`>${session.objective}<`);
    expect(html).toContain("Density links temperature to vertical circulation");
    expect(html.match(/How surface currents move warm water/g)).toHaveLength(1);
    expect(html).not.toContain("How deep currents return colder water");
  });

  it("labels learn mode as teaching-first and routes away from a retrieval-only start", () => {
    const session = makeSession({
      learningMode: "learn",
      method: "Closed-note retrieval",
      methodReason: "Start from memory.",
    });
    const plan = makePlan(session, { learningIntent: "learn" });
    const html = renderBriefing(session, plan);

    expect(html).toContain('data-learning-mode="learn"');
    expect(html).toContain("Teaching first");
    expect(html).toContain("Self-explanation");
    expect(html).toContain("Study one concise explanation or example");
    expect(html).not.toContain("Hide the answer or close the source");
  });

  it("surfaces the catalog guardrail when a learn-mode method still requires an initial model", () => {
    const session = makeSession({
      title: "Learn the vocabulary",
      objective: "Memorize the vocabulary definitions for the quiz.",
      method: "Retrieval practice",
      methodReason: "Use retrieval after first encountering each definition.",
      learningMode: "learn",
      contentTargets: ["Vocabulary definitions"],
    });
    const plan = makePlan(session, {
      title: "Vocabulary quiz",
      topic: "Memorize vocabulary definitions",
      kind: "test",
      learningIntent: "learn",
    });
    const html = renderBriefing(session, plan);

    expect(html).toContain("Before unsupported practice");
    expect(html).toContain("Do not use unsupported recall as the only teaching step");
    expect(html).toContain("outside source remains the source of truth");
  });

  it("can omit the practice boundary when a parent workflow already presents it", () => {
    const session = makeSession();
    const html = renderToStaticMarkup(createElement(StudyMethodBriefing, {
      session,
      briefing: buildFallbackMethodBriefing(makePlan(session), session),
      showPracticeBoundary: false,
    }));

    expect(html).not.toContain("counts as practice, not proof of topic mastery");
  });
});

import { describe, expect, it } from "vitest";
import { buildPlanEvaluationCases } from "@/evals/plan-cases";
import { extractMaterialAnchors } from "@/lib/plan-generation/content-budget";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";

type MatrixCaseId =
  | "product_rule_narrow_15"
  | "world_war_one_guide_15"
  | "calculus_broad_pathway_30"
  | "startup_funding_general_25";

function matrixCase(id: MatrixCaseId) {
  const found = buildPlanEvaluationCases(new Date("2026-08-08T18:00:00.000Z"))
    .find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing journey-matrix case: ${id}`);
  return found;
}

describe("learner journey matrix", () => {
  it("keeps one narrow skill much smaller than an entire course", () => {
    const narrow = generatePreviewPlan(matrixCase("product_rule_narrow_15").request);
    const broad = generatePreviewPlan(matrixCase("calculus_broad_pathway_30").request);

    expect(narrow.kind).toBe("skill");
    expect(narrow.sessions).toHaveLength(4);
    expect(narrow.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(narrow.sessions.slice(0, 2).every((session) => session.learningMode === "learn")).toBe(true);
    expect(narrow.sessions.at(-1)?.learningMode).toBe("study");

    expect(broad.kind).toBe("course");
    expect(broad.sessions).toHaveLength(12);
    expect(broad.sessions.length).toBeGreaterThan(narrow.sessions.length);
    expect(broad.sessions.map((session) => session.title)).toEqual(expect.arrayContaining([
      "Understand limits as approaching behavior",
      "Build the derivative from first principles",
      "Build the accumulation and integral model",
      "Complete a cumulative calculus transfer",
    ]));
  });

  it("maps every visible study-guide section into bounded sessions", () => {
    const evaluationCase = matrixCase("world_war_one_guide_15");
    const plan = generatePreviewPlan(evaluationCase.request);
    const sourceText = evaluationCase.request.materials[0]?.textContent ?? "";
    const anchors = extractMaterialAnchors(sourceText);
    const mappedTargets = plan.sessions.flatMap((session) => session.contentTargets ?? []);

    expect(anchors.length).toBeGreaterThanOrEqual(8);
    expect(mappedTargets).toEqual(expect.arrayContaining(anchors));
    expect(plan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(plan.sessions.every((session) => (session.contentTargets?.length ?? 0) <= 2)).toBe(true);
    expect(plan.sessions[0]?.learningMode).toBe("learn");
    expect(plan.sessions.at(-1)?.learningMode).toBe("study");
  });

  it("uses more sessions instead of compressing the same unit into shorter windows", () => {
    const shortRequest = matrixCase("world_war_one_guide_15").request;
    const shortPlan = generatePreviewPlan(shortRequest);
    const longPlan = generatePreviewPlan({
      ...shortRequest,
      availability: shortRequest.availability.map((slot) => ({ ...slot, minutes: 45 })),
    });

    expect(shortPlan.sessions.length).toBeGreaterThan(longPlan.sessions.length);
    expect(shortPlan.sessions.every((session) => session.estimatedMinutes <= 15)).toBe(true);
    expect(longPlan.sessions.every((session) => session.estimatedMinutes <= 45)).toBe(true);
    expect(shortPlan.sessions.flatMap((session) => session.contentTargets ?? [])).toEqual(
      expect.arrayContaining(longPlan.sessions.flatMap((session) => session.contentTargets ?? [])),
    );
  });

  it("makes a general-learning pathway concrete without pretending it is a school course", () => {
    const plan = generatePreviewPlan(matrixCase("startup_funding_general_25").request);

    expect(plan.kind).toBe("topic");
    expect(plan.title).toBe("Startup Funding Foundations");
    expect(plan.sessions[0]?.learningMode).toBe("learn");
    expect(plan.sessions[0]?.objective).toMatch(/startup funding|funding stages|investor/i);
    expect(plan.sessions.every((session) => (
      session.contentTargets?.length && session.completionEvidence?.length
    ))).toBe(true);
  });

  it("carries learner preferences into delivery decisions without fixed-trait claims", () => {
    const plan = generatePreviewPlan(matrixCase("world_war_one_guide_15").request);
    const learnerFacingText = [
      plan.rationale,
      ...plan.sessions.map((session) => session.methodReason),
    ].join(" ");

    expect(learnerFacingText).toMatch(/big picture|overall model/i);
    expect(learnerFacingText).toMatch(/hint/i);
    expect(learnerFacingText).toMatch(/delay|few days/i);
    expect(learnerFacingText).not.toMatch(/learns? best|learning style|brain type/i);
  });
});

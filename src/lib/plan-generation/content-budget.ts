import type { PlanGenerationRequest } from "@/lib/plan-generation/schema";
import {
  inferPlanScopeContract,
  isNoviceRequest,
  type PlanScopeBand,
  type PlanScopeContract,
} from "@/lib/plan-generation/scope-contract";

export type SessionContentBudget = {
  minutes: number;
  preferredContentTargets: number;
  maximumContentTargets: number;
  maximumCompletionChecks: number;
  maximumLearnerFacingWords: number;
  guidance: string;
};

export type PlanContentBudget = {
  materialWordCount: number;
  materialAnchors: string[];
  estimatedInstructionalUnits: number;
  minimumDistinctTargets: number;
  minimumSessions: number;
  recommendedSessions: number;
  typicalSession: SessionContentBudget;
  reason: string;
};

/**
 * Converts time into a content limit. Time controls how much YOVA can cover,
 * while completion still depends on learner evidence rather than a timer.
 */
export function contentBudgetForMinutes(minutes: number): SessionContentBudget {
  if (minutes <= 15) {
    return {
      minutes,
      preferredContentTargets: 1,
      maximumContentTargets: 2,
      maximumCompletionChecks: 2,
      maximumLearnerFacingWords: 450,
      guidance: "Keep the session to one main idea when possible, with no more than two tightly connected targets, two evidence checks, and 450 learner-facing words.",
    };
  }
  if (minutes <= 30) {
    return {
      minutes,
      preferredContentTargets: 2,
      maximumContentTargets: 3,
      maximumCompletionChecks: 3,
      maximumLearnerFacingWords: 850,
      guidance: "Use one coherent concept cluster, normally two targets, followed by no more than three evidence checks and no more than 850 learner-facing words.",
    };
  }
  if (minutes <= 45) {
    return {
      minutes,
      preferredContentTargets: 3,
      maximumContentTargets: 4,
      maximumCompletionChecks: 4,
      maximumLearnerFacingWords: 1_200,
      guidance: "Use up to three substantial targets when they form one coherent lesson, with active evidence for each target and no more than 1,200 learner-facing words.",
    };
  }
  return {
    minutes,
    preferredContentTargets: 4,
    maximumContentTargets: 5,
    maximumCompletionChecks: 4,
    maximumLearnerFacingWords: 1_600,
    guidance: "Use at most four substantial targets in the normal case and no more than 1,600 learner-facing words. Preserve a coherent lesson rather than filling the full window with extra information.",
  };
}

export function buildPlanContentBudget(
  request: PlanGenerationRequest,
  scope: PlanScopeContract = inferPlanScopeContract(request),
): PlanContentBudget {
  const materialText = request.materials
    .map((material) => material.textContent ?? "")
    .filter(Boolean)
    .join("\n");
  const materialWordCount = materialText.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  const materialAnchors = extractMaterialAnchors(materialText);
  const baseUnits = baseInstructionalUnits(scope.band);
  const detectedUnits = materialAnchors.length > 0
    ? materialAnchors.length
    : materialWordCount > 0
      ? Math.ceil(materialWordCount / 450)
      : baseUnits;
  const estimatedInstructionalUnits = clamp(
    Math.max(baseUnits, detectedUnits),
    1,
    maximumInstructionalUnits(scope.band),
  );
  const typicalMinutes = median(request.availability.map((slot) => slot.minutes)) ?? 25;
  const typicalSession = contentBudgetForMinutes(typicalMinutes);
  const coverageSessions = Math.ceil(
    estimatedInstructionalUnits / typicalSession.preferredContentTargets,
  );
  const minimumSessions = request.intent === "study_now"
    ? 1
    : clamp(Math.max(scope.minimumSessions, coverageSessions), scope.minimumSessions, scope.maximumSessions);
  const recommendedSessions = request.intent === "study_now"
    ? 1
    : clamp(Math.max(scope.recommendedSessions, minimumSessions), minimumSessions, scope.maximumSessions);
  const minimumDistinctTargets = request.intent === "study_now"
    ? 1
    : Math.min(
      estimatedInstructionalUnits,
      recommendedSessions * typicalSession.maximumContentTargets,
    );
  const materialReason = request.materialMode === "upload"
    ? materialAnchors.length > 0
      ? `${materialAnchors.length} visible topic or section anchors were found in the uploaded material.`
      : `${materialWordCount} readable words were found, so YOVA estimated the number of coherent instructional units without treating every paragraph as a separate lesson.`
    : "No learner material was supplied, so YOVA is sizing the content from the stated goal and starting point.";
  const noviceReason = isNoviceRequest(request)
    ? "The learner is starting near the beginning, so teaching and guided use need room before independent review."
    : "The learner is reviewing, so existing knowledge can be checked before targeted repair.";

  return {
    materialWordCount,
    materialAnchors,
    estimatedInstructionalUnits,
    minimumDistinctTargets,
    minimumSessions,
    recommendedSessions,
    typicalSession,
    reason: `${materialReason} ${noviceReason} With a typical ${typicalMinutes}-minute window, YOVA should normally cover ${typicalSession.preferredContentTargets} ${typicalSession.preferredContentTargets === 1 ? "target" : "targets"} per session and preserve the rest for later sessions.`,
  };
}

export function extractMaterialAnchors(text: string) {
  if (!text.trim()) return [];
  const ignored = /^(study guide|notes?|review|unit|chapter|module|contents?|overview|learning objectives?|page \d+)$/i;
  const anchors: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const marked = /^(?:#{1,6}\s+|[-*•]\s+|\d{1,3}[.)]\s+)/.test(line);
    const cleaned = line
      .replace(/^(?:#{1,6}\s+|[-*•]\s+|\d{1,3}[.)]\s+)/, "")
      .replace(/\s*[:;]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const shortHeading = cleaned.length <= 100
      && words.length >= 2
      && words.length <= 14
      && !/[.!?].+[.!?]/.test(cleaned);
    const headingSignal = marked || /:\s*$/.test(line) || (shortHeading && !/[.!?]$/.test(cleaned));
    if (!headingSignal || cleaned.length < 5 || ignored.test(cleaned)) continue;
    const key = cleaned.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    anchors.push(cleaned.slice(0, 120));
    if (anchors.length >= 12) break;
  }

  return anchors;
}

function baseInstructionalUnits(band: PlanScopeBand) {
  if (band === "focused_skill") return 1;
  if (band === "unit_or_exam") return 4;
  return 8;
}

function maximumInstructionalUnits(band: PlanScopeBand) {
  if (band === "focused_skill") return 2;
  if (band === "unit_or_exam") return 10;
  return 12;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

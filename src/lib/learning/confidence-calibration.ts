import { z } from "zod";
import type { ConfidenceEvidence } from "@/lib/domain";

export const CONFIDENCE_LEVELS = ["guessing", "somewhat_sure", "very_sure"] as const;
export const CALIBRATION_PATTERNS = [
  "insufficient",
  "possible_misconception",
  "underestimated_knowledge",
  "well_calibrated",
  "mixed",
] as const;

export type CalibrationPattern = (typeof CALIBRATION_PATTERNS)[number];

export const ConfidenceEvidenceSchema = z.object({
  concept: z.string().trim().min(2).max(120),
  confidence: z.enum(CONFIDENCE_LEVELS),
  correct: z.boolean(),
  activityType: z.enum(["multiple_choice", "free_response"]),
});

export const ConfidenceEvidenceListSchema = z.array(ConfidenceEvidenceSchema).max(24);

export type ConfidenceCalibrationSummary = {
  pattern: CalibrationPattern;
  checkedAnswers: number;
  highConfidenceMisses: number;
  lowConfidenceSuccesses: number;
  title: string;
  explanation: string;
};

export function readConfidenceEvidenceProperty(resultData: unknown): ConfidenceEvidence[] {
  if (!resultData || typeof resultData !== "object" || Array.isArray(resultData)) return [];
  const candidate = (resultData as Record<string, unknown>).confidenceEvidence;
  const parsed = ConfidenceEvidenceListSchema.safeParse(candidate);
  return parsed.success ? parsed.data : [];
}

export function summarizeConfidenceCalibration(
  evidence: ConfidenceEvidence[],
): ConfidenceCalibrationSummary {
  const parsed = ConfidenceEvidenceListSchema.safeParse(evidence);
  const safeEvidence = parsed.success ? parsed.data : [];
  const highConfidenceMisses = safeEvidence.filter((item) => item.confidence === "very_sure" && !item.correct).length;
  const lowConfidenceSuccesses = safeEvidence.filter((item) => item.confidence === "guessing" && item.correct).length;

  if (highConfidenceMisses > 0 && lowConfidenceSuccesses > 0) {
    return {
      pattern: "mixed",
      checkedAnswers: safeEvidence.length,
      highConfidenceMisses,
      lowConfidenceSuccesses,
      title: "Your confidence revealed two useful signals",
      explanation: "One answer felt certain but needs repair, while another was correct even though you were unsure. YOVA will repair the misconception without reteaching what you already demonstrated.",
    };
  }

  if (highConfidenceMisses > 0) {
    return {
      pattern: "possible_misconception",
      checkedAnswers: safeEvidence.length,
      highConfidenceMisses,
      lowConfidenceSuccesses,
      title: "A confident answer needs repair",
      explanation: "You felt very sure about an answer that did not hold up. YOVA will treat that as a possible misconception and use explanation followed by a new application instead of repetition alone.",
    };
  }

  if (lowConfidenceSuccesses > 0) {
    return {
      pattern: "underestimated_knowledge",
      checkedAnswers: safeEvidence.length,
      highConfidenceMisses,
      lowConfidenceSuccesses,
      title: "You knew more than you expected",
      explanation: "You produced a correct answer while feeling unsure. YOVA will use another independent attempt to build reliable confidence instead of reteaching the whole idea.",
    };
  }

  if (safeEvidence.length >= 2) {
    return {
      pattern: "well_calibrated",
      checkedAnswers: safeEvidence.length,
      highConfidenceMisses,
      lowConfidenceSuccesses,
      title: "Your confidence matched the evidence",
      explanation: "Your confidence generally matched what you could demonstrate. YOVA can use the results directly without adding a separate confidence repair step.",
    };
  }

  return {
    pattern: "insufficient",
    checkedAnswers: safeEvidence.length,
    highConfidenceMisses,
    lowConfidenceSuccesses,
    title: "Confidence evidence is still building",
    explanation: "YOVA needs at least two confidence checks before describing a broader pattern.",
  };
}

export function confidenceResultMessage(confidence: ConfidenceEvidence["confidence"], correct: boolean) {
  if (confidence === "very_sure" && !correct) {
    return "You felt certain, but the result disagreed. YOVA will flag this as a possible misconception rather than a simple memory slip.";
  }
  if (confidence === "guessing" && correct) {
    return "You knew more than you expected. YOVA will confirm this with another independent attempt instead of reteaching immediately.";
  }
  return "This confidence rating is consistent with the result. It becomes one small piece of evidence, not a permanent label.";
}

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
  topicId: z.string().uuid().optional(),
  concept: z.string().trim().min(2).max(120),
  confidence: z.enum(CONFIDENCE_LEVELS),
  correct: z.boolean(),
  activityType: z.enum(["multiple_choice", "free_response"]),
  misconceptionSummary: z.string().trim().min(8).max(300).optional(),
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

export type TopicCalibrationSignal = {
  topicId?: string;
  concept: string;
  pattern: CalibrationPattern;
  checkedAnswers: number;
  highConfidenceMisses: number;
  lowConfidenceSuccesses: number;
  misconceptionSummary?: string;
  feedback: string;
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

export function buildTopicCalibrationSignals(
  evidence: ConfidenceEvidence[],
): TopicCalibrationSignal[] {
  const parsed = ConfidenceEvidenceListSchema.safeParse(evidence);
  if (!parsed.success) return [];
  const groups = new Map<string, ConfidenceEvidence[]>();
  for (const item of parsed.data) {
    const key = item.topicId ?? item.concept.trim().toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.values()].map((items) => {
    const summary = summarizeConfidenceCalibration(items);
    const latest = items.at(-1)!;
    const misconceptionSummary = [...items].reverse()
      .find((item) => !item.correct && item.misconceptionSummary)?.misconceptionSummary;
    return {
      ...(latest.topicId ? { topicId: latest.topicId } : {}),
      concept: latest.concept,
      pattern: summary.pattern,
      checkedAnswers: summary.checkedAnswers,
      highConfidenceMisses: summary.highConfidenceMisses,
      lowConfidenceSuccesses: summary.lowConfidenceSuccesses,
      ...(misconceptionSummary ? { misconceptionSummary } : {}),
      feedback: calibrationFeedback(summary.pattern, misconceptionSummary),
    };
  });
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

function calibrationFeedback(pattern: CalibrationPattern, misconceptionSummary?: string) {
  if (pattern === "possible_misconception" || pattern === "mixed") {
    return misconceptionSummary
      ? `You were confident about this distinction, but the evidence showed a specific mix-up: ${misconceptionSummary}. YOVA will ask you to distinguish those ideas directly.`
      : "You were confident about an answer that did not hold up. YOVA will use a direct discrimination check instead of treating it as an ordinary memory slip.";
  }
  if (pattern === "underestimated_knowledge") {
    return "You answered correctly while unsure. YOVA will use a light independent verification rather than reteaching the topic.";
  }
  if (pattern === "well_calibrated") {
    return "Your confidence matched the evidence for this topic, so YOVA can use the result without a separate calibration repair.";
  }
  return "YOVA does not have enough rated answers on this topic to infer a calibration pattern yet.";
}

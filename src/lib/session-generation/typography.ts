import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

export function polishGeneratedSessionTypography(draft: GeneratedSessionDraft): GeneratedSessionDraft {
  return {
    ...draft,
    rationale: polishLearnerText(draft.rationale),
    coverage: {
      focus: polishLearnerText(draft.coverage.focus),
      essentialIdeas: draft.coverage.essentialIdeas.map(polishLearnerText),
      completionEvidence: draft.coverage.completionEvidence.map(polishLearnerText),
      evidenceMap: draft.coverage.evidenceMap.map((mapping) => ({
        essentialIdea: polishLearnerText(mapping.essentialIdea),
        activityConcept: polishLearnerText(mapping.activityConcept),
      })),
      deferredContent: draft.coverage.deferredContent.map(polishLearnerText),
    },
    methodBriefing: {
      ...draft.methodBriefing,
      // Method names are versioned route/catalog identifiers, not generated
      // prose. Preserve punctuation such as the en dashes in
      // "Trace–Code–Test" exactly across generation, cache, and resume.
      name: draft.methodBriefing.name,
      what: polishLearnerText(draft.methodBriefing.what),
      why: polishLearnerText(draft.methodBriefing.why),
      how: draft.methodBriefing.how.map(polishLearnerText),
      completion: polishLearnerText(draft.methodBriefing.completion),
      personalization: draft.methodBriefing.personalization.map(polishLearnerText),
    },
    activities: draft.activities.map((activity) => ({
      ...activity,
      label: polishActivityLabel(activity.label),
      title: polishLearnerText(activity.title),
      body: polishLearnerText(activity.body),
      // Structured output can redundantly repeat the teaching block on later
      // questions. Keep teaching only on instruction screens so practice never
      // reveals or duplicates the lesson model.
      teaching: activity.type === "instruction" && activity.teaching ? {
        keyIdea: polishLearnerText(activity.teaching.keyIdea),
        explanation: polishLearnerText(activity.teaching.explanation),
        example: activity.teaching.example ? {
          setup: polishLearnerText(activity.teaching.example.setup),
          steps: activity.teaching.example.steps.map(polishLearnerText),
          takeaway: polishLearnerText(activity.teaching.example.takeaway),
        } : null,
        commonMistake: activity.teaching.commonMistake ? {
          mistake: polishLearnerText(activity.teaching.commonMistake.mistake),
          correction: polishLearnerText(activity.teaching.commonMistake.correction),
        } : null,
      } : null,
      choices: activity.choices.map(polishLearnerText),
      correctAnswer: activity.correctAnswer ? polishLearnerText(activity.correctAnswer) : null,
      feedback: activity.feedback ? polishLearnerText(activity.feedback) : null,
    })),
  };
}

export function polishLearnerText(value: string) {
  return value
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s*•\s*/g, "; ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/;{2,}/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function polishActivityLabel(value: string) {
  return polishLearnerText(value)
    .replace(/^question\s+\d+\s+of\s+\d+$/i, "Question")
    .replace(/^step\s+\d+\s+of\s+\d+$/i, "Activity")
    .replace(/^\d+\s*[.):_-]?\s*/i, "")
    .replace(/[.:]+$/g, "")
    .trim();
}

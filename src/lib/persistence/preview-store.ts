import type { LearningPlan, SessionCompletion, SessionInterruption, YovaPreviewSnapshot } from "@/lib/domain";
import { ConfidenceEvidenceListSchema } from "@/lib/learning/confidence-calibration";
import { inferLegacySessionLearningMode } from "@/lib/learning/learning-intent";
import { resolveLearningTitle } from "@/lib/intake/interpret";
import {
  readSessionEvidenceSnapshot,
  readSessionPendingRepair,
} from "@/lib/learning/session-resume";

const STORAGE_KEY = "yova.preview.v1";

export function loadPreviewSnapshot(): YovaPreviewSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isPreviewSnapshot(parsed)) return null;
    return {
      ...parsed,
      plans: parsed.plans.map(normalizePreviewPlan),
      deadlineMilestones: Array.isArray(parsed.deadlineMilestones) ? parsed.deadlineMilestones : [],
      sessionCompletions: parsed.sessionCompletions.map(normalizePreviewCompletion),
      sessionInterruptions: readSessionInterruptions(parsed),
    };
  } catch {
    return null;
  }
}

function normalizePreviewCompletion(completion: SessionCompletion): SessionCompletion {
  const parsed = ConfidenceEvidenceListSchema.safeParse(
    (completion as SessionCompletion & { confidenceEvidence?: unknown }).confidenceEvidence,
  );
  return {
    ...completion,
    confidenceEvidence: parsed.success ? parsed.data : [],
  };
}

function normalizePreviewPlan(plan: LearningPlan): LearningPlan {
  const learningIntent = plan.learningIntent === "learn" || plan.learningIntent === "study"
    ? plan.learningIntent
    : "study";
  return {
    ...plan,
    title: resolveLearningTitle(plan.title, plan.topic),
    learningIntent,
    sessions: plan.sessions.map((session) => ({
      ...session,
      learningMode: session.learningMode === "learn" || session.learningMode === "study"
        ? session.learningMode
        : inferLegacySessionLearningMode(session.method, session.objective),
    })),
  };
}

function readSessionInterruptions(snapshot: YovaPreviewSnapshot | Record<string, unknown>): SessionInterruption[] {
  const value = (snapshot as Record<string, unknown>).sessionInterruptions;
  if (!Array.isArray(value)) return [];

  return value.flatMap<SessionInterruption>((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const interruption = entry as SessionInterruption;
    const evidence = readSessionEvidenceSnapshot((entry as Record<string, unknown>).evidence);
    const pendingRepair = readSessionPendingRepair((entry as Record<string, unknown>).pendingRepair);
    const resumeStep = (entry as Record<string, unknown>).resumeStep;
    return [{
      ...interruption,
      ...(typeof resumeStep === "number" && Number.isInteger(resumeStep) ? { resumeStep } : {}),
      ...(evidence ? { evidence } : {}),
      ...(pendingRepair ? { pendingRepair } : {}),
    }];
  });
}

export function savePreviewSnapshot(snapshot: YovaPreviewSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearPreviewSnapshot() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function isPreviewSnapshot(value: unknown): value is YovaPreviewSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<YovaPreviewSnapshot>;
  return candidate.version === 1
    && Array.isArray(candidate.onboardingAnswers)
    && Array.isArray(candidate.plans)
    && Array.isArray(candidate.sessionCompletions)
    && typeof candidate.signedIn === "boolean"
    && typeof candidate.onboardingCompleted === "boolean"
    && typeof candidate.alphaEntered === "boolean";
}

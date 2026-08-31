import type { LearningPlan, SessionCompletion, SessionInterruption, YovaPreviewSnapshot } from "@/lib/domain";
import { ConfidenceEvidenceListSchema } from "@/lib/learning/confidence-calibration";
import { normalizeSessionCompletionProvenance } from "@/lib/learning/session-completion-provenance";
import { readSessionActivityProgress } from "@/lib/learning/session-activity-progress";
import { inferLegacySessionLearningMode } from "@/lib/learning/learning-intent";
import { resolveLearningTitle, resolveLearningTopic } from "@/lib/intake/interpret";
import {
  readSessionAdjustmentSnapshot,
  readSessionEvidenceSnapshot,
  readSessionPendingRepair,
} from "@/lib/learning/session-resume";
import { LEARNER_ANSWER_COUNT } from "@/lib/personalization/learner-profile";
import {
  PERSONALIZATION_STATE_ANSWER_INDEX,
  readPersonalizationStateValue,
  serializePersonalizationState,
} from "@/lib/personalization/personalization-state";
import { resolveSessionArchitectureVersion } from "@/lib/session-generation/architecture";
import { StudyRouteSchema } from "@/lib/study-route/schema";

const STORAGE_KEY = "yova.preview.v1";

export function loadPreviewSnapshot(): YovaPreviewSnapshot | null {
  const result = readPreviewSnapshotForExport();
  return result.ok ? result.value : null;
}

/** Fail-closed reader used when promising a portable current-device copy. */
export function readPreviewSnapshotForExport():
  | { ok: true; value: YovaPreviewSnapshot | null }
  | { ok: false } {
  if (typeof window === "undefined") return { ok: false };

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ok: true, value: null };
    const parsed: unknown = JSON.parse(stored);
    if (!isPreviewSnapshot(parsed)) return { ok: false };
    return { ok: true, value: {
      ...parsed,
      onboardingAnswers: normalizePreviewAnswers(parsed.onboardingAnswers),
      plans: parsed.plans.map(normalizePreviewPlan),
      deadlineMilestones: Array.isArray(parsed.deadlineMilestones) ? parsed.deadlineMilestones : [],
      sessionCompletions: parsed.sessionCompletions.map(normalizePreviewCompletion),
      sessionInterruptions: readSessionInterruptions(parsed),
    } };
  } catch {
    return { ok: false };
  }
}

function normalizePreviewCompletion(completion: SessionCompletion): SessionCompletion {
  const parsed = ConfidenceEvidenceListSchema.safeParse(
    (completion as SessionCompletion & { confidenceEvidence?: unknown }).confidenceEvidence,
  );
  return normalizeSessionCompletionProvenance({
    ...completion,
    confidenceEvidence: parsed.success ? parsed.data : [],
  });
}

function normalizePreviewPlan(plan: LearningPlan): LearningPlan {
  const learningIntent = plan.learningIntent === "learn" || plan.learningIntent === "study"
    ? plan.learningIntent
    : "study";
  const topic = resolveLearningTopic(plan.topic, plan.title);
  return {
    ...plan,
    title: resolveLearningTitle(plan.title, topic),
    topic,
    learningIntent,
    sessionArchitectureVersion: resolveSessionArchitectureVersion(plan, plan.knowledgeMap),
    sessions: plan.sessions.map((session) => {
      const { studyRoute: untrustedRoute, ...legacySession } = session;
      const studyRoute = StudyRouteSchema.safeParse(untrustedRoute);
      return {
        ...legacySession,
        learningMode: session.learningMode === "learn" || session.learningMode === "study"
          ? session.learningMode
          : inferLegacySessionLearningMode(session.method, session.objective),
        ...(studyRoute.success ? { studyRoute: studyRoute.data } : {}),
      };
    }),
  };
}

function readSessionInterruptions(snapshot: YovaPreviewSnapshot | Record<string, unknown>): SessionInterruption[] {
  const value = (snapshot as Record<string, unknown>).sessionInterruptions;
  if (!Array.isArray(value)) return [];

  return value.flatMap<SessionInterruption>((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as Record<string, unknown>;
    const interruption = { ...raw };
    delete interruption.sessionAdjustment;
    delete interruption.activityProgress;
    const evidence = readSessionEvidenceSnapshot(raw.evidence);
    const pendingRepair = readSessionPendingRepair(raw.pendingRepair);
    const sessionAdjustment = readSessionAdjustmentSnapshot(raw.sessionAdjustment);
    const activityProgress = readSessionActivityProgress(raw.activityProgress);
    const resumeStep = raw.resumeStep;
    return [{
      ...interruption as SessionInterruption,
      ...(typeof resumeStep === "number" && Number.isInteger(resumeStep) ? { resumeStep } : {}),
      ...(evidence ? { evidence } : {}),
      ...(pendingRepair ? { pendingRepair } : {}),
      ...(sessionAdjustment ? { sessionAdjustment } : {}),
      ...(activityProgress ? { activityProgress } : {}),
    }];
  });
}

export function savePreviewSnapshot(snapshot: YovaPreviewSnapshot) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...snapshot,
    onboardingAnswers: normalizePreviewAnswers(snapshot.onboardingAnswers),
    plans: snapshot.plans.map(normalizePreviewPlan),
    sessionInterruptions: readSessionInterruptions(snapshot),
  }));
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

function normalizePreviewAnswers(answers: readonly unknown[]) {
  const normalized = Array.from(
    { length: Math.max(LEARNER_ANSWER_COUNT, answers.length) },
    (_, index) => typeof answers[index] === "string" ? answers[index] : "",
  );
  const rawState = normalized[PERSONALIZATION_STATE_ANSWER_INDEX];
  normalized[PERSONALIZATION_STATE_ANSWER_INDEX] = rawState?.trim()
    ? serializePersonalizationState(readPersonalizationStateValue(rawState))
    : "";
  return normalized;
}

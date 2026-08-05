"use client";

import type {
  LearningPlan,
  LearningPlanSession,
  NextSessionAdaptation,
  PlanStatus,
  SessionCompletion,
  SessionStatus,
  SourceMode,
  StudyMode,
} from "@/lib/domain";
import { readConceptEvidenceProperty } from "@/lib/learning/concept-evidence";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const ONBOARDING_ANSWER_COUNT = 10;

type ProfileRow = {
  display_name: string;
  onboarding_completed_at: string | null;
};

type LearnerProfileRow = {
  common_blocker: string | null;
  guidance_preference: string | null;
  preferred_session_min: number | null;
  preferred_session_max: number | null;
  explanation_preference: string | null;
  focus_frequency: string | null;
  starting_pattern: string | null;
  energy_window: string | null;
  primary_improvement_goal: string | null;
  additional_context: string | null;
};

type LearningItemRow = {
  id: string;
  title: string;
  kind: LearningPlan["kind"];
  topic: string;
  deadline: string | null;
  source_mode: SourceMode;
  study_mode: StudyMode;
  created_at: string;
};

type PlanRow = {
  id: string;
  learning_item_id: string;
  status: PlanStatus;
  rationale: string;
  created_at: string;
};

type PlanSessionRow = {
  id: string;
  plan_id: string;
  sequence: number;
  title: string;
  objective: string;
  method: string;
  method_rationale: string;
  scheduled_for: string | null;
  estimated_minutes: number;
  status: SessionStatus;
  step_data: unknown;
};

type SessionAttemptRow = {
  id: string;
  plan_session_id: string;
  completed_at: string | null;
  correct_answers: number | null;
  total_answers: number | null;
  user_feedback: SessionCompletion["feedback"] | null;
  result_data: unknown;
};

type MaterialRow = {
  id: string;
  learning_item_id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  processing_status: string;
};

export type CloudLearningState = {
  displayName: string;
  onboardingCompleted: boolean;
  onboardingAnswers: string[];
  plans: LearningPlan[];
  sessionCompletions: SessionCompletion[];
};

export async function loadAuthenticatedLearningState(): Promise<CloudLearningState | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = createSupabaseBrowserClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const [profileResult, learnerProfileResult, itemsResult, plansResult, sessionsResult, attemptsResult, materialsResult] = await Promise.all([
    supabase.from("profiles").select("display_name,onboarding_completed_at").maybeSingle(),
    supabase.from("learner_profiles").select("common_blocker,guidance_preference,preferred_session_min,preferred_session_max,explanation_preference,focus_frequency,starting_pattern,energy_window,primary_improvement_goal,additional_context").maybeSingle(),
    supabase.from("learning_items").select("id,title,kind,topic,deadline,source_mode,study_mode,created_at").order("created_at", { ascending: true }),
    supabase.from("plans").select("id,learning_item_id,status,rationale,created_at").order("created_at", { ascending: true }),
    supabase.from("plan_sessions").select("id,plan_id,sequence,title,objective,method,method_rationale,scheduled_for,estimated_minutes,status,step_data").order("sequence", { ascending: true }),
    supabase.from("session_attempts").select("id,plan_session_id,completed_at,correct_answers,total_answers,user_feedback,result_data").not("completed_at", "is", null).order("completed_at", { ascending: true }),
    supabase.from("materials").select("id,learning_item_id,filename,mime_type,byte_size,processing_status").eq("processing_status", "ready").order("created_at", { ascending: true }),
  ]);

  const error = profileResult.error
    ?? learnerProfileResult.error
    ?? itemsResult.error
    ?? plansResult.error
    ?? sessionsResult.error
    ?? attemptsResult.error
    ?? materialsResult.error;
  if (error) throw new Error("YOVA could not load your cloud learning data.");

  const profile = profileResult.data as ProfileRow | null;
  const learnerProfile = learnerProfileResult.data as LearnerProfileRow | null;
  const itemRows = (itemsResult.data ?? []) as LearningItemRow[];
  const planRows = (plansResult.data ?? []) as PlanRow[];
  const sessionRows = (sessionsResult.data ?? []) as PlanSessionRow[];
  const attemptRows = (attemptsResult.data ?? []) as SessionAttemptRow[];
  const materialRows = (materialsResult.data ?? []) as MaterialRow[];

  const itemsById = new Map(itemRows.map((item) => [item.id, item]));
  const sessionsByPlanId = new Map<string, LearningPlanSession[]>();
  const planIdBySessionId = new Map<string, string>();
  const materialsByItemId = new Map<string, LearningPlan["materials"]>();

  for (const row of materialRows) {
    const current = materialsByItemId.get(row.learning_item_id) ?? [];
    current.push({
      id: row.id,
      name: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.byte_size,
      textContent: null,
      processingStatus: "ready",
    });
    materialsByItemId.set(row.learning_item_id, current);
  }

  for (const row of sessionRows) {
    const amountLabel = readTextProperty(row.step_data, "amountLabel")
      || `${row.estimated_minutes} min`;
    const session: LearningPlanSession = {
      id: row.id,
      sequence: row.sequence,
      title: row.title,
      objective: row.objective,
      method: row.method,
      methodReason: row.method_rationale,
      scheduledFor: row.scheduled_for ?? new Date().toISOString(),
      estimatedMinutes: row.estimated_minutes,
      amountLabel,
      status: row.status,
    };

    const current = sessionsByPlanId.get(row.plan_id) ?? [];
    current.push(session);
    sessionsByPlanId.set(row.plan_id, current);
    planIdBySessionId.set(row.id, row.plan_id);
  }

  const plans = planRows.flatMap<LearningPlan>((planRow) => {
    const item = itemsById.get(planRow.learning_item_id);
    if (!item) return [];
    const sessions = sessionsByPlanId.get(planRow.id) ?? [];
    sessions.sort((left, right) => left.sequence - right.sequence);

    return [{
      id: planRow.id,
      learningItemId: item.id,
      title: item.title,
      topic: item.topic,
      kind: item.kind,
      deadline: item.deadline,
      status: planRow.status,
      sourceMode: item.source_mode,
      studyMode: item.study_mode,
      rationale: planRow.rationale,
      createdAt: planRow.created_at || item.created_at,
      materials: materialsByItemId.get(item.id) ?? [],
      sessions,
    }];
  });

  const sessionCompletions = attemptRows.flatMap<SessionCompletion>((attempt) => {
    const planId = planIdBySessionId.get(attempt.plan_session_id);
    if (!planId || !attempt.completed_at) return [];

    return [{
      id: attempt.id,
      planId,
      planSessionId: attempt.plan_session_id,
      completedAt: attempt.completed_at,
      correctAnswers: attempt.correct_answers ?? 0,
      totalAnswers: attempt.total_answers ?? 0,
      feedback: isSessionFeedback(attempt.user_feedback) ? attempt.user_feedback : "about_right",
      observedGap: readTextProperty(attempt.result_data, "observedGap") || "No observation recorded",
      conceptEvidence: readConceptEvidenceProperty(attempt.result_data),
    }];
  });

  return {
    displayName: profile?.display_name?.trim() ?? "",
    onboardingCompleted: Boolean(profile?.onboarding_completed_at),
    onboardingAnswers: learnerProfileToAnswers(learnerProfile),
    plans,
    sessionCompletions,
  };
}

export async function saveAuthenticatedLearnerProfile(input: {
  displayName: string;
  onboardingAnswers: string[];
}) {
  if (!isSupabaseConfigured()) return;
  const [preferredSessionMin, preferredSessionMax] = parseSessionRange(input.onboardingAnswers[2]);
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("save_learner_profile", {
    payload: {
      displayName: input.displayName.trim(),
      onboardingCompletedAt: new Date().toISOString(),
      commonBlocker: input.onboardingAnswers[0] ?? "",
      guidancePreference: input.onboardingAnswers[1] ?? "",
      preferredSessionMin,
      preferredSessionMax,
      explanationPreference: input.onboardingAnswers[3] ?? "",
      focusFrequency: input.onboardingAnswers[4] ?? "",
      startingPattern: input.onboardingAnswers[5] ?? "",
      energyWindow: input.onboardingAnswers[6] ?? "",
      primaryImprovementGoal: input.onboardingAnswers[7] ?? "",
      additionalContext: input.onboardingAnswers[9] ?? "",
    },
  });

  if (error) throw new Error("YOVA could not save your learning profile to the cloud.");
}

export async function completeAuthenticatedPlanSession(completion: SessionCompletion, actualMinutes?: number, adaptation?: NextSessionAdaptation | null) {
  if (!isSupabaseConfigured()) return;
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("complete_plan_session", {
    payload: {
      attemptId: completion.id,
      planSessionId: completion.planSessionId,
      completedAt: completion.completedAt,
      actualMinutes: actualMinutes ?? null,
      correctAnswers: completion.correctAnswers,
      totalAnswers: completion.totalAnswers,
      feedback: completion.feedback,
      observedGap: completion.observedGap,
      conceptEvidence: completion.conceptEvidence,
      nextSessionAdjustment: adaptation ?? null,
    },
  });

  if (error) throw new Error("YOVA saved this session in your browser but could not sync it to the cloud.");
}

function learnerProfileToAnswers(profile: LearnerProfileRow | null) {
  const answers = Array.from({ length: ONBOARDING_ANSWER_COUNT }, () => "");
  if (!profile) return answers;

  answers[0] = profile.common_blocker ?? "";
  answers[1] = profile.guidance_preference ?? "";
  answers[2] = formatSessionRange(profile.preferred_session_min, profile.preferred_session_max);
  answers[3] = profile.explanation_preference ?? "";
  answers[4] = profile.focus_frequency ?? "";
  answers[5] = profile.starting_pattern ?? "";
  answers[6] = profile.energy_window ?? "";
  answers[7] = profile.primary_improvement_goal ?? "";
  // Index 8 is intentionally excluded. It is the optional health-related answer,
  // which YOVA does not need to retain for this first cloud personalization loop.
  answers[9] = profile.additional_context ?? "";
  return answers;
}

function parseSessionRange(answer?: string): [number | null, number | null] {
  if (!answer) return [null, null];
  const values = answer.match(/\d+/g)?.map(Number) ?? [];
  if (values.length < 2) return [null, null];
  return [values[0], values[1]];
}

function formatSessionRange(minimum: number | null, maximum: number | null) {
  if (minimum === null || maximum === null) return "";
  return `${minimum}–${maximum} minutes`;
}

function isSessionFeedback(value: unknown): value is SessionCompletion["feedback"] {
  return value === "too_easy" || value === "about_right" || value === "too_difficult";
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

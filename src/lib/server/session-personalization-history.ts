import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export const SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT = 100 as const;
export const SESSION_PLAN_ATTEMPT_HISTORY_LIMIT = 12 as const;
export const SESSION_PLAN_INTERRUPTION_HISTORY_LIMIT = 6 as const;

export type SessionPersonalizationAttemptRow = {
  user_id: string;
  id: string;
  plan_session_id: string;
  started_at: string;
  completed_at: string | null;
  actual_minutes: number | null;
  correct_answers: number | null;
  total_answers: number | null;
  user_feedback: unknown;
  result_data: unknown;
};

export type SessionPersonalizationInterruptionRow = {
  user_id: string;
  plan_session_id: string | null;
  occurred_at: string;
  event_data: unknown;
};

export type SessionPersonalizationHistorySource =
  | "plan_attempts"
  | "plan_interruptions"
  | "account_attempts"
  | "account_interruptions";

export type OptionalSessionPersonalizationHistory = {
  planAttempts: readonly SessionPersonalizationAttemptRow[];
  planInterruptions: readonly SessionPersonalizationInterruptionRow[];
  accountAttempts: readonly SessionPersonalizationAttemptRow[];
  accountInterruptions: readonly SessionPersonalizationInterruptionRow[];
  degradedSources: readonly SessionPersonalizationHistorySource[];
};

type QueryResult = {
  data: unknown;
  error: unknown;
};

type SettledOwnedRows<Row> = {
  available: boolean;
  rows: readonly Row[];
};

/**
 * Loads behavior signals that can improve a generated session but never
 * authorize it. Every read is owner-bound and bounded; unavailable or
 * ownership-indeterminate evidence is omitted instead of blocking the lesson.
 */
export async function readOptionalSessionPersonalizationHistory(
  supabase: SupabaseServerClient,
  {
    userId,
    planSessionIds,
  }: {
    userId: string;
    planSessionIds: readonly string[];
  },
): Promise<OptionalSessionPersonalizationHistory> {
  const boundedPlanSessionIds = [...new Set(planSessionIds)].slice(0, 200);
  const [planAttempts, planInterruptions, accountAttempts, accountInterruptions] = await Promise.all([
    boundedPlanSessionIds.length > 0
      ? settleOwnedRows<SessionPersonalizationAttemptRow>(
        supabase
          .from("session_attempts")
          .select("user_id,id,plan_session_id,started_at,completed_at,actual_minutes,correct_answers,total_answers,user_feedback,result_data")
          .eq("user_id", userId)
          .in("plan_session_id", boundedPlanSessionIds)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(SESSION_PLAN_ATTEMPT_HISTORY_LIMIT),
        userId,
        SESSION_PLAN_ATTEMPT_HISTORY_LIMIT,
      )
      : availableEmptyRows<SessionPersonalizationAttemptRow>(),
    boundedPlanSessionIds.length > 0
      ? settleOwnedRows<SessionPersonalizationInterruptionRow>(
        supabase
          .from("learning_events")
          .select("user_id,plan_session_id,occurred_at,event_data")
          .eq("user_id", userId)
          .eq("event_type", "session_interrupted")
          .in("plan_session_id", boundedPlanSessionIds)
          .order("occurred_at", { ascending: false })
          .limit(SESSION_PLAN_INTERRUPTION_HISTORY_LIMIT),
        userId,
        SESSION_PLAN_INTERRUPTION_HISTORY_LIMIT,
      )
      : availableEmptyRows<SessionPersonalizationInterruptionRow>(),
    settleOwnedRows<SessionPersonalizationAttemptRow>(
      supabase
        .from("session_attempts")
        .select("user_id,id,plan_session_id,started_at,completed_at,actual_minutes,correct_answers,total_answers,user_feedback,result_data")
        .eq("user_id", userId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT),
      userId,
      SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT,
    ),
    settleOwnedRows<SessionPersonalizationInterruptionRow>(
      supabase
        .from("learning_events")
        .select("user_id,plan_session_id,occurred_at,event_data")
        .eq("user_id", userId)
        .eq("event_type", "session_interrupted")
        .order("occurred_at", { ascending: false })
        .limit(SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT),
      userId,
      SESSION_ACCOUNT_PERSONALIZATION_HISTORY_LIMIT,
    ),
  ]);

  return {
    planAttempts: planAttempts.rows,
    planInterruptions: planInterruptions.rows,
    accountAttempts: accountAttempts.rows,
    accountInterruptions: accountInterruptions.rows,
    degradedSources: [
      ...(!planAttempts.available ? ["plan_attempts" as const] : []),
      ...(!planInterruptions.available ? ["plan_interruptions" as const] : []),
      ...(!accountAttempts.available ? ["account_attempts" as const] : []),
      ...(!accountInterruptions.available ? ["account_interruptions" as const] : []),
    ],
  };
}

async function settleOwnedRows<Row extends { user_id: string }>(
  query: PromiseLike<QueryResult>,
  userId: string,
  limit: number,
): Promise<SettledOwnedRows<Row>> {
  try {
    const result = await query;
    if (result.error || !Array.isArray(result.data) || result.data.length > limit) {
      return { available: false, rows: [] };
    }
    const rows = result.data as Row[];
    if (rows.some((row) => row.user_id !== userId)) {
      return { available: false, rows: [] };
    }
    return { available: true, rows };
  } catch {
    return { available: false, rows: [] };
  }
}

function availableEmptyRows<Row>(): Promise<SettledOwnedRows<Row>> {
  return Promise.resolve({ available: true, rows: [] });
}

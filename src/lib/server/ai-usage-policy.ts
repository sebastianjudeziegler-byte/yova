export type AIUsageAction =
  | "plan_generation"
  | "session_generation"
  | "lesson_generation"
  | "answer_evaluation"
  | "tutor_message"
  | "teaching_visual";

export type AIUsageLimit = { minute: number; day: number };
type PublicAccountEnvironment = {
  AUTH_PASSWORD_ACCOUNTS?: string;
  AUTH_INVITE_ONLY?: string;
};

const INVITE_ONLY_LIMITS: Record<AIUsageAction, AIUsageLimit> = {
  plan_generation: { minute: 5, day: 20 },
  session_generation: { minute: 8, day: 40 },
  lesson_generation: { minute: 12, day: 80 },
  answer_evaluation: { minute: 20, day: 120 },
  tutor_message: { minute: 15, day: 80 },
  teaching_visual: { minute: 2, day: 12 },
};

const PUBLIC_ACCOUNT_LIMITS: Record<AIUsageAction, AIUsageLimit> = {
  plan_generation: { minute: 3, day: 5 },
  session_generation: { minute: 5, day: 10 },
  lesson_generation: { minute: 8, day: 20 },
  answer_evaluation: { minute: 12, day: 40 },
  tutor_message: { minute: 10, day: 30 },
  teaching_visual: { minute: 1, day: 3 },
};

export function aiUsageLimitFor(action: AIUsageAction, publicAccounts: boolean): AIUsageLimit {
  return publicAccounts ? PUBLIC_ACCOUNT_LIMITS[action] : INVITE_ONLY_LIMITS[action];
}

export function publicPasswordAccountsAreOpen(env?: PublicAccountEnvironment) {
  const current = env ?? {
    AUTH_PASSWORD_ACCOUNTS: process.env.AUTH_PASSWORD_ACCOUNTS,
    AUTH_INVITE_ONLY: process.env.AUTH_INVITE_ONLY,
  };
  return current.AUTH_PASSWORD_ACCOUNTS === "true" && current.AUTH_INVITE_ONLY !== "true";
}

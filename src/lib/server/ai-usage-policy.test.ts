import { describe, expect, it } from "vitest";
import { aiUsageLimitFor, publicPasswordAccountsAreOpen } from "@/lib/server/ai-usage-policy";

describe("AI usage policy", () => {
  it("keeps the existing tester allowance while access is invite-only", () => {
    expect(aiUsageLimitFor("plan_generation", false)).toEqual({ minute: 5, day: 20 });
    expect(aiUsageLimitFor("teaching_visual", false)).toEqual({ minute: 2, day: 12 });
  });

  it("uses conservative per-account allowances when public password accounts are open", () => {
    expect(aiUsageLimitFor("plan_generation", true)).toEqual({ minute: 3, day: 5 });
    expect(aiUsageLimitFor("session_generation", true)).toEqual({ minute: 5, day: 10 });
    expect(aiUsageLimitFor("lesson_generation", true)).toEqual({ minute: 8, day: 20 });
    expect(aiUsageLimitFor("answer_evaluation", true)).toEqual({ minute: 12, day: 40 });
    expect(aiUsageLimitFor("tutor_message", true)).toEqual({ minute: 10, day: 30 });
    expect(aiUsageLimitFor("teaching_visual", true)).toEqual({ minute: 1, day: 3 });
  });

  it("does not treat a password-capable invite deployment as public", () => {
    expect(publicPasswordAccountsAreOpen({
      AUTH_PASSWORD_ACCOUNTS: "true",
      AUTH_INVITE_ONLY: "true",
    })).toBe(false);
    expect(publicPasswordAccountsAreOpen({
      AUTH_PASSWORD_ACCOUNTS: "true",
      AUTH_INVITE_ONLY: "false",
    })).toBe(true);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const DURABLE_AI_ACTIONS = [
  "plan_generation",
  "session_generation",
  "lesson_generation",
  "answer_evaluation",
  "tutor_message",
  "teaching_visual",
] as const;

describe("durable AI usage action migration", () => {
  test("keeps every server action in both the table constraint and RPC allowlist", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/202608100001_expand_ai_usage_actions.sql"),
      "utf8",
    );

    const [constraintSection, functionSection = ""] = migration.split("create or replace function public.claim_ai_request");
    for (const action of DURABLE_AI_ACTIONS) {
      expect(constraintSection).toContain(`'${action}'`);
      expect(functionSection).toContain(`'${action}'`);
    }
  });
});

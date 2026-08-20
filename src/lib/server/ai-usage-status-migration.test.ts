import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  process.cwd(),
  "supabase/migrations/202608190004_guided_session_allowance_status.sql",
);
const DURABLE_AI_ACTIONS = [
  "plan_generation",
  "session_generation",
  "lesson_generation",
  "answer_evaluation",
  "tutor_message",
  "teaching_visual",
] as const;

describe("read-only AI usage status migration", () => {
  it("reads the authenticated account's durable windows without consuming allowance", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");
    const functionBody = migration.match(/as \$status\$([\s\S]*?)\$status\$/i)?.[1] ?? "";

    expect(migration).toContain("create or replace function public.read_ai_usage_status");
    expect(functionBody).toContain("auth.uid()");
    expect(functionBody).toContain("user_id = current_user_id");
    expect(functionBody).toContain("window_kind = 'minute'");
    expect(functionBody).toContain("window_kind = 'day'");
    expect(functionBody).not.toMatch(/\binsert\s+into\b/i);
    expect(functionBody).not.toMatch(/\bupdate\s+public\./i);
    expect(functionBody).not.toMatch(/\bdelete\s+from\b/i);
    for (const action of DURABLE_AI_ACTIONS) {
      expect(functionBody).toContain(`'${action}'`);
    }
  });

  it("keeps the RPC private to authenticated accounts and returns server reset data", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain(
      "revoke all on function public.read_ai_usage_status(text, integer, integer) from public",
    );
    expect(migration).toContain(
      "revoke all on function public.read_ai_usage_status(text, integer, integer) from anon",
    );
    expect(migration).toContain(
      "grant execute on function public.read_ai_usage_status(text, integer, integer) to authenticated",
    );
    expect(migration).toContain("'retryAfterSeconds'");
    expect(migration).toContain("'resetAt'");
    expect(migration).toContain("'remainingToday'");
  });
});

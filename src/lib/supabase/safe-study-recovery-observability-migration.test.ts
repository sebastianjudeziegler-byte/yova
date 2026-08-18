import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608180003_safe_study_recovery_observability.sql", import.meta.url),
  "utf8",
).toLowerCase();

describe("safe-study recovery observability migration", () => {
  it("counts only the bounded recovery identifier without learner content", () => {
    expect(migration).toContain("event_data #>> '{diagnostics,recoverymode}' = 'safe_study'");
    expect(migration).toContain("'safestudyrecoveryattempts'");
    expect(migration).toContain("'safestudyrecoverysuccesses'");
    expect(migration).not.toContain("repairdetail");
    expect(migration).not.toContain("learnerprompt");
  });

  it("keeps the founder-only authenticated execution boundary", () => {
    expect(migration).toContain("public.founder_accounts");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.founder_generation_reliability(integer) from public, anon");
    expect(migration).toContain("grant execute on function public.founder_generation_reliability(integer) to authenticated");
  });
});

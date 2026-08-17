import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608170002_account_bound_learner_profile_save.sql",
  ),
  "utf8",
);

describe("account-bound learner-profile save migration", () => {
  it("replaces the existing RPC with a fail-closed account check before writes", () => {
    expect(migration).toContain("function public.save_learner_profile(payload jsonb)");
    expect(migration).toContain("security invoker\nset search_path = ''");
    expect(migration).toContain("expected_account_id uuid := nullif(payload ->> 'expectedAccountId', '')::uuid");
    expect(migration).toContain("expected_account_id is distinct from current_user_id");
    expect(migration.indexOf("expected_account_id is distinct from current_user_id"))
      .toBeLessThan(migration.indexOf("insert into public.profiles"));
    expect(migration).not.toContain("save_learner_profile_for_account");
  });

  it("allows only authenticated callers on the unchanged signature", () => {
    const signature = "public.save_learner_profile(jsonb)";
    expect(migration).toContain(`revoke all on function ${signature} from public, anon`);
    expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    expect(migration).not.toContain(`grant execute on function ${signature} to anon`);
  });
});

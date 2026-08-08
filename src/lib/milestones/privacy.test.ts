import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("deadline milestone privacy", () => {
  it("enables row-level security and restricts every operation to the owner", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/202608080001_deadline_milestones.sql"),
      "utf8",
    );
    expect(migration).toContain("alter table public.deadline_milestones enable row level security");
    expect(migration).toContain('create policy "deadline_milestones_owner_all"');
    expect(migration).toContain("using ((select auth.uid()) = user_id)");
    expect(migration).toContain("with check ((select auth.uid()) = user_id)");
  });
});

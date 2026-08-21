import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608200001_refund_failed_ai_generation_claims.sql"),
  "utf8",
);

describe("failed AI generation allowance refunds", () => {
  it("records an exact private claim with both charged windows", () => {
    expect(migration).toContain("create table public.ai_usage_claims");
    expect(migration).toContain("minute_window_started_at timestamptz not null");
    expect(migration).toContain("day_window_started_at timestamptz not null");
    expect(migration).toContain("'claimId', usage_claim_id");
    expect(migration).toContain("alter table public.ai_usage_claims enable row level security");
    expect(migration).toContain("revoke all on table public.ai_usage_claims from public, anon, authenticated");
  });

  it("releases the owner claim once and decrements both exact windows", () => {
    const release = migration.split("create or replace function public.release_ai_request_claim")[1] ?? "";
    expect(release).toContain("and user_id = current_user_id");
    expect(release).toContain("for update");
    expect(release).toContain("if not found or prior_release is not null");
    expect(release).toContain("window_kind = 'minute'");
    expect(release).toContain("window_kind = 'day'");
    expect(release).toContain("request_count = request_count - 1");
    expect(release).toContain("set released_at = now()");
  });

  it("exposes the two owner-scoped RPCs only to authenticated users", () => {
    for (const signature of [
      "public.claim_ai_request(text, integer, integer)",
      "public.release_ai_request_claim(uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon`);
      expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    }
  });
});

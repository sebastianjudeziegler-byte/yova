import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608190002_active_session_checkpoint_completion_mode.sql",
  ),
  "utf8",
);

describe("active-session checkpoint completion-mode migration", () => {
  it("delegates the mature checkpoint contract before appending provenance", () => {
    const lockStoredCheckpoint = migration.indexOf(
      "select session.step_data -> 'activeSessionCheckpoint'",
    );
    const delegate = migration.indexOf(
      "canonical_checkpoint := public.save_active_session_checkpoint(",
    );
    const append = migration.indexOf(
      "canonical_checkpoint := canonical_checkpoint || jsonb_build_object(",
    );

    expect(lockStoredCheckpoint).toBeGreaterThan(-1);
    expect(delegate).toBeGreaterThan(lockStoredCheckpoint);
    expect(delegate).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(delegate);
    expect(migration).toContain("payload - 'completionMode'");
    expect(migration).toContain("not in ('guided', 'unguided_practice')");
  });

  it("locks and preserves an authoritative stored mode before the delegate can rewrite it", () => {
    expect(migration).toContain(
      "stored_checkpoint ->> 'completionMode',\n      'guided'",
    );
    expect(migration).toMatch(
      /select session\.step_data -> 'activeSessionCheckpoint'[\s\S]+and session\.user_id = current_user_id\s+for update;/,
    );
    expect(migration).toContain(
      "requested_completion_mode is distinct from canonical_completion_mode",
    );
    expect(migration).toContain("message = 'active_session_checkpoint_conflict'");
  });

  it("updates only the owned run and refuses a conflicting stale return", () => {
    expect(migration).toContain("and user_id = current_user_id");
    expect(migration).toContain(
      "step_data -> 'activeSessionCheckpoint' ->> 'runId'",
    );
    expect(migration).toContain(
      "step_data -> 'activeSessionCheckpoint' ->> 'resourceFingerprint'",
    );
    expect(migration).toContain("canonical_checkpoint ? 'completionMode'");
    expect(migration).toContain(
      "canonical_checkpoint ->> 'completionMode'\n      is distinct from canonical_completion_mode",
    );
  });

  it("exposes only the authenticated wrapper", () => {
    const signature = "public.save_active_session_checkpoint_with_completion_mode(jsonb)";
    expect(migration).toContain(`revoke all on function ${signature} from public, anon`);
    expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    expect(migration).not.toContain(`grant execute on function ${signature} to anon`);
    expect(migration).toContain("security invoker");
  });
});

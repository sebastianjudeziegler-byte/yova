import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/202608200002_retrieval_round_recovery_progress.sql",
  "utf8",
).toLowerCase();

describe("retrieval-round recovery progress migration", () => {
  it("accepts only bounded ratings and never learner answer text", () => {
    expect(migration).toContain("public.is_valid_session_activity_progress(progress jsonb)");
    expect(migration).toContain("progress_key not in ('kind', 'activityindex', 'promptcount', 'ratings')");
    expect(migration).toContain("entry #>> '{}' not in ('got_it', 'partly', 'missed')");
    expect(migration).toContain("jsonb_array_length(progress -> 'ratings') > prompt_count * 2");
    expect(migration).not.toContain("learneranswer");
    expect(migration).not.toContain("answerdraft");
  });

  it("preserves same-step progress for older clients and strips it before the mature checkpoint RPC", () => {
    expect(migration).toContain("absence means preserve it");
    expect(migration).toContain("payload - 'completionmode' - 'activityprogress'");
    expect(migration).toContain("canonical_activity_progress := stored_activity_progress");
    expect(migration).toContain("ratings_have_common_prefix");
    expect(migration).toContain("'activityprogress',\n      canonical_activity_progress");
    expect(migration).toContain("caller_supports_activity_progress boolean := payload ? 'activityprogress'");
    expect(migration).toContain("else canonical_checkpoint - 'activityprogress'");
  });

  it("adds terminal progress only after the existing write and rejects divergent replays", () => {
    expect(migration).toContain("public.record_session_interruption_with_activity_progress");
    expect(migration).toContain("public.record_session_interruption(\n    payload - 'activityprogress'");
    expect(migration).toContain("from public.session_attempts as attempts");
    expect(migration).toContain("from public.learning_events as events");
    expect(migration).toContain("for update");
    expect(migration).toContain("requested_activity_progress is distinct from canonical_activity_progress");
    expect(migration).toContain("session_interruption_activity_progress_conflict");
    expect(migration).toContain("update public.session_attempts");
    expect(migration).toContain("update public.learning_events");
  });

  it("keeps both recovery writers authenticated-only", () => {
    expect(migration).toContain(
      "revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.save_active_session_checkpoint_with_completion_mode(jsonb) to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.record_session_interruption_with_activity_progress(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.record_session_interruption_with_activity_progress(jsonb) to authenticated",
    );
  });
});

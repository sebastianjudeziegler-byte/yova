import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608170001_cloud_active_session_checkpoints.sql",
  ),
  "utf8",
);

const [saveFunction = "", afterSave = ""] = migration.split(
  "create or replace function public.delete_active_session_checkpoint",
);
const [deleteFunction = "", afterDelete = ""] = afterSave.split(
  "create or replace function public.clear_invalid_active_session_checkpoint",
);

describe("cloud active-session checkpoint migration", () => {
  it("keeps both RPCs authenticated, invoker-secured, owner-scoped, and row-locked", () => {
    expect(saveFunction).toContain(
      "create or replace function public.save_active_session_checkpoint(payload jsonb)",
    );
    expect(saveFunction).toContain("security invoker\nset search_path = ''");
    expect(saveFunction).toContain("current_user_id uuid := auth.uid()");
    expect(saveFunction).toContain("and user_id = current_user_id\n  for update");

    expect(deleteFunction).toContain(
      "(\n  requested_plan_session_id uuid,\n  requested_run_id uuid default null\n)",
    );
    expect(deleteFunction).toContain("security invoker\nset search_path = ''");
    expect(deleteFunction).toContain("and user_id = current_user_id\n  for update");

    for (const signature of [
      "public.save_active_session_checkpoint(jsonb)",
      "public.delete_active_session_checkpoint(uuid, uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function ${signature} from public`);
      expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    }
    expect(migration).not.toContain("grant execute on function public.save_active_session_checkpoint(jsonb) to anon");
    expect(migration).not.toContain("grant execute on function public.delete_active_session_checkpoint(uuid, uuid) to anon");
  });

  it("accepts a strict bounded recovery shape and never accepts answer or tutor-text fields", () => {
    const rootAllowlist = saveFunction.match(
      /where root_key not in \(([\s\S]*?)\n      \)/,
    )?.[1] ?? "";
    expect(rootAllowlist).toContain("'runId'");
    expect(rootAllowlist).toContain("'resourceFingerprint'");
    expect(rootAllowlist).toContain("'resourceGeneratedAt'");
    expect(rootAllowlist).toContain("'pendingRepair'");
    expect(rootAllowlist).not.toContain("'accountId'");
    expect(rootAllowlist).not.toContain("'planId'");
    expect(rootAllowlist).not.toContain("'sessionAdjustment'");

    expect(saveFunction).toContain("from jsonb_object_keys(evidence)");
    expect(saveFunction).toContain("from jsonb_object_keys(concept_entry)");
    expect(saveFunction).toContain("from jsonb_object_keys(confidence_entry)");
    expect(saveFunction).toContain("where repair_key not in ('concept', 'correctAnswer')");
    expect(saveFunction).toContain("octet_length(evidence::text) > 20000");
    expect(saveFunction).toContain("octet_length(canonical_checkpoint::text) > 30000");
    expect(saveFunction).toContain("requested_active_seconds not between 0 and 21600");
    expect(saveFunction).toContain("requested_total_steps not between 1 and 24");
    expect(saveFunction).toContain("requested_saved_at < now() - interval '7 days'");
    expect(saveFunction).not.toContain("sessionAdjustment");

    for (const privateField of [
      "selectedAnswer",
      "learnerAnswer",
      "freeResponse",
      "evaluationProse",
      "tutorText",
      "streamedText",
      "repairSupport",
      "retryPrompt",
    ]) {
      expect(saveFunction).not.toContain(`'${privateField}'`);
    }
  });

  it("derives identity and receipt time on the server and stores only the authoritative object", () => {
    expect(saveFunction).toContain("'accountId', current_user_id::text");
    expect(saveFunction).toContain("'planId', requested_session.plan_id::text");
    expect(saveFunction).toContain("'planSessionId', requested_session.id::text");
    expect(saveFunction).toContain("'savedAt', now()");
    expect(saveFunction).toContain(
      "jsonb_typeof(requested_session.step_data -> 'generatedSession') <> 'object'",
    );
    expect(saveFunction).toContain(
      "jsonb_build_object('activeSessionCheckpoint', canonical_checkpoint)",
    );
    expect(saveFunction).toContain("return canonical_checkpoint");
    expect(saveFunction).toContain(
      "canonical_checkpoint := jsonb_set(\n        canonical_checkpoint,\n        '{startedAt}',\n        existing_checkpoint -> 'startedAt'",
    );
  });

  it("requires the exact authoritative generated lesson before saving", () => {
    expect(saveFunction).toContain("'resourceGeneratedAt'\n    ])");
    expect(saveFunction).toContain(
      "jsonb_typeof(payload -> 'resourceGeneratedAt') <> 'string'",
    );
    expect(saveFunction).toContain(
      "requested_resource_generated_at := (payload ->> 'resourceGeneratedAt')::timestamptz",
    );
    expect(saveFunction).toContain(
      "jsonb_typeof(requested_session.step_data -> 'generatedSession' -> 'generatedAt') <> 'string'",
    );
    expect(saveFunction).toContain(
      "requested_session.step_data -> 'generatedSession' ->> 'generatedAt'",
    );
    expect(saveFunction).toContain(
      "if stored_resource_generated_at <> requested_resource_generated_at then",
    );
    expect(saveFunction).toContain("canonical_checkpoint := payload || jsonb_build_object(");

    const sessionLock = saveFunction.indexOf("from public.plan_sessions");
    const generatedAtComparison = saveFunction.indexOf(
      "if stored_resource_generated_at <> requested_resource_generated_at then",
    );
    expect(sessionLock).toBeGreaterThan(-1);
    expect(generatedAtComparison).toBeGreaterThan(sessionLock);

    const comparisonSection = saveFunction.slice(
      saveFunction.indexOf(
        "if jsonb_typeof(requested_session.step_data -> 'generatedSession') <> 'object'",
      ),
      saveFunction.indexOf("canonical_checkpoint := payload"),
    );
    expect(comparisonSection.match(/errcode = '40001'/g)).toHaveLength(4);
    expect(comparisonSection.match(/message = 'active_session_checkpoint_conflict'/g))
      .toHaveLength(4);
  });

  it("serializes writers and preserves monotonic progress for one run and fingerprint", () => {
    expect(saveFunction).toContain(
      "coalesce(existing_checkpoint ->> 'runId', '') <> requested_run_id::text",
    );
    expect(saveFunction).toContain(
      "coalesce(existing_checkpoint ->> 'resourceFingerprint', '') <> payload ->> 'resourceFingerprint'",
    );
    expect(saveFunction).toContain("errcode = '40001'");
    expect(saveFunction).toContain("message = 'active_session_checkpoint_conflict'");
    expect(saveFunction).toContain(
      "existing_checkpoint ->> 'status' = 'awaiting_finish' and payload ->> 'status' = 'working'",
    );
    expect(saveFunction).toContain("requested_completed_steps < existing_completed_steps");
    expect(saveFunction).toContain("requested_resume_step < existing_resume_step");
    expect(saveFunction).toContain("requested_active_seconds < existing_active_seconds");
    expect(saveFunction).not.toContain("existing_total_steps <> requested_total_steps");
    expect(saveFunction).toContain("requested_saved_at <= existing_saved_at");
    expect(saveFunction).toContain("return existing_checkpoint");
  });

  it("rejects a late save after the same run has become a durable interruption", () => {
    expect(saveFunction).toContain(
      "if requested_session.status <> 'ready' then\n    raise exception using\n      errcode = '55000',\n      message = 'active_session_checkpoint_terminal'",
    );
    expect(saveFunction).toContain("from public.session_attempts");
    expect(saveFunction).toContain("where id = requested_run_id");
    expect(saveFunction).toContain("from public.learning_events");
    expect(saveFunction).toContain("and event_type = 'session_interrupted'");
    expect(saveFunction).toContain("event_data ->> 'attemptId' = requested_run_id::text");
    expect(saveFunction).toContain("message = 'active_session_checkpoint_terminal'");
  });

  it("cleans up on terminal status, lesson replacement, completion, and interruption", () => {
    expect(afterDelete).toContain("if new.status <> 'ready'");
    expect(afterDelete).toContain(
      "(old.step_data -> 'generatedSession') is distinct from (new.step_data -> 'generatedSession')",
    );
    expect(afterDelete).toContain(") - 'activeSessionCheckpoint'");
    expect(afterDelete).toContain(
      "create trigger plan_sessions_clear_invalid_active_session_checkpoint\nbefore update on public.plan_sessions",
    );
    expect(afterDelete).toContain(
      "create trigger learning_events_clear_interrupted_active_session_checkpoint\nafter insert on public.learning_events",
    );
    expect(afterDelete).toContain("when (new.event_type = 'session_interrupted')");
    expect(afterDelete).toContain(
      "step_data -> 'activeSessionCheckpoint' ->> 'runId' = new.event_data ->> 'attemptId'",
    );
  });
});

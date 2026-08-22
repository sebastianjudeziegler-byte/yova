import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608210009_durable_guided_session_continuations.sql",
  ),
  "utf8",
);

describe("durable guided-session continuation migration", () => {
  it("serializes the owned plan and complete curriculum before mutation", () => {
    const advisoryLock = migration.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const planLock = migration.indexOf("from public.plans as plan");
    const sessionLock = migration.indexOf("perform session.id");
    const firstShift = migration.indexOf("for shifted_session in");

    expect(migration).toContain("security invoker\nset search_path = ''");
    expect(advisoryLock).toBeGreaterThan(-1);
    expect(advisoryLock).toBeLessThan(planLock);
    expect(planLock).toBeLessThan(sessionLock);
    expect(sessionLock).toBeLessThan(firstShift);
    expect(migration).toContain("order by session.sequence\n  for update");
  });

  it("accepts only an ordered subset of exact stored targets and authoritative evidence scope", () => {
    expect(migration).toContain(
      "expected_content_targets is distinct from continuation -> 'contentTargets'",
    );
    expect(migration).toContain(
      "jsonb_array_length(original_content_targets) <= jsonb_array_length(continuation -> 'contentTargets')",
    );
    expect(migration).toContain(
      "continuation -> 'topicIds' is distinct from expected_topic_ids",
    );
    expect(migration).toContain("elsif jsonb_array_length(original_topic_ids) = 1 then");
    expect(migration).toContain(
      "The stored topic scope cannot be mapped safely to deferred targets.",
    );
    expect(migration).toContain(
      "'Explain or apply this remaining saved target independently: '",
    );
    expect(migration).toContain(
      "continuation -> 'completionEvidence' is distinct from expected_completion_evidence",
    );
    expect(migration).toContain("A protected review cannot create a deferred continuation.");
  });

  it("requires every scheduling field instead of allowing SQL null comparisons to pass", () => {
    expect(migration).toContain("nullif(continuation ->> 'sequence', '') is null");
    expect(migration).toContain("nullif(continuation ->> 'estimatedMinutes', '') is null");
    expect(migration).toContain("nullif(continuation ->> 'scheduledFor', '') is null");
  });

  it("fails closed before an imminent next session, protected review, or deadline", () => {
    expect(migration).toContain("session.sequence > completed_session.sequence");
    expect(migration).toContain("session.status in ('ready', 'upcoming')");
    expect(migration).toContain(
      "> next_session.scheduled_for",
    );
    expect(migration).toContain(
      "The deferred continuation does not fit before the next scheduled session or protected review.",
    );
    expect(migration).toContain(
      "> plan_deadline",
    );
    expect(migration).toContain(
      "The deferred continuation does not fit before the learning goal deadline.",
    );
  });

  it("preserves later ids and timestamps while making only the continuation ready", () => {
    const shift = migration.indexOf("for shifted_session in");
    const insert = migration.indexOf("insert into public.plan_sessions (");
    const complete = migration.indexOf("completed_plan_id := public.complete_plan_session");

    expect(shift).toBeLessThan(insert);
    expect(insert).toBeLessThan(complete);
    expect(migration.slice(shift, insert)).toContain("set sequence = shifted_session.sequence + 1");
    expect(migration.slice(shift, insert)).not.toContain("scheduled_for =");
    expect(migration.slice(insert, complete)).toContain("'upcoming'");
    expect(migration).toContain("session.status = 'ready'");
    expect(migration).toContain(") <> 1 then");
    expect(migration).toContain(
      "The guided continuation did not preserve one authoritative ready session.",
    );
  });

  it("is replay-stable and exposed only to authenticated callers", () => {
    expect(migration).toContain("existing_attempt.result_data -> 'continuationSession' is distinct from continuation");
    expect(migration).toContain("saved_continuation.id = continuation_id");
    expect(migration).toContain("return requested_plan.id;");
    expect(migration).toContain(
      "revoke all on function public.complete_guided_plan_session_with_continuation(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.complete_guided_plan_session_with_continuation(jsonb)\nto authenticated",
    );
  });
});

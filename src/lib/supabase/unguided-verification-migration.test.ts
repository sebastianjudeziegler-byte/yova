import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608190003_unguided_verification_sessions.sql",
), "utf8");

describe("unguided verification migration", () => {
  it("requires a replay-stable immediate verification with exact original targets", () => {
    expect(migration).toContain("verification_id <> requested_attempt_id");
    expect(migration).toContain("completed_session.sequence + 1");
    expect(migration).toContain("verification -> 'topicIds' <> expected_topic_ids");
    expect(migration).toContain("verification -> 'contentTargets' <> expected_content_targets");
    expect(migration).toContain("verification -> 'completionEvidence' <> expected_completion_evidence");
    expect(migration).toContain("coalesce(verification ->> 'reviewType', '') <> 'verify'");
    expect(migration).toContain("coalesce(verification ->> 'method', '') <> 'Independent retrieval verification'");
    expect(migration).toContain("nullif(verification ->> 'estimatedMinutes', '')::integer <> 10");
    expect(migration).toContain("is distinct from declared_completed_at + interval '1 day'");
  });

  it("bounds every copied contract array and validates topic identifiers", () => {
    expect(migration).toContain("jsonb_array_length(verification -> 'topicIds') not between 1 and 6");
    expect(migration).toContain("jsonb_array_length(verification -> 'contentTargets') not between 1 and 6");
    expect(migration).toContain("jsonb_array_length(verification -> 'completionEvidence') not between 1 and 4");
    expect(migration).toContain("jsonb_typeof(item.value) <> 'string'");
    expect(migration).toContain("length(btrim(item.value #>> '{}')) not between 5 and 180");
    expect(migration).toContain("length(btrim(item.value #>> '{}')) not between 8 and 220");
    expect(migration).toMatch(/\^\[0-9a-f\]\{8\}/);
  });

  it("shifts later curriculum in descending order and keeps it unchanged otherwise", () => {
    expect(migration).toMatch(/sequence > completed_session\.sequence[\s\S]+order by sequence desc/);
    expect(migration).toContain("set sequence = shifted_session.sequence + 1");
    expect(migration).not.toMatch(/set\s+title\s*=/i);
    expect(migration).not.toMatch(/set\s+objective\s*=/i);
    expect(migration).not.toMatch(/set\s+scheduled_for\s*=/i);
  });

  it("keeps provenance evidence-free while persisting the verification atomically", () => {
    expect(migration).toMatch(/'conceptEvidence',\s*'\[\]'::jsonb/);
    expect(migration).toMatch(/'confidenceEvidence',\s*'\[\]'::jsonb/);
    expect(migration).toContain("'followUpSession', null");
    expect(migration.indexOf("completed_plan_id := public.complete_plan_session(sanitized_payload)"))
      .toBeLessThan(migration.indexOf("insert into public.plan_sessions ("));
    expect(migration).toContain("'followUpSession', verification");
    expect(migration).toContain("'delayedVerificationScheduled', true");
  });

  it("is idempotent, bounded, and refuses an unguided verification loop", () => {
    expect(migration).toContain("existing_attempt.result_data -> 'followUpSession' ->> 'id'");
    expect(migration).toContain(
      "existing_attempt.result_data -> 'followUpSession' is distinct from verification",
    );
    expect(migration).toContain("return completed_plan_id");
    expect(migration).toContain("current_session_count >= 28");
    expect(migration).toContain("A required verification cannot be completed as ungraded practice.");
  });

  it("serializes on the owned session before replay detection and gates only new attempts", () => {
    const lockSession = migration.indexOf(
      "select *\n  into completed_session\n  from public.plan_sessions",
    );
    const findReplay = migration.indexOf(
      "select *\n  into existing_attempt\n  from public.session_attempts",
    );
    const replayReturn = migration.indexOf("return completed_plan_id;");
    const readyGate = migration.indexOf(
      "completed_session.status is distinct from 'ready'",
    );

    expect(lockSession).toBeGreaterThan(-1);
    expect(migration.slice(lockSession, findReplay)).toContain("for update");
    expect(findReplay).toBeGreaterThan(lockSession);
    expect(replayReturn).toBeGreaterThan(findReplay);
    expect(readyGate).toBeGreaterThan(replayReturn);
    expect(migration).toContain("The requested session is not ready for a new attempt.");
  });

  it("keeps the invoker RPC available only to authenticated learners", () => {
    const signature = "public.complete_unguided_plan_session(jsonb)";
    expect(migration).toContain("security invoker");
    expect(migration).toContain(`revoke all on function ${signature} from public, anon`);
    expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    expect(migration).not.toContain(`grant execute on function ${signature} to anon`);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608220001_align_unguided_verification_capacity.sql",
), "utf8");

describe("unguided verification capacity migration", () => {
  it("aligns the authoritative RPC with the fixed ten-minute generator budget", () => {
    expect(migration).toContain("create or replace function public.complete_unguided_plan_session(payload jsonb)");
    expect(migration).toContain("jsonb_array_length(verification -> 'topicIds') <> 1");
    expect(migration).toContain("jsonb_array_length(verification -> 'contentTargets') not between 1 and 2");
    expect(migration).toContain("jsonb_array_length(verification -> 'completionEvidence') not between 1 and 2");
    expect(migration).toContain("select count(distinct item.value #>> '{}')");
    expect(migration).toContain("> jsonb_array_length(verification -> 'contentTargets')");
    expect(migration).toContain("exceeds its ten-minute review capacity");
  });

  it("checks capacity before completing or inserting any durable session state", () => {
    const capacityGate = migration.indexOf("jsonb_array_length(verification -> 'contentTargets') not between 1 and 2");
    const completion = migration.indexOf("completed_plan_id := public.complete_plan_session(sanitized_payload)");
    const insertVerification = migration.indexOf("insert into public.plan_sessions (");

    expect(capacityGate).toBeGreaterThan(-1);
    expect(capacityGate).toBeLessThan(completion);
    expect(capacityGate).toBeLessThan(insertVerification);
  });

  it("still preserves exact original arrays and the replay-stable transaction", () => {
    expect(migration).toContain("verification -> 'topicIds' <> expected_topic_ids");
    expect(migration).toContain("verification -> 'contentTargets' <> expected_content_targets");
    expect(migration).toContain("verification -> 'completionEvidence' <> expected_completion_evidence");
    expect(migration).toContain("verification_id <> requested_attempt_id");
    expect(migration).toContain("existing_attempt.result_data -> 'followUpSession' is distinct from verification");
    expect(migration).toContain("security invoker");
  });
});

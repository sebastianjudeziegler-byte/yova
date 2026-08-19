import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608190001_unguided_practice_completion.sql",
), "utf8");

describe("unguided practice completion migration", () => {
  it("forces self-report evidence empty inside the transactional wrapper", () => {
    expect(migration).toContain("create or replace function public.complete_unguided_plan_session");
    expect(migration).toMatch(/'correctAnswers',\s*0/);
    expect(migration).toMatch(/'totalAnswers',\s*0/);
    expect(migration).toMatch(/'conceptEvidence',\s*'\[\]'::jsonb/);
    expect(migration).toMatch(/'confidenceEvidence',\s*'\[\]'::jsonb/);
    expect(migration).toContain("completed_plan_id := public.complete_plan_session(sanitized_payload)");
  });

  it("excludes unguided practice from teaching and evidence derivation", () => {
    const exclusions = migration.match(/<> 'unguided_practice'/g) ?? [];
    expect(exclusions.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("teaching_attempt.result_data ->> 'completionMode'");
    expect(migration).toContain("attempt.result_data ->> 'completionMode'");
  });

  it("preserves legitimate taught state while excluding the interim attempt", () => {
    expect(migration).toContain(
      "when coalesce(topic.value ->> 'status', 'not_started') = 'taught' then 'taught'",
    );
    expect(migration.match(/current_setting\('yova\.unguided_attempt_id', true\)/g))
      .toHaveLength(2);
    const setTransactionMarker = migration.indexOf("perform set_config(");
    const callBaseCompletion = migration.indexOf(
      "completed_plan_id := public.complete_plan_session(sanitized_payload)",
    );
    expect(setTransactionMarker).toBeGreaterThan(0);
    expect(callBaseCompletion).toBeGreaterThan(setTransactionMarker);
  });

  it("keeps missing legacy provenance guided and denies both RPCs to anonymous callers", () => {
    expect(migration).toContain("'guided'");
    expect(migration).toMatch(
      /revoke all on function public\.refresh_plan_knowledge_map_topic_statuses\(uuid, uuid\)\s+from public, anon;/,
    );
    expect(migration).toContain(
      "revoke all on function public.complete_unguided_plan_session(jsonb) from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.complete_unguided_plan_session(jsonb) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.refresh_plan_knowledge_map_topic_statuses(uuid, uuid)\n  to authenticated",
    );
  });

  it("keeps the nested refresh and completion functions as authenticated security invokers", () => {
    expect(migration.match(/security invoker/g)).toHaveLength(2);
    expect(migration).toContain(
      "perform public.refresh_plan_knowledge_map_topic_statuses(\n    completed_plan_id,",
    );
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608230003_route_bound_learning_records.sql",
), "utf8").toLocaleLowerCase();

function functionBody(name: string, nextName: string) {
  return migration.slice(
    migration.indexOf(`create or replace function public.${name}`),
    migration.indexOf(`create or replace function public.${nextName}`),
  );
}

const bindingFunction = functionBody(
  "assert_study_route_binding",
  "save_active_session_checkpoint_with_route",
);
const checkpointFunction = functionBody(
  "save_active_session_checkpoint_with_route",
  "complete_plan_session_with_route",
);
const completionFunction = functionBody(
  "complete_plan_session_with_route",
  "record_session_interruption_with_route",
);
const interruptionFunction = migration.slice(
  migration.indexOf("create or replace function public.record_session_interruption_with_route"),
  migration.indexOf("revoke all on function public.assert_study_route_binding"),
);

describe("route-bound learning-record migration", () => {
  it("locks the owned session and requires its exact committed route pointer", () => {
    expect(bindingFunction).toContain("security definer\nset search_path = ''");
    expect(bindingFunction).toContain("session.committed_route_revision_id");
    expect(bindingFunction).toContain("for update;");
    expect(bindingFunction).toContain(
      "committed_revision_id is distinct from requested_route_revision_id",
    );
    expect(bindingFunction).toContain("route.lifecycle = 'committed'");
    expect(bindingFunction).toContain("message = 'study_route_revision_conflict'");
  });

  it("dual-reads checkpoint V1/V2 but stores route-bound work as canonical V2", () => {
    expect(checkpointFunction).toContain("requested_version not in (1, 2)");
    expect(checkpointFunction).toContain(
      "perform public.assert_study_route_binding",
    );
    expect(checkpointFunction).toContain(
      "public.save_active_session_checkpoint_with_completion_mode(",
    );
    expect(checkpointFunction).toContain("'version', 2");
    expect(checkpointFunction).toContain("'routerevisionid', requested_route_revision_id");
    expect(checkpointFunction).toContain(
      "session.committed_route_revision_id = requested_route_revision_id",
    );
  });

  it("delegates each completion variant and stamps the exact attempt and event", () => {
    expect(completionFunction).toContain(
      "requested_variant not in ('guided', 'unguided_practice', 'guided_continuation')",
    );
    expect(completionFunction).toContain("public.complete_plan_session(");
    expect(completionFunction).toContain("public.complete_unguided_plan_session(");
    expect(completionFunction).toContain(
      "public.complete_guided_plan_session_with_continuation(",
    );
    expect(completionFunction).toContain("message = 'study_route_evidence_conflict'");
    expect(completionFunction).toContain("update public.session_attempts as attempt");
    expect(completionFunction).toContain("event.event_type = 'session_completed'");
    expect(completionFunction).toContain(
      "event.event_data ->> 'attemptid' = requested_attempt_id::text",
    );
  });

  it("wraps both interruption paths and stamps route identity after mature validation", () => {
    expect(interruptionFunction).toContain(
      "perform public.assert_study_route_binding",
    );
    expect(interruptionFunction).toContain(
      "public.record_session_interruption_with_activity_progress(",
    );
    expect(interruptionFunction).toContain("public.record_session_interruption(");
    expect(interruptionFunction).toContain("update public.session_attempts as attempt");
    expect(interruptionFunction).toContain("event.event_type = 'session_interrupted'");
    expect(interruptionFunction).toContain("message = 'study_route_interruption_conflict'");
  });

  it("keeps helper access private and exposes only the three route-aware boundaries", () => {
    expect(migration).toContain(
      "revoke all on function public.assert_study_route_binding(uuid, uuid)\nfrom public, anon, authenticated",
    );
    for (const functionName of [
      "save_active_session_checkpoint_with_route",
      "complete_plan_session_with_route",
      "record_session_interruption_with_route",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${functionName}(jsonb)\nfrom public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant execute on function public.${functionName}(jsonb)\nto authenticated`,
      );
    }
  });
});

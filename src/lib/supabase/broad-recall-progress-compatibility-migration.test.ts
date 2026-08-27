import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240004_broad_recall_progress_compatibility.sql",
), "utf8").toLocaleLowerCase();

function section(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

const validator = section(
  "create or replace function public.is_valid_session_activity_progress",
  "create or replace function public.merge_session_activity_progress_v1",
);
const merger = section(
  "create or replace function public.merge_session_activity_progress_v1",
  "create or replace function public.assert_broad_recall_progress_binding_v1",
);
const binding = section(
  "create or replace function public.assert_broad_recall_progress_binding_v1",
  "create or replace function public.save_active_session_checkpoint_with_completion_mode",
);
const checkpoint = section(
  "create or replace function public.save_active_session_checkpoint_with_completion_mode",
  "create or replace function public.record_session_interruption_with_activity_progress",
);
const interruption = section(
  "create or replace function public.record_session_interruption_with_activity_progress",
  "create or replace function public.guard_broad_recall_checkpoint_binding_v1",
);
const checkpointGuard = section(
  "create or replace function public.guard_broad_recall_checkpoint_binding_v1",
  "create or replace function public.guard_broad_recall_attempt_binding_v1",
);

describe("broad-recall progress compatibility migration", () => {
  it("locks every durable progress table and refuses to grandfather unknown broad markers", () => {
    expect(migration).toContain([
      "lock table",
      "  public.plan_sessions,",
      "  public.session_attempts,",
      "  public.learning_events",
      "in share row exclusive mode;",
    ].join("\n"));
    expect(migration).toContain(
      "'{activesessioncheckpoint,activityprogress,kind}'",
    );
    expect(migration).toContain("attempt.result_data #>> '{activityprogress,format}'");
    expect(migration).toContain("event.event_data #>> '{activityprogress,kind}'");
    expect(migration.match(/pg_catalog\.lower\(pg_catalog\.btrim\(coalesce\(/gu))
      .toHaveLength(6);
    expect(migration).toContain("message = 'broad_recall_progress_preflight_failed'");
  });

  it("keeps the mature retrieval-round validator and its deterministic retry queue", () => {
    expect(validator).toContain("progress ->> 'kind' = 'retrieval_round'");
    expect(validator).toContain(
      "progress_key not in ('kind', 'activityindex', 'promptcount', 'ratings')",
    );
    expect(validator).toContain("prompt_count not between 3 and 10");
    expect(validator).toContain("pg_catalog.array_fill(0, array[prompt_count])");
    expect(validator).toContain("rating_value in ('partly', 'missed')");
    expect(validator).toContain("attempts[active_index + 1] < 2");
  });

  it("accepts only the exact transcript-free BroadRecallProgress root and bindings", () => {
    expect(validator).toContain(
      "pg_catalog.jsonb_typeof(progress -> 'kind') is distinct from 'string'",
    );
    expect(validator).toContain(
      "progress ->> 'kind' is distinct from 'broad_recall'",
    );
    expect(validator).toContain(
      "progress ->> 'format' is distinct from 'broad_recall_v1'",
    );
    expect(validator).toContain("activity_index not between 0 and 23");
    expect(validator).toContain("gap_count not between 1 and 6");
    expect(validator).toContain("binding_count not between 1 and 3");
    expect(validator).toContain("pg_catalog.octet_length(progress::text) > 3500");
    expect(validator).toContain(
      "binding_key not in ('targetid', 'evidenceid')",
    );
    expect(validator).toContain(
      "'blurting-final-check:' || (binding ->> 'targetid')",
    );
    expect(validator).toContain(
      "pg_catalog.count(distinct binding.value ->> 'targetid')",
    );
    for (const forbidden of [
      "answerdraft",
      "learneranswer",
      "rawtext",
      "correctedtext",
      "transcript",
    ]) {
      expect(validator).not.toContain(`'${forbidden}'`);
    }
  });

  it("requires the canonical immutable comparison-correction-transfer event prefix", () => {
    expect(validator).toContain("event_ordinality = 1");
    expect(validator).toContain(
      "pg_catalog.jsonb_typeof(progress_event -> 'type') is distinct from 'string'",
    );
    expect(validator).toContain(
      "progress_event ->> 'type' is distinct from 'comparison_completed'",
    );
    expect(validator).toContain(
      "pg_catalog.jsonb_array_length(progress_event -> 'gapstatuses') <> gap_count",
    );
    expect(validator).toContain("('covered', 'partial', 'missing')");
    expect(validator).toContain("event_ordinality = 2");
    expect(validator).toContain(
      "progress_event ->> 'type' is distinct from 'correction_completed'",
    );
    expect(validator).toContain("event_ordinality = 3");
    expect(validator).toContain(
      "progress_event ->> 'type' is distinct from 'transfer_evaluated'",
    );
    expect(validator).toContain(
      "pg_catalog.jsonb_array_length(progress_event -> 'results') <> binding_count",
    );
    expect(validator).toContain("('secure', 'needs_review', 'unverified')");
  });

  it("merges only equal identities with a common immutable prefix", () => {
    expect(merger).toContain(
      "pg_catalog.jsonb_typeof(stored_progress) is distinct from 'object'",
    );
    expect(merger).toContain(
      "pg_catalog.jsonb_typeof(requested_progress) is distinct from 'object'",
    );
    expect(merger).toContain(
      "stored_progress ->> 'kind'\n      is distinct from requested_progress ->> 'kind'",
    );
    expect(merger).toContain("stored_progress ->> 'promptcount'");
    expect(merger).toContain("stored_progress ->> 'format'");
    expect(merger).toContain("stored_progress ->> 'gapcount'");
    expect(merger).toContain(
      "stored_progress -> 'bindings'\n        is distinct from requested_progress -> 'bindings'",
    );
    expect(merger).toContain("stored_progress -> 'events' -> prefix_index");
    expect(merger).toContain("requested_progress -> 'events' -> prefix_index");
    expect(merger).toContain("when requested_count >= stored_count then requested_progress");
    expect(merger).toContain("message = 'active_session_checkpoint_conflict'");
  });

  it("binds broad progress to the committed Blurting route and exact cached resource", () => {
    expect(binding).toContain("route.lifecycle = 'committed'");
    expect(binding).toContain(
      "route_payload #>> '{approach,visiblesupportingtechniqueid}'",
    );
    expect(binding).toContain(
      "perform public.assert_study_route_blurting_recipe_v1(route_payload)",
    );
    expect(binding).toContain(
      "generated_session ->> 'routerevisionid'\n      is distinct from committed_route_revision_id::text",
    );
    expect(binding).toContain(
      "generated_session #>> '{cachecontext,routerevisionid}'",
    );
    expect(binding).toContain(
      "stored_resource_generated_at\n      is distinct from requested_resource_generated_at",
    );
    expect(binding).toContain("requested_resource_generated_at is null");
    expect(binding).toContain("generated_session -> 'topicids' is distinct from active_target_ids");
    expect(binding).toContain("broad_runtime_count <> 1");
    expect(binding).toContain("method_runtime ->> 'format' is distinct from 'broad_recall_v1'");
    expect(binding).toContain(
      "pg_catalog.jsonb_array_length(method_runtime -> 'gapchecklist') <> gap_count",
    );
  });

  it("keeps answer-bearing repair and unverified evidence out of broad checkpoints", () => {
    expect(checkpointGuard).toContain("checkpoint -> 'pendingrepair' is not null");
    expect(checkpointGuard).toContain("checkpoint -> 'evidence' is not null");
    expect(checkpointGuard).toContain(
      "message = 'broad_recall_unverified_evidence_forbidden'",
    );
  });

  it("pins the whole resource to the three route-owned phases and one retrieve runtime", () => {
    expect(binding).toContain(
      "pg_catalog.jsonb_array_length(generated_session -> 'activities') <> 3",
    );
    expect(binding).toContain("for phase_index in 0..2 loop");
    expect(binding).toContain(
      "pg_catalog.jsonb_typeof(resource_phase -> 'estimatedminutes')\n        is distinct from 'number'",
    );
    expect(binding).toContain(
      "resource_phase -> 'requiredforcompletion'\n        is distinct from 'true'::jsonb",
    );
    expect(binding).toContain(
      "resource_phase ->> 'methodphase'\n        is distinct from route_phase ->> 'methodphase'",
    );
    expect(binding).toContain(
      "resource_phase ->> 'estimatedminutes'\n        is distinct from route_phase ->> 'activeminutes'",
    );
    expect(binding).toContain(
      "phase_index <> activity_index\n        and resource_phase -> 'methodruntime' is distinct from 'null'::jsonb",
    );
    expect(binding).toContain("generated_activity ->> 'methodphase' is distinct from 'retrieve'");
    expect(binding).toContain("broad_runtime_count <> 1");
    expect(binding).toContain("not (method_runtime ?& array[");
    for (const requiredField of [
      "'sourceclosedreminder'",
      "'prompts'",
      "'comparisoninstructions'",
      "'gapchecklist'",
      "'correctioninstruction'",
      "'transferprompt'",
      "'targetbindings'",
    ]) {
      expect(binding).toContain(requiredField);
    }
    expect(binding).toContain("runtime_key not in (");
    expect(binding).toContain(
      "not ((method_runtime #> '{prompts,0}') ?& array[",
    );
    expect(binding).toContain("prompt_key not in ('prompt', 'expectedanswer', 'hint')");
    expect(binding).toContain(
      "not ((method_runtime -> 'transferprompt') ?& array[",
    );
    expect(binding).toContain("transfer_key not in (");
    expect(binding).toContain("'[[:space:]]+'");
  });

  it("requires the runtime's strict ordered target bindings to equal durable progress bindings", () => {
    expect(binding).toContain("method_runtime -> 'targetbindings'");
    expect(binding).toContain("'comparisoncriterion'");
    expect(binding).toContain("'transfersuccesscriterion'");
    expect(binding).toContain(
      "runtime_binding_identity is distinct from progress -> 'bindings'",
    );
    expect(binding).toContain(
      "runtime_binding ->> 'evidenceid'\n        is distinct from 'blurting-final-check:' || (runtime_binding ->> 'targetid')",
    );
  });

  it("preserves same-step progress for old clients without changing their response shape", () => {
    expect(checkpoint).toContain(
      "caller_supports_activity_progress boolean := payload ? 'activityprogress'",
    );
    expect(checkpoint).toContain(
      "canonical_activity_progress := public.merge_session_activity_progress_v1(",
    );
    expect(checkpoint).toContain("payload - 'completionmode' - 'activityprogress'");
    expect(checkpoint).toContain(
      "when caller_supports_activity_progress then canonical_checkpoint",
    );
    expect(checkpoint).toContain("else canonical_checkpoint - 'activityprogress'");
  });

  it("requires exact terminal interruption replay and never prefix-merges it", () => {
    expect(interruption).toContain("payload - 'activityprogress'");
    expect(interruption).toContain("expected_attempt_result := pg_catalog.jsonb_build_object(");
    expect(interruption).toContain("expected_event_data := pg_catalog.jsonb_build_object(");
    expect(interruption).toContain(
      "stored_attempt_result - 'activityprogress' - 'routerevisionid'",
    );
    expect(interruption).toContain(
      "stored_event_data - 'activityprogress' - 'routerevisionid'",
    );
    expect(interruption).toContain("stored_event_count <> 1");
    expect(interruption).toContain(
      "requested_activity_progress is distinct from canonical_activity_progress",
    );
    expect(interruption).not.toContain("merge_session_activity_progress_v1");
  });

  it("fails broad interruption closed until a wrapper carries exact resource identity", () => {
    const failClosed = interruption.indexOf(
      "message = 'broad_recall_interruption_resource_identity_required'",
    );
    const matureDelegate = interruption.indexOf(
      "interrupted_plan_id := public.record_session_interruption(",
    );
    expect(failClosed).toBeGreaterThan(0);
    expect(failClosed).toBeLessThan(matureDelegate);
    expect(interruption).toContain(
      "a later route-aware wrapper must capture and verify resource identity",
    );
    expect(migration.match(
      /message = 'broad_recall_interruption_resource_identity_required'/gu,
    )).toHaveLength(3);
  });

  it("guards checkpoint, attempt, and interruption-event storage below the wrappers", () => {
    for (const guard of [
      "guard_broad_recall_checkpoint_binding_v1",
      "guard_broad_recall_attempt_binding_v1",
      "guard_broad_recall_event_binding_v1",
    ]) {
      expect(migration).toContain(`create or replace function public.${guard}`);
      expect(migration).toContain(`revoke all on function public.${guard}()`);
    }
    expect(migration).toContain(
      "progress ->> 'activityindex' is distinct from completed_steps::text",
    );
    expect(migration).toContain(
      "before update of step_data on public.plan_sessions",
    );
    expect(migration).toContain(
      "before insert or update of result_data on public.session_attempts",
    );
    expect(migration).toContain(
      "before insert or update of event_type, event_data on public.learning_events",
    );
  });

  it("preserves security modes, empty search paths, signatures, and final ACL", () => {
    expect(validator).toContain("immutable\nset search_path = ''");
    expect(checkpoint).toContain("security invoker\nset search_path = ''");
    expect(interruption).toContain("security definer\nset search_path = ''");
    expect(migration).toContain(
      "revoke all on function public.save_active_session_checkpoint_with_completion_mode(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.record_session_interruption_with_activity_progress(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.is_valid_session_activity_progress(jsonb)\nto authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.assert_broad_recall_progress_binding_v1",
    );
    expect(migration).not.toContain(
      "create or replace function public.save_active_session_checkpoint_with_route",
    );
    expect(migration).not.toContain(
      "create or replace function public.record_session_interruption_with_route",
    );
  });

  it("does not repeat identifiers inside any function DECLARE block", () => {
    expect(binding.match(/^  activity_index integer;$/gm)).toHaveLength(1);
    expect(
      interruption.match(
        /^  requested_activity_progress jsonb := payload -> 'activityprogress';$/gm,
      ),
    ).toHaveLength(1);

    const functionDeclarations = [...migration.matchAll(
      /create or replace function public\.([a-z0-9_]+)[\s\S]*?as \$\$\ndeclare\n([\s\S]*?)\nbegin\n/gu,
    )];
    expect(functionDeclarations).toHaveLength(8);

    for (const declaration of functionDeclarations) {
      const declarationBlock = declaration[2] ?? "";
      const identifiers = declarationBlock
        .split("\n")
        .map((line) => line.match(/^  ([a-z][a-z0-9_]*)\s/)?.[1])
        .filter((identifier): identifier is string => Boolean(identifier));
      expect(new Set(identifiers).size).toBe(identifiers.length);
    }
  });

  it("does not schema-qualify PostgreSQL special forms", () => {
    expect(migration).not.toMatch(
      /pg_catalog\.(?:coalesce|nullif|least|greatest)\s*\(/u,
    );
  });
});

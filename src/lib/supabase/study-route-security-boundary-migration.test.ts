import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608230010_study_route_security_boundary.sql",
  ),
  "utf8",
).toLocaleLowerCase();
const archiveMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608050002_archive_learning_plans.sql",
  ),
  "utf8",
).toLocaleLowerCase();
const routeAdjustmentMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608230007_route_aware_plan_adjustment.sql",
  ),
  "utf8",
).toLocaleLowerCase();

describe("StudyRoute security-boundary migration", () => {
  it("makes the low-level route commit private and closes direct evidence DML", () => {
    expect(migration).toContain(
      "revoke all on function public.commit_study_route_revision(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on table public.session_attempts, public.learning_events\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select on table public.session_attempts, public.learning_events\nto authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.commit_study_route_revision(jsonb)",
    );
    expect(migration).not.toMatch(
      /revoke\s+(?:insert|update|delete|all)[\s\S]{0,80}on table public\.(?:plans|learning_items|materials|material_chunks)/,
    );
  });

  it("keeps the authenticated archive RPC atomic across the private event boundary", () => {
    expect(archiveMigration).toContain("security invoker");
    expect(archiveMigration).toContain("insert into public.learning_events");
    expect(migration).toContain(
      "alter function public.set_learning_plan_archive_state(jsonb) security definer",
    );
    expect(migration).toContain(
      "revoke all on function public.set_learning_plan_archive_state(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.set_learning_plan_archive_state(jsonb)\nto authenticated",
    );
  });

  it("serializes mature account writers before their private delegates acquire row locks", () => {
    const wrappers = [
      {
        name: "set_learning_plan_archive_state",
        signature: "jsonb",
        delegate: "set_learning_plan_archive_state_without_account_lock_v1",
        invocation: "payload",
      },
      {
        name: "save_learner_profile",
        signature: "jsonb",
        delegate: "save_learner_profile_without_account_lock_v1",
        invocation: "payload",
      },
      {
        name: "delete_yova_account",
        signature: "uuid",
        delegate: "delete_yova_account_without_account_lock_v1",
        invocation: "expected_account_id",
      },
    ];

    for (const { name, signature, delegate, invocation } of wrappers) {
      const wrapper = functionBody(name);
      expect(migration).toContain(
        `alter function public.${name}(${signature})\nrename to ${delegate}`,
      );
      expect(migration).toContain(
        `revoke all on function public.${delegate}(${signature})\nfrom public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant execute on function public.${name}(${signature})\nto authenticated`,
      );
      expect(wrapper).toContain("security definer\nset search_path = ''");
      expect(wrapper).toContain("pg_catalog.hashtext('yova_learning_data')");
      expect(wrapper).toContain("pg_catalog.hashtext(current_user_id::text)");
      expect(wrapper.indexOf("pg_advisory_xact_lock")).toBeLessThan(
        wrapper.indexOf(`public.${delegate}(${invocation})`),
      );
    }
  });

  it("installs one private BEFORE INSERT semantic validator and preflights existing rows", () => {
    const validator = functionBody("assert_study_route_payload_v1");
    expect(validator).toContain("security definer\nset search_path = ''");
    expect(migration).toContain(
      "revoke all on function public.assert_study_route_payload_v1(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "create trigger study_routes_validate_payload_v1\nbefore insert on public.study_routes",
    );
    expect(migration).toContain(
      "select route.route_payload\n    from public.study_routes as route",
    );
    expect(migration.indexOf("create trigger study_routes_validate_payload_v1")).toBeLessThan(
      migration.indexOf("select route.route_payload\n    from public.study_routes as route"),
    );

    for (const root of [
      "target",
      "approach",
      "timing",
      "execution",
      "agency",
      "explanation",
      "provenance",
    ]) {
      expect(validator).toContain(`'${root}'`);
    }
  });

  it("covers canonical enums, bounds, uniqueness, references, and timing invariants", () => {
    const validator = functionBody("assert_study_route_payload_v1");
    for (const contractMarker of [
      "'memorization', 'conceptual_learning', 'problem_solving'",
      "'retrieval_practice', 'spaced_retrieval', 'self_explanation'",
      "'inside_yova', 'outside_yova'",
      "'router_default', 'profile_recommendation', 'observed_outcome_adjustment'",
      "'orient', 'model', 'read_source', 'retrieve', 'explain'",
      "'retrieval', 'application', 'explanation', 'artifact', 'verification'",
      "'user_materials', 'yova_generated', 'trusted_external_source'",
      "study_route_semantic_phase_minutes_invalid",
      "study_route_semantic_active_deferred_overlap",
      "study_route_semantic_target_coverage_invalid",
      "study_route_semantic_target_reference_invalid",
      "study_route_semantic_active_target_capacity_invalid",
      "break_phase_ordinality",
      "alternative_signature = primary_signature",
    ]) {
      expect(validator, contractMarker).toContain(contractMarker);
    }
    expect(validator).toContain("phase_minutes <> active_minutes");
    expect(validator).toContain(
      "timing -> 'activeminutes', 5, 180",
    );
    expect(validator).toContain("elapsed_minutes <> active_minutes + break_minutes");
    expect(validator).toContain("scheduled_for <= last_observed_at");
    expect(validator).toContain("target_id = any(deferred_ids)");
    expect(validator).toContain(
      "source_requirements ->> 'sourcetype' = 'yova_generated'",
    );
    expect(validator).toContain(
      "source_requirements ->> 'sourcetype' = 'trusted_external_source'",
    );
    expect(validator).toContain(
      "approach ->> 'executionenvironment' <> 'outside_yova'",
    );
    expect(validator).toContain("active_target_count > 6");
    expect(validator).toContain(
      "approach -> 'visiblemethodname', 2, 90",
    );
    expect(validator).toContain(
      "provenance -> 'routerversion', 1, 256",
    );
    expect(validator).toContain(
      "alternative -> 'visiblemethodname', 2, 90",
    );
    expect(validator).toContain(
      "pg_catalog.jsonb_array_length(execution -> 'completionevidence') not between 1 and 4",
    );
  });

  it("projects only non-deferred targets into the bounded six-topic session contract", () => {
    const activeProjection = functionBody("study_route_active_topic_ids_v1");
    expect(activeProjection).toContain(
      "requested_route #> '{execution,deferredtargets}'",
    );
    expect(activeProjection).toContain(
      "where deferred.value ->> 'targetid' = target.value ->> 'targetid'",
    );
    expect(functionBody("persist_route_session_arrays")).toContain(
      "projected_topic_ids := public.study_route_active_topic_ids_v1(requested_route)",
    );
    expect(functionBody("assert_committed_study_route_projection")).toContain(
      "projected_topic_ids := public.study_route_active_topic_ids_v1(requested_route)",
    );
    expect(migration).toContain(
      "revoke all on function public.study_route_active_topic_ids_v1(jsonb)\nfrom public, anon, authenticated",
    );
  });

  it("repairs migration-005 deferred topics before validating existing projections", () => {
    const reconcile = functionBody("reconcile_active_plan_route_topics_v1");
    expect(reconcile).toContain("update public.plan_sessions as session");
    expect(reconcile).toContain("public.study_route_active_topic_ids_v1(route.route_payload)");
    expect(reconcile).toContain("study_route_topic_reconciliation_checkpointed");
    expect(reconcile).toContain("session.step_data - 'generatedsession'");
    expect(reconcile).not.toContain("- 'activesessioncheckpoint'");
    expect(migration).toContain(
      "create trigger plans_reconcile_route_topics_on_activation_v1\nafter update of status on public.plans",
    );
    expect(migration).toContain("where plan.status = 'active'");
    expect(migration).toContain("message = 'existing_study_route_projection_invalid'");
    expect(migration).toContain(
      "projected.completion_evidence\n          is distinct from session.step_data -> 'completionevidence'",
    );
  });

  it("checks the exact route/session projection after the pointer is visible", () => {
    const projection = functionBody("assert_study_route_pointer_projection_v1");
    expect(migration).toContain(
      "create trigger plan_sessions_assert_route_projection_v1\nafter update of committed_route_revision_id on public.plan_sessions",
    );
    expect(projection).toContain("pointed_route.lifecycle <> 'committed'");
    expect(projection).toContain("'{approach,visiblemethodname}'");
    expect(projection).toContain("'{timing,activeminutes}'");
    expect(projection).toContain("'{approach,executionenvironment}'");
    expect(projection).toContain("'{target,sourcerequirements,sourcetype}'");
    expect(projection).toContain(
      "when 'trusted_external_source' then 'yova_generated'",
    );
    expect(projection).toContain("expected_source_mode is distinct from stored_source_mode");
    expect(projection).toContain(
      "projected_topic_ids is distinct from new.step_data -> 'topicids'",
    );
    expect(projection).toContain(
      "public.study_route_active_topic_ids_v1(\n    pointed_route.route_payload",
    );
    expect(projection).toContain(
      "projected_completion_evidence\n      is distinct from new.step_data -> 'completionevidence'",
    );
  });

  it("protects routed parent associations and validates item scalars at final transaction state", () => {
    const planGuard = functionBody("guard_routed_plan_learning_item_v1");
    const itemProjection = functionBody(
      "assert_learning_item_route_projection_v1",
    );

    expect(migration).toContain(
      "create trigger plans_guard_routed_learning_item_v1\nbefore update of learning_item_id on public.plans",
    );
    expect(planGuard).toContain(
      "new.learning_item_id is not distinct from old.learning_item_id",
    );
    expect(planGuard).toContain(
      "session.committed_route_revision_id is not null",
    );
    expect(planGuard).toContain("routed_plan_learning_item_immutable");

    expect(migration).toContain(
      "create constraint trigger learning_items_assert_route_projection_v1\nafter update of study_mode, source_mode on public.learning_items\ndeferrable initially deferred",
    );
    expect(migration).toContain(
      "old.study_mode is distinct from new.study_mode\n  or old.source_mode is distinct from new.source_mode",
    );
    expect(itemProjection).toContain(
      "pg_catalog.hashtext('yova_learning_data')",
    );
    expect(itemProjection).toContain(
      "pg_catalog.hashtext(new.user_id::text)",
    );
    expect(itemProjection).toContain(
      "select item.study_mode, item.source_mode",
    );
    expect(itemProjection).toContain(
      "learning_item_study_route_serialization_conflict",
    );
    expect(itemProjection.indexOf("pg_try_advisory_xact_lock")).toBeLessThan(
      itemProjection.indexOf("select item.study_mode, item.source_mode"),
    );
    expect(itemProjection).toContain(
      "session.committed_route_revision_id is not null",
    );
    expect(itemProjection).toContain("'{approach,executionenvironment}'");
    expect(itemProjection).toContain(
      "'{target,sourcerequirements,sourcetype}'",
    );
    expect(itemProjection).toContain(
      "when 'trusted_external_source' then 'yova_generated'",
    );
    expect(itemProjection).toContain(
      "learning_item_study_route_projection_conflict",
    );
  });

  it("keeps completed and skipped route history outside mutable item projection", () => {
    const itemProjection = functionBody(
      "assert_learning_item_route_projection_v1",
    );

    expect(routeAdjustmentMigration).toContain(
      "move only unfinished rows out of the non-deferrable scheduling range",
    );
    expect(routeAdjustmentMigration).toContain(
      "and session.status in ('ready', 'upcoming')",
    );
    expect(routeAdjustmentMigration).toContain("status = 'skipped'");
    expect(itemProjection).toContain(
      "session.status in ('ready', 'upcoming')",
    );
    expect(migration).toContain(
      "session.status in ('ready', 'upcoming')\n          and (\n            route.route_payload #>> '{approach,executionenvironment}'",
    );
    expect(itemProjection).not.toContain("session.status <> 'skipped'");
  });

  it("requires complete route coverage for new plans while preserving all-null legacy plans", () => {
    const coverage = functionBody("assert_active_plan_route_coverage_v1");
    const markerGuard = functionBody("guard_plan_route_coverage_marker_v1");
    expect(migration).toContain(
      "alter table public.plans\nadd column study_route_coverage_required boolean not null default false",
    );
    expect(migration).toContain(
      "alter column study_route_coverage_required set default true",
    );
    expect(migration.indexOf("add column study_route_coverage_required")).toBeLessThan(
      migration.indexOf("create trigger study_routes_validate_payload_v1"),
    );
    expect(migration.indexOf("add column study_route_coverage_required")).toBeLessThan(
      migration.indexOf("update public.plan_sessions as session"),
    );
    expect(markerGuard).toContain(
      "new.study_route_coverage_required := true",
    );
    expect(markerGuard).toContain(
      "new.study_route_coverage_required\n      is distinct from old.study_route_coverage_required",
    );
    expect(markerGuard).toContain("study_route_coverage_marker_immutable");
    expect(migration).toContain(
      "create trigger plans_guard_route_coverage_marker_v1\nbefore insert or update on public.plans",
    );
    expect(migration).toContain(
      "message = 'partial_plan_study_route_coverage_forbidden'",
    );
    expect(migration).toContain(
      "create constraint trigger plans_require_route_coverage_v1\nafter insert or update on public.plans\ndeferrable initially deferred",
    );
    expect(coverage).toContain("new.status <> 'active'");
    expect(coverage).toContain("old.status = 'active'");
    expect(coverage).toContain(
      "pg_catalog.count(session.committed_route_revision_id)::integer",
    );
    expect(coverage).toContain(
      "routed_sessions > 0 and routed_sessions < total_sessions",
    );
    expect(coverage).toContain("new.study_route_coverage_required");
    expect(coverage).toContain(
      "total_sessions < 1 or routed_sessions <> total_sessions",
    );
    expect(coverage).toContain("active_plan_study_route_coverage_required");
  });

  it("enforces route-owned planned minutes beneath completion, interruption, and checkpoint writers", () => {
    expect(migration).toContain(
      "create trigger session_attempts_guard_route_minutes_v1\nbefore insert or update of plan_session_id, user_id, result_data",
    );
    expect(migration).toContain(
      "create trigger learning_events_guard_route_minutes_v1\nbefore insert or update of plan_session_id, user_id, event_type, event_data",
    );
    expect(migration).toContain(
      "create trigger plan_sessions_guard_private_json_v1\nbefore update of step_data on public.plan_sessions",
    );
    for (const body of [
      functionBody("guard_routed_attempt_minutes_v1"),
      functionBody("guard_routed_event_minutes_v1"),
      functionBody("guard_plan_session_private_json_v1"),
    ]) {
      expect(body).toContain("'{timing,activeminutes}'");
      expect(body).toContain("plannedminutes");
      expect(body).toMatch(/requested_planned_minutes\s*<>\s*route_active_minutes/);
    }
  });

  it("bounds cache JSON and requires its minimal durable shape", () => {
    const guard = functionBody("guard_plan_session_private_json_v1");
    expect(guard).toContain("pg_catalog.octet_length(generated_session::text) > 524288");
    expect(guard).toContain("generated_session -> 'schemaversion'");
    expect(guard).toContain("generated_schema_version not in (15, 16, 17)");
    for (const requiredField of [
      "model",
      "generatedat",
      "rationale",
      "coverage",
      "methodbriefing",
      "deliverypolicy",
      "topicids",
      "activities",
    ]) {
      expect(guard).toContain(`generated_session -> '${requiredField}'`);
    }
  });

  it("allows other evidence but exactly one expected route-origin receipt", () => {
    const origin = functionBody("assert_study_route_origin_reference");
    expect(origin).toContain("like 'route-revision:%'");
    expect(origin).toContain("route_reference_count <> 1");
    expect(origin).toContain("expected_reference_count <> 1");
    expect(origin).toContain("origin.lifecycle = 'committed'");
    expect(migration).toContain(
      "revoke all on function public.assert_study_route_origin_reference(\n  jsonb, uuid, uuid\n) from public, anon, authenticated",
    );
  });

  it("does not schema-qualify PostgreSQL special forms", () => {
    expect(migration).not.toContain("pg_catalog.coalesce(");
    expect(migration).not.toContain("pg_catalog.nullif(");
  });
});

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", start) + 3;
  return migration.slice(start, end);
}

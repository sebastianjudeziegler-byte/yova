import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240003_blurting_recipe_compatibility.sql",
), "utf8").toLocaleLowerCase();
const permitMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240002_plan_activation_permits.sql",
), "utf8").toLocaleLowerCase();

function functionBody(signature: string, revokeSignature: string) {
  const start = migration.indexOf(`create or replace function ${signature}`);
  const end = migration.indexOf(`revoke all on function ${revokeSignature}`, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

const blurtingHelper = functionBody(
  "public.assert_study_route_blurting_recipe_v1(",
  "public.assert_study_route_blurting_recipe_v1(jsonb)",
);
const payloadAssertion = functionBody(
  "public.assert_study_route_payload_v1(",
  "public.assert_study_route_payload_v1(jsonb)",
);
const payloadGuard = functionBody(
  "public.guard_study_route_payload_v1()",
  "public.guard_study_route_payload_v1()",
);
const methodChoice = functionBody(
  "public.change_plan_session_method_with_route(",
  "public.change_plan_session_method_with_route(jsonb)",
);
const compactHelper = blurtingHelper.replace(/\s+/gu, " ");
const compactPayloadAssertion = payloadAssertion.replace(/\s+/gu, " ");
const compactGuard = payloadGuard.replace(/\s+/gu, " ");
const compactChoice = methodChoice.replace(/\s+/gu, " ");

describe("Blurting recipe compatibility migration", () => {
  it("locks route writes before a complete zero-signal preflight and never rewrites historical rows", () => {
    const lock = migration.indexOf(
      "lock table public.study_routes in share row exclusive mode",
    );
    const preflight = migration.indexOf(
      "message = 'blurting_recipe_marker_preflight_failed'",
    );
    const helper = migration.indexOf(
      "create or replace function public.assert_study_route_blurting_recipe_v1(",
    );
    const compactPreflight = migration.slice(lock, helper).replace(/\s+/gu, " ");
    const transaction = migration.lastIndexOf("\nbegin;\n", lock);
    const commit = migration.lastIndexOf("\ncommit;");

    expect(lock).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(transaction);
    expect(preflight).toBeGreaterThan(lock);
    expect(helper).toBeGreaterThan(preflight);
    expect(commit).toBeGreaterThan(helper);
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain(
      "where (route.route_payload #> '{approach}')\n"
      + "      ? 'visiblesupportingtechniqueid'",
    );
    for (const signal of [
      "'{approach,visiblemethodname}'",
      "route.route_payload #> '{agency,alternatives}'",
      "alternative.value ->> 'alternativeid'",
      "'{provenance,routerversion}'",
      "route.route_payload #> '{provenance,ruletrace}'",
      "'method_recipe_v1'",
      "'recipe:blurting_v1'",
      "'blurting_recipe_runtime_v1'",
    ]) {
      expect(migration.slice(lock, helper)).toContain(signal);
    }
    expect(migration.slice(lock, helper)).toContain(
      "pg_catalog.lower(pg_catalog.btrim(",
    );
    expect(compactPreflight).toContain(
      "pg_catalog.right( pg_catalog.btrim(coalesce( alternative.value ->> 'alternativeid', '' )), pg_catalog.length(':blurting_v1') ) = ':blurting_v1'",
    );
    expect(compactPreflight).toContain(
      "where pg_catalog.btrim(component.value) = 'blurting_recipe_runtime_v1'",
    );
    expect(compactPreflight).toContain(
      "pg_catalog.btrim(coalesce( trace.value ->> 'ruleid', '' )) = 'blurting_recipe_runtime_v1'",
    );
    expect(compactPreflight).toContain(
      "pg_catalog.btrim(coalesce( trace.value ->> 'result', '' )) = 'recipe:blurting_v1'",
    );
    expect(migration).not.toMatch(/(?:insert into|update|delete from) public\.study_routes/u);
    expect(migration).not.toContain("alter table public.study_routes");
  });

  it("validates every existing payload under the same write lock before replacing the guard", () => {
    const assertion = migration.indexOf(
      "create or replace function public.assert_study_route_payload_v1(",
    );
    const rescan = migration.indexOf("for existing_payload in", assertion);
    const guard = migration.indexOf(
      "create or replace function public.guard_study_route_payload_v1()",
      assertion,
    );

    expect(rescan).toBeGreaterThan(assertion);
    expect(guard).toBeGreaterThan(rescan);
    expect(migration.slice(rescan, guard)).toContain(
      "perform public.assert_study_route_payload_v1(existing_payload)",
    );
    expect(migration.slice(rescan, guard)).toContain(
      "order by route.created_at, route.route_revision_id",
    );
  });

  it("keeps the recipe helper private, deterministic, and search-path pinned", () => {
    expect(blurtingHelper).toContain(
      "language plpgsql\nimmutable\nsecurity definer\nset search_path = ''",
    );
    expect(migration).toContain(
      "revoke all on function public.assert_study_route_blurting_recipe_v1(jsonb)\n"
      + "from public, anon, authenticated, service_role",
    );
    expect(migration).not.toContain(
      "grant execute on function public.assert_study_route_blurting_recipe_v1",
    );
  });

  it("makes only exact current markers active while allowing append-only trace history", () => {
    expect(compactHelper).toContain(
      "if approach ? 'visiblesupportingtechniqueid' and pg_catalog.btrim(coalesce( approach ->> 'visiblesupportingtechniqueid', '' )) is distinct from 'blurting_v1'",
    );
    expect(compactHelper).toContain(
      "has_any_blurting_signal := coalesce( pg_catalog.btrim( approach ->> 'visiblesupportingtechniqueid' ) = 'blurting_v1', false ) or pg_catalog.lower(pg_catalog.btrim( coalesce(approach ->> 'visiblemethodname', '') )) = 'blurting' or normalized_blurting_runtime_component_count > 0",
    );
    expect(compactHelper).toContain(
      "approach ->> 'visiblesupportingtechniqueid' is distinct from 'blurting_v1' or approach ->> 'visiblemethodname' is distinct from 'blurting'",
    );
    expect(compactHelper).toContain("blurting_runtime_component_count <> 1");
    expect(compactHelper).toContain(
      "normalized_blurting_runtime_component_count <> 1",
    );
    expect(compactHelper).toContain("generic_runtime_component_count <> 0");
    expect(compactHelper).not.toContain("generic_runtime_trace_count");
    expect(compactHelper).not.toContain("method_recipe_trace_count");
  });

  it("returns normally for an ordinary route whose optional technique is absent", () => {
    expect(compactHelper).toContain(
      "coalesce( pg_catalog.btrim( approach ->> 'visiblesupportingtechniqueid' ) = 'blurting_v1', false )",
    );
    expect(compactHelper).toContain(
      "if has_any_blurting_signal is not true then return; end if",
    );
    expect(compactHelper).not.toContain(
      "if not has_any_blurting_signal then return",
    );
  });

  it("detects padded recipe signals but keeps exact active values fail-closed", () => {
    expect(compactHelper).toContain(
      "where pg_catalog.btrim(component.value) = 'blurting_recipe_runtime_v1'",
    );
    expect(compactHelper).toContain(
      "where component.value = 'blurting_recipe_runtime_v1'",
    );
    expect(compactHelper).toContain(
      "pg_catalog.lower(pg_catalog.btrim( coalesce(approach ->> 'visiblemethodname', '') )) = 'blurting'",
    );
    expect(compactHelper).toContain(
      "approach ->> 'visiblemethodname' is distinct from 'blurting'",
    );
    expect(compactHelper).toContain(
      "approach ->> 'visiblesupportingtechniqueid' is distinct from 'blurting_v1'",
    );
  });

  it("forbids representing Blurting through an ordinary method alternative", () => {
    expect(compactHelper).toContain(
      "pg_catalog.lower(pg_catalog.btrim( coalesce(alternative.value ->> 'visiblemethodname', '') )) = 'blurting'",
    );
    expect(compactHelper).toContain(
      "pg_catalog.btrim(coalesce( alternative.value ->> 'alternativeid', '' )) = 'blurting_v1'",
    );
    expect(compactHelper).toContain("= ':blurting_v1'");
  });

  it("mirrors the exact Practice, target, source, duration, and support boundary", () => {
    for (const fragment of [
      "'retrieval_practice'",
      "'conceptual_learning'",
      "'reading_to_quiz'",
      "'scheduled_review'",
      "active_minutes not between 10 and 60",
      "active_target_count not between 1 and 3",
      "'developing'",
      "'retrieval_ready'",
      "'user_materials'",
      "'trusted_external_source'",
      "'independent_start'",
    ]) {
      expect(blurtingHelper).toContain(fragment);
    }
    expect(compactHelper).toContain(
      "source_requirements -> 'groundingrequired' is distinct from 'true'::jsonb",
    );
    expect(compactHelper).toContain(
      "pg_catalog.jsonb_array_length( source_requirements -> 'requiredsourceids' ) < 1",
    );
    expect(compactHelper).toContain(
      "(execution ->> 'activitylimit')::integer < 3",
    );
  });

  it("requires the latest recipe and runtime-policy traces to match current facts", () => {
    expect(blurtingHelper.match(/order by trace\.ordinality desc/gu)).toHaveLength(2);
    expect(compactHelper).toContain(
      "where trace.value ->> 'ruleid' = 'method_recipe_v1' order by trace.ordinality desc limit 1",
    );
    expect(compactHelper).toContain(
      "where trace.value ->> 'ruleid' in ( 'method_runtime_capability_v1', 'blurting_recipe_runtime_v1' ) order by trace.ordinality desc limit 1",
    );
    expect(compactHelper).toContain("is distinct from 'recipe:blurting_v1'");
    expect(compactHelper).toContain(
      "'blurting selected under method_recipe_v1: ordinary practice retrieval for '",
    );
    expect(compactHelper).toContain("latest_runtime_policy_trace ->> 'ruleid' is distinct from 'blurting_recipe_runtime_v1'");
    expect(compactHelper).toContain("'full:dedicated_runtime:recovery_none'");
    expect(compactHelper).toContain("'full:outside_source_contract:recovery_none'");
    expect(compactHelper).toContain("is distinct from '[]'::jsonb");
  });

  it("freezes canonical phases, deterministic minutes, and per-target final evidence", () => {
    for (const fragment of [
      "'method-1-retrieve'",
      "'method-2-repair'",
      "'method-3-transfer'",
      "'retrieve'",
      "'repair'",
      "'transfer'",
      "'verification'",
      "'blurting-final-check:'",
    ]) {
      expect(blurtingHelper).toContain(fragment);
    }
    expect(compactHelper).toContain(
      "expected_phase_minutes := active_minutes / 3 + case when phase_ordinality <= (active_minutes % 3)::bigint then 1 else 0 end",
    );
    expect(compactHelper).toContain(
      "not ((phase -> 'targetids') @> active_target_ids)",
    );
    expect(compactHelper).toContain(
      "not (active_target_ids @> (phase -> 'targetids'))",
    );
    expect(compactHelper).toContain(
      "evidence.value -> 'requiresindependentattempt' is distinct from 'true'::jsonb",
    );
    expect(compactHelper).toContain("matching_evidence_count <> 1");
  });

  it("routes every payload through the exact helper before the write guard", () => {
    expect(payloadAssertion).toContain(
      "perform public.assert_study_route_blurting_recipe_v1(route_payload)",
    );
    expect(payloadGuard).toContain(
      "perform public.assert_study_route_payload_v1(new.route_payload)",
    );
  });

  it("accepts method_recipe as the ninth bounded learner override field", () => {
    expect(compactPayloadAssertion).toContain(
      "jsonb_array_length(route_override -> 'changedfields') not between 1 and 9",
    );
    expect(compactPayloadAssertion).toContain(
      "'duration', 'phase_order', 'support_bounds', 'review_contract', 'method_recipe'",
    );
  });

  it("requires migration 002's plan-bound permit only for first introduction", () => {
    expect(permitMigration).toContain(
      "create or replace function public.current_plan_activation_permit_matches_v1(",
    );
    expect(permitMigration).toContain(
      "pg_catalog.current_setting(\n    'yova.plan_activation_permit_id'",
    );
    expect(permitMigration).toContain(
      "perform pg_catalog.set_config(\n    'yova.plan_activation_permit_id',\n"
      + "    activation_permit_id::text,\n    true",
    );
    expect(permitMigration).toContain(
      "revoke all on function public.current_plan_activation_permit_matches_v1(uuid, uuid)\n"
      + "from public, anon, authenticated, service_role",
    );
    expect(permitMigration).not.toContain(
      "grant execute on function public.current_plan_activation_permit_matches_v1",
    );

    expect(compactGuard).toContain(
      "predecessor.revision_number = new.revision_number - 1",
    );
    for (const field of [
      "route_lineage_id",
      "plan_session_id",
      "plan_id",
      "user_id",
    ]) {
      expect(payloadGuard).toContain(`predecessor.${field} = new.${field}`);
    }
    expect(compactGuard).toContain(
      "public.current_plan_activation_permit_matches_v1( new.user_id, new.plan_id ) is distinct from true",
    );
    expect(payloadGuard).toContain(
      "message = 'study_route_blurting_activation_permit_required'",
    );
    expect(payloadGuard).not.toContain("current_setting(");
    expect(payloadGuard).not.toContain("set_config(");
  });

  it("clears only current recipe state when switching to an offered core method", () => {
    expect(compactChoice).toContain(
      "predecessor_has_blurting_recipe := predecessor_route.route_payload #>> '{approach,visiblesupportingtechniqueid}' = 'blurting_v1'",
    );
    expect(compactChoice).toContain(
      "(requested_route -> 'approach') - 'visiblesupportingtechniqueid'",
    );
    expect(compactChoice).toContain(
      "where component.value <> 'blurting_recipe_runtime_v1'",
    );
    expect(compactChoice).toContain(
      "then '[\"primary_method\", \"method_recipe\"]'::jsonb",
    );
    expect(compactChoice).toContain(
      "and router_component <> 'blurting_recipe_runtime_v1'",
    );
    expect(compactChoice).toContain(
      "when predecessor_has_blurting_recipe then array['blurting']::text[]",
    );
    expect(compactChoice).toContain(
      "when predecessor_has_blurting_recipe then 'active recall'",
    );
  });

  it("retains append-only recipe traces and appends the generic current runtime trace", () => {
    expect(compactChoice).toContain(
      "expected_rule_trace := ( predecessor_route.route_payload #> '{provenance,ruletrace}' ) || pg_catalog.jsonb_build_array(",
    );
    expect(compactChoice).toContain(
      "'ruleid', 'method_runtime_capability_v1'",
    );
    expect(methodChoice).not.toContain("normalized_requested_rule_trace");
    expect(methodChoice).not.toMatch(
      /where trace\.value ->> 'ruleid' not in/u,
    );
  });

  it("reasserts every helper ACL and exposes only the established authenticated RPC", () => {
    for (const signature of [
      "public.assert_study_route_blurting_recipe_v1(jsonb)",
      "public.assert_study_route_payload_v1(jsonb)",
      "public.guard_study_route_payload_v1()",
      "public.change_plan_session_method_with_route(jsonb)",
    ]) {
      expect(migration).toContain(
        `revoke all on function ${signature}\nfrom public, anon, authenticated, service_role`,
      );
    }
    expect(migration.match(/grant execute on function/gu)).toHaveLength(1);
    expect(migration).toContain(
      "grant execute on function public.change_plan_session_method_with_route(jsonb)\n"
      + "to authenticated",
    );
  });
});

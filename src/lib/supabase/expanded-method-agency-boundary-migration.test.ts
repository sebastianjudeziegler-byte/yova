import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
  LEGACY_CORE_METHOD_NAMES,
} from "@/lib/learning/method-catalog";
import { METHOD_PHASES } from "@/lib/learning/method-fidelity";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608300003_expanded_method_agency_boundary.sql",
), "utf8");
const normalized = migration.toLocaleLowerCase();
const historicalMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240003_blurting_recipe_compatibility.sql",
), "utf8");

function functionBody(signature: string, revokeMarker: string) {
  const start = normalized.indexOf(signature.toLocaleLowerCase());
  const end = normalized.indexOf(revokeMarker.toLocaleLowerCase(), start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return normalized.slice(start, end);
}

const catalogGuard = functionBody(
  "create or replace function public.assert_study_route_method_catalog_v2(",
  "revoke all on function public.study_route_method_names_v2(text)",
);
const validatorWrapper = functionBody(
  "create or replace function public.assert_study_route_payload_v1(",
  "revoke all on function public.assert_study_route_payload_v1(jsonb)",
);
const versionedWriter = functionBody(
  "create or replace function public.change_plan_session_method_with_route_v2(",
  "revoke all on function\n  public.change_plan_session_method_with_route_v2(jsonb)",
);
const publicAdapter = functionBody(
  "create or replace function public.change_plan_session_method_with_route(\n",
  "revoke all on function public.change_plan_session_method_with_route(jsonb)",
);
const readinessV2 = functionBody(
  "create or replace function public.signed_in_generation_readiness_v2()",
  "revoke all on function public.signed_in_generation_readiness_v2()",
);
const topicStatusRefresh = functionBody(
  "create or replace function public.refresh_plan_knowledge_map_topic_statuses(",
  "create or replace function public.study_route_method_names_v2(",
);

describe("expanded method and agency database boundary migration", () => {
  it("keeps both mature implementations private behind additive wrappers", () => {
    expect(normalized).toContain(
      "alter function public.assert_study_route_payload_v1(jsonb)\n"
      + "rename to assert_study_route_payload_legacy_v1",
    );
    expect(normalized).toContain(
      "alter function public.change_plan_session_method_with_route(jsonb)\n"
      + "rename to change_plan_session_method_with_route_legacy_v1",
    );
    expect(validatorWrapper).toContain(
      "perform public.assert_study_route_payload_legacy_v1(adapted_payload)",
    );
    expect(publicAdapter).toContain(
      "return public.change_plan_session_method_with_route_v2(payload)",
    );
    expect(publicAdapter).toContain(
      "return public.change_plan_session_method_with_route_legacy_v1(payload)",
    );

    const historicalStart = historicalMigration.indexOf(
      "create or replace function public.change_plan_session_method_with_route(",
    );
    const historicalEnd = historicalMigration.indexOf(
      "revoke all on function public.change_plan_session_method_with_route(jsonb)",
      historicalStart,
    );
    expect(versionedWriter.length).toBeLessThan(
      historicalMigration.slice(historicalStart, historicalEnd).length,
    );
  });

  it("mirrors every current ID, recognized name, and phase", () => {
    for (const methodId of CORE_METHOD_IDS) {
      expect(normalized).toContain(`when '${methodId}'`);
      expect(migration).toContain(CORE_METHOD_CATALOG[methodId].name);
      for (const legacyName of LEGACY_CORE_METHOD_NAMES[methodId] ?? []) {
        expect(migration).toContain(legacyName);
      }
    }
    for (const phase of METHOD_PHASES) {
      expect(normalized).toContain(`'${phase}'`);
    }
    expect(normalized).toContain(
      "array['model', 'explain', 'repair', 'reexplain']::text[]",
    );
    expect(normalized).toContain(
      "array['survey', 'question', 'read_source', 'retrieve', 'review']::text[]",
    );
    expect(normalized).toContain(
      "array['pretest', 'model', 'transfer']::text[]",
    );
    expect(normalized).toContain(
      "array['retrieve', 'connect', 'evidence_match', 'repair']::text[]",
    );
    expect(normalized).toContain(
      "array['independent_practice', 'transfer']::text[]",
    );
    expect(normalized).not.toContain(
      "array['pretest', 'model', 'repair', 'transfer']::text[]",
    );
    expect(normalized).not.toContain(
      "array['independent_practice', 'repair', 'transfer']::text[]",
    );
  });

  it("rejects SQL null and JSON null instead of falling through allow-lists", () => {
    expect(catalogGuard).toContain(
      "pg_catalog.jsonb_typeof(route_payload) is distinct from 'object'",
    );
    expect(catalogGuard).toContain("method_id is null");
    expect(catalogGuard).toContain("method_name is null");
    expect(catalogGuard).toContain(
      "pg_catalog.jsonb_typeof(phase -> 'methodphase')\n        is distinct from 'string'",
    );
    expect(catalogGuard).toContain(
      "pg_catalog.jsonb_typeof(alternative -> 'primarymethodid')\n        is distinct from 'string'",
    );
    expect(catalogGuard).toContain(
      "supporting_technique is not distinct from 'blurting_v1'",
    );
  });

  it("keeps Pretesting baseline checks out of durable topic progression", () => {
    expect(topicStatusRefresh).toContain(
      "item.value ->> 'methodphase' is distinct from 'pretest'",
    );
    expect(topicStatusRefresh).toMatch(
      /teaching_item\.value ->> 'methodphase'\s+is distinct from 'pretest'/u,
    );
    expect(topicStatusRefresh).toContain(
      "when evidence.secure_count >= 2",
    );
    expect(topicStatusRefresh).toContain(
      "when evidence.evidence_count > 0 then 'evidenced'",
    );
  });

  it("uses the legacy validator only after a non-persisting structural adapter", () => {
    expect(validatorWrapper).toContain(
      "perform public.assert_study_route_method_catalog_v2(route_payload)",
    );
    expect(validatorWrapper).toContain("requires_expanded_adapter");
    expect(validatorWrapper).toContain("'pretesting', 'concept_mapping', 'practice_problems'");
    expect(validatorWrapper).toContain("'survey', 'question', 'pretest', 'reexplain', 'connect', 'review'");
    expect(validatorWrapper).toContain(
      "perform public.assert_study_route_payload_legacy_v1(route_payload)",
    );
    expect(normalized).toContain(
      "perform public.assert_study_route_payload_v1(existing_payload)",
    );
    expect(normalized).toContain(
      "perform public.assert_study_route_payload_v1(new.route_payload)",
    );
  });

  it("locks ownership and immutable route identity before checking a choice", () => {
    const advisory = versionedWriter.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const plan = versionedWriter.indexOf("select plan.*\n  into requested_plan");
    const sessions = versionedWriter.indexOf(
      "order by session.sequence, session.id\n  for update",
    );
    const predecessor = versionedWriter.indexOf(
      "select route.*\n  into predecessor_route",
    );
    const identity = versionedWriter.indexOf(
      "perform public.validate_study_route_write_identity(",
    );
    expect(versionedWriter).toContain("current_user_id uuid := auth.uid()");
    expect(advisory).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(advisory);
    expect(sessions).toBeGreaterThan(plan);
    expect(predecessor).toBeGreaterThan(sessions);
    expect(identity).toBeGreaterThan(predecessor);
  });

  it("keeps stored choices exact and bounds Other methods to the predecessor eligibility cohort", () => {
    expect(versionedWriter).toContain(
      "predecessor_has_blurting_recipe := predecessor_route.route_payload\n"
      + "    #>> '{approach,visiblesupportingtechniqueid}'\n"
      + "      is not distinct from 'blurting_v1'",
    );
    expect(versionedWriter).not.toContain(
      "#>> '{approach,visiblesupportingtechniqueid}' = 'blurting_v1'",
    );
    expect(versionedWriter).toContain(
      "predecessor_route.route_payload #> '{agency,alternatives}'",
    );
    expect(versionedWriter).toContain(
      "matching_alternative_count <> 1",
    );
    expect(versionedWriter).toContain(
      "selection_scope = 'stored_alternative'",
    );
    expect(versionedWriter).toContain(
      "selection_scope = 'other_eligible_method'",
    );
    expect(versionedWriter).toContain(
      "predecessor_route.route_payload #>> '{agency,controlmode}'\n      is distinct from 'learner_customizes'",
    );
    expect(versionedWriter).toContain(
      "and predecessor_eligibility_trace is null",
    );
    expect(versionedWriter).toContain(
      "predecessor_eligibility_trace\n      is distinct from expected_eligibility_trace",
    );
    expect(versionedWriter).toContain(
      "'selectionscope'",
    );
    expect(versionedWriter).toContain(
      "authorized_choice_ids := pg_catalog.array_append",
    );
    expect(versionedWriter).toContain(
      "coalesce(\n        pg_catalog.array_length(expected_alternative_ids, 1),\n        0\n      ) < 2",
    );
    expect(versionedWriter).toContain(
      "requested_alternative ->> 'primarymethodid'\n        is distinct from expected_alternative_id",
    );
    expect(versionedWriter).toContain(
      "public.study_route_method_tradeoff_v2(\n        requested_route",
    );
  });

  it("recomputes phases while keeping non-method route surfaces immutable", () => {
    expect(versionedWriter).toContain(
      "requested_route -> 'target'\n      is distinct from predecessor_route.route_payload -> 'target'",
    );
    expect(versionedWriter).toContain(
      "requested_route -> 'timing'\n      is distinct from predecessor_route.route_payload -> 'timing'",
    );
    expect(versionedWriter).toContain(
      "- 'orderedphases' - 'activitylimit'",
    );
    expect(versionedWriter).toContain(
      "public.study_route_method_phases_v2(\n    requested_method_id",
    );
    expect(versionedWriter).toContain(
      "expected_active_minutes / expected_phase_count",
    );
    expect(versionedWriter).toContain(
      "requested_phase -> 'targetids'\n        is distinct from expected_active_target_ids",
    );
  });

  it("pins truthful explanation, policy, agency, and material-successor traces", () => {
    for (const ruleId of [
      "post_commit_method_choice_v1",
      "method_decision_evidence_adapter_v2",
      "method_evidence_v1",
      "method_compare_v1",
      "method_eligibility_v2",
      "canonical_method_selection_v1",
      "method_runtime_capability_v1",
      "method_presentation_v2",
      "study_route_agency_mode_controller_v1",
      "study_route.material_successor",
    ]) {
      expect(versionedWriter).toContain(`'ruleid', '${ruleId}'`);
    }
    expect(versionedWriter).toContain(
      "requested_trace_prefix is distinct from predecessor_rule_trace",
    );
    expect(versionedWriter).toContain(
      "requested_eligibility_trace\n      is distinct from expected_eligibility_trace",
    );
    expect(versionedWriter).toContain(
      "requested_rule_trace is distinct from expected_rule_trace",
    );
    expect(versionedWriter).toContain(
      "'result', 'ill_customize:learner_choice:alternatives:'",
    );
    expect(versionedWriter).toContain(
      "'ruleid', 'study_route.router_history_compaction_v1'",
    );
    expect(versionedWriter).toContain(
      "pg_catalog.char_length(expected_router_version) > 256",
    );
  });

  it("keeps replay before work guards and all fresh writes transactional", () => {
    const replay = versionedWriter.indexOf(
      "requested_session.committed_route_revision_id\n      = requested_route_revision_id",
    );
    const planState = versionedWriter.indexOf(
      "requested_plan.status <> 'active'",
      replay,
    );
    const savedWork = versionedWriter.indexOf(
      "requested_session.step_data ? 'activesessioncheckpoint'",
      replay,
    );
    const projection = versionedWriter.indexOf(
      "perform public.persist_study_route_scalar_projection(",
      replay,
    );
    expect(replay).toBeGreaterThan(-1);
    expect(planState).toBeGreaterThan(replay);
    expect(savedWork).toBeGreaterThan(planState);
    expect(projection).toBeGreaterThan(savedWork);
    expect(versionedWriter.slice(replay, planState)).toContain(
      "response_status := 'replayed'",
    );
    expect(versionedWriter).toContain(
      "perform public.commit_study_route_revision(requested_route)",
    );
    expect(versionedWriter).toContain(
      "perform public.assert_committed_study_route_projection(",
    );
  });

  it("does not emit a retryable serialization SQLSTATE from the new path", () => {
    expect(versionedWriter).not.toContain("40001");
    expect(versionedWriter).toContain("errcode = '22023'");
    expect(versionedWriter).toContain("errcode = '55000'");
  });

  it("bumps the service-only release capability through this migration head", () => {
    expect(readinessV2).toContain("language plpgsql\nstable\nsecurity definer");
    expect(readinessV2).toContain("auth.role() is distinct from 'service_role'");
    expect(readinessV2).toContain("public.signed_in_generation_readiness_v1()");
    expect(readinessV2).toContain("public.assert_study_route_method_catalog_v2(jsonb)");
    expect(readinessV2).toContain("public.change_plan_session_method_with_route_v2(jsonb)");
    expect(readinessV2).toContain("'contractversion', '202608300003'");
    expect(readinessV2).toContain("'expandedmethodagencyboundary'");
    expect(readinessV2).not.toMatch(
      /\b(?:insert|update|delete|truncate)\s+(?:from\s+|into\s+)?public\./u,
    );
    expect(normalized).toContain(
      "grant execute on function public.signed_in_generation_readiness_v2()\n"
      + "to service_role",
    );
  });

  it("exposes only the stable authenticated adapter", () => {
    for (const signature of [
      "public.assert_study_route_payload_legacy_v1(jsonb)",
      "public.assert_study_route_payload_v1(jsonb)",
      "public.assert_study_route_method_catalog_v2(jsonb)",
      "public.change_plan_session_method_with_route_legacy_v1(jsonb)",
      "public.change_plan_session_method_with_route_v2(jsonb)",
    ]) {
      expect(normalized).toMatch(new RegExp(
        `revoke all on function\\s+${signature.replace(/[().]/gu, "\\$&")}\\s+from public, anon, authenticated, service_role`,
        "u",
      ));
    }
    expect(normalized).toContain(
      "revoke all on function public.change_plan_session_method_with_route(jsonb)\n"
      + "from public, anon, authenticated, service_role",
    );
    expect(normalized).toContain(
      "grant execute on function\n"
      + "  public.change_plan_session_method_with_route(jsonb)\n"
      + "to authenticated",
    );
    expect(normalized).not.toContain(
      "grant execute on function public.change_plan_session_method_with_route_v2",
    );
  });
});

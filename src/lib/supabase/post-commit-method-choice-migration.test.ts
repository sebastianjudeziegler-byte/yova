import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEARNING_TASK_TYPES } from "@/lib/learning/method-catalog";
import {
  KNOWLEDGE_STAGES,
} from "@/lib/learning/method-eligibility";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240001_post_commit_method_choice.sql",
), "utf8").toLocaleLowerCase();
const foundationalMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608230001_study_routes.sql",
), "utf8").toLocaleLowerCase();

const functionStart = migration.indexOf(
  "create or replace function public.change_plan_session_method_with_route(",
);
const functionEnd = migration.indexOf(
  "revoke all on function public.change_plan_session_method_with_route(jsonb)",
  functionStart,
);
const methodChoiceFunction = migration.slice(functionStart, functionEnd);
const commitFunctionStart = foundationalMigration.indexOf(
  "create or replace function public.commit_study_route_revision(payload jsonb)",
);
const commitFunctionEnd = foundationalMigration.indexOf(
  "revoke all on function public.guard_study_route_immutability()",
  commitFunctionStart,
);
const privateCommitFunction = foundationalMigration.slice(
  commitFunctionStart,
  commitFunctionEnd,
);

describe("post-commit method-choice migration", () => {
  it("exposes one narrow authenticated security-definer RPC", () => {
    expect(functionStart).toBeGreaterThan(-1);
    expect(methodChoiceFunction).toContain("security definer\nset search_path = ''");
    expect(methodChoiceFunction).toContain("current_user_id uuid := auth.uid()");
    expect(migration).toContain(
      "revoke all on function public.change_plan_session_method_with_route(jsonb)\n"
      + "from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.change_plan_session_method_with_route(jsonb)\n"
      + "to authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.commit_study_route_revision(jsonb)",
    );
  });

  it("requires the exact bounded payload and rejects extra root keys", () => {
    for (const key of [
      "'planid'",
      "'plansessionid'",
      "'expectedrouterevisionid'",
      "'successorstudyroute'",
    ]) {
      expect(methodChoiceFunction).toContain(key);
    }
    expect(methodChoiceFunction).toContain(
      "from pg_catalog.jsonb_object_keys(payload) as payload_key(key)",
    );
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_shape_invalid'",
    );
    expect(methodChoiceFunction).toContain(
      "requested_predecessor_revision_id\n      is distinct from expected_route_revision_id",
    );
  });

  it("locks account, plan, every session in stable order, then both route rows", () => {
    const advisory = methodChoiceFunction.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const plan = methodChoiceFunction.indexOf("select plan.*\n  into requested_plan");
    const sessions = methodChoiceFunction.indexOf(
      "order by session.sequence, session.id\n  for update",
    );
    const predecessor = methodChoiceFunction.indexOf(
      "into predecessor_route\n  from public.study_routes",
    );
    const requested = methodChoiceFunction.indexOf(
      "into existing_route\n  from public.study_routes",
      predecessor,
    );

    expect(advisory).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(advisory);
    expect(sessions).toBeGreaterThan(plan);
    expect(predecessor).toBeGreaterThan(sessions);
    expect(requested).toBeGreaterThan(predecessor);
  });

  it("verifies direct identity and one exact stored alternative", () => {
    expect(methodChoiceFunction).toContain(
      "perform public.validate_study_route_write_identity(",
    );
    expect(methodChoiceFunction).toContain(
      "perform public.assert_study_route_payload_v1(requested_route - 'identity')",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{identity,routelineageid}'",
    );
    expect(methodChoiceFunction).toContain(
      "predecessor_route.revision_number + 1",
    );
    const normalizedFunction = methodChoiceFunction
      .replace(/\s+/gu, " ")
      .replace(/array\[ /gu, "array[")
      .replace(/ \]::text\[\]/gu, "]::text[]");
    for (const forbiddenIdentity of [
      "requested_route_revision_id is not distinct from requested_plan.id",
      "requested_route_revision_id is not distinct from requested_session.id",
      "requested_route_revision_id is not distinct from predecessor_route.route_lineage_id",
      "requested_route_revision_id is not distinct from expected_route_revision_id",
    ]) {
      expect(normalizedFunction).toContain(forbiddenIdentity);
    }
    expect(methodChoiceFunction).toContain(
      "predecessor_route.route_payload #> '{agency,alternatives}'",
    );
    for (const field of [
      "'primarymethodid'",
      "'mode'",
      "'executionenvironment'",
      "'visiblemethodname'",
      "'activeminutes'",
    ]) {
      expect(methodChoiceFunction).toContain(field);
    }
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_not_offered'",
    );
  });

  it.each([
    ["retrieval_practice", "active recall"],
    ["spaced_retrieval", "spaced repetition"],
    ["worked_example_fading", "worked examples"],
    ["interleaved_practice", "interleaving"],
    ["retrieval_based_outlining", "outline from memory"],
    ["scaffolded_coding", "trace–code–test"],
    ["practice_test_error_repair", "practice tests"],
  ])("binds %s to the canonical learner-facing name", (methodId, name) => {
    expect(methodChoiceFunction).toContain(
      `when '${methodId}' then '${name}'`,
    );
  });

  it.each([
    ["retrieval_practice", "active recall", "retrieval practice"],
    ["spaced_retrieval", "spaced repetition", "spaced retrieval"],
    ["worked_example_fading", "worked examples", "worked example fading"],
    ["interleaved_practice", "interleaving", "interleaved practice"],
    ["retrieval_based_outlining", "outline from memory", "retrieval-based outlining"],
    ["scaffolded_coding", "trace–code–test", "scaffolded coding with fading"],
    ["practice_test_error_repair", "practice tests", "practice test and error repair"],
  ])("accepts %s's legacy predecessor label while requiring its canonical successor", (
    methodId,
    canonicalName,
    legacyName,
  ) => {
    const normalizedFunction = methodChoiceFunction.replace(/\s+/gu, " ");
    expect(normalizedFunction).toContain(
      `when '${methodId}' then array['${canonicalName}', '${legacyName}']::text[]`,
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{approach,visiblemethodname}'\n      is distinct from expected_method_name",
    );
    expect(methodChoiceFunction).toContain(
      "exact_stored_alternative ->> 'visiblemethodname'\n        = any(expected_method_names)",
    );
    expect(methodChoiceFunction).toContain(
      "(exact_stored_alternative ->> 'visiblemethodname')",
    );
    expect(methodChoiceFunction).toContain(
      "allowed.visible_method_name\n        = any(expected_alternative_source_names)",
    );
    expect(methodChoiceFunction).toContain(
      "allowed.tradeoff = (",
    );
  });

  it("reconstructs one bounded method-presentation component and trace", () => {
    expect(methodChoiceFunction).toContain("'method_presentation_v1'");
    expect(methodChoiceFunction).toContain(
      "predecessor_method_presentation_count > 1",
    );
    expect(methodChoiceFunction).toContain(
      "predecessor_method_presentation_count = 0 then",
    );
    expect(methodChoiceFunction).toContain(
      "'result', 'recognizable_method_names'",
    );
    expect(methodChoiceFunction).toContain(
      "and router_component <> 'method_presentation_v1'",
    );
    expect(methodChoiceFunction).toContain(
      "|| '+method_presentation_v1'",
    );
  });

  it("allows only method-owned material changes and explicit learner agency", () => {
    expect(methodChoiceFunction).toContain(
      "requested_route -> 'target'\n      is distinct from predecessor_route.route_payload -> 'target'",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route -> 'timing'\n      is distinct from predecessor_route.route_payload -> 'timing'",
    );
    expect(methodChoiceFunction).toContain(
      "- 'primarymethodid' - 'visiblemethodname'",
    );
    expect(methodChoiceFunction).toContain(
      "- 'orderedphases' - 'activitylimit'",
    );
    expect(methodChoiceFunction).toContain("'{provenance,profileversion}'");
    expect(methodChoiceFunction).toContain("is distinct from 'learner_customizes'");
    expect(methodChoiceFunction).toContain("is distinct from 'learner'");
    expect(methodChoiceFunction).toContain(
      "is distinct from '[\"primary_method\"]'::jsonb",
    );
    expect(methodChoiceFunction).toContain(
      "expected_short_reason := 'you chose ' || expected_method_name",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{explanation,shortreason}'\n      is distinct from expected_short_reason",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{agency,override,reason}'\n      is distinct from expected_short_reason",
    );
    expect(methodChoiceFunction).toContain(
      "expected_learner_choice_evidence_ref := 'learner-choice:committed-route:'",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #> '{provenance,evidencerefs}'\n      is distinct from expected_evidence_refs",
    );
    expect(methodChoiceFunction).toContain("'post_commit_method_choice_v1'");
    expect(methodChoiceFunction).toContain(
      "expected_route_evidence_ref := 'route-revision:'",
    );
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_scope_conflict'",
    );
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_agency_conflict'",
    );
  });

  it("never expands successor alternatives beyond the committed choice set", () => {
    expect(methodChoiceFunction).toContain(
      "-- successor alternatives may rotate only within the choice set already",
    );
    expect(methodChoiceFunction).toContain(
      "#>> '{approach,primarymethodid}' as primary_method_id",
    );
    expect(methodChoiceFunction).toContain(
      "predecessor_route.route_payload #> '{agency,alternatives}'",
    );
    expect(methodChoiceFunction).toContain(
      "pg_catalog.jsonb_array_length(\n      requested_route #> '{agency,alternatives}'",
    );
    expect(methodChoiceFunction).toContain("if matching_alternative_count <> 1 then");
    expect(methodChoiceFunction).toContain(
      "is distinct from 'method-alternative:'",
    );
    expect(methodChoiceFunction).toContain(
      "also fits this task and stage, but it would use a different practice sequence.",
    );
    expect(methodChoiceFunction).toContain(
      "requested_alternative ->> 'visiblemethodname'\n        is distinct from expected_alternative_name",
    );
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_alternative_conflict'",
    );
  });

  it("recomputes the exact deterministic method phase recipe", () => {
    for (const recipe of [
      "array['retrieve', 'repair']::text[]",
      "array['retrieve', 'schedule_return']::text[]",
      "array['model', 'explain']::text[]",
      "array['model', 'guided_practice', 'independent_practice']::text[]",
      "array['discriminate', 'independent_practice']::text[]",
      "array['retrieve', 'evidence_match', 'independent_practice']::text[]",
      "array['code_trace', 'guided_practice', 'independent_practice']::text[]",
      "array['retrieve', 'repair', 'transfer']::text[]",
    ]) {
      expect(methodChoiceFunction).toContain(recipe);
    }
    expect(methodChoiceFunction).toContain(
      "when requested_route #>> '{approach,mode}' = 'practice'\n"
      + "        then array['retrieve', 'read_source', 'transfer']::text[]",
    );
    expect(methodChoiceFunction).toContain(
      "if requested_route #>> '{approach,mode}' = 'learn'\n"
      + "    and not ('model' = any(expected_method_phases)) then",
    );
    expect(methodChoiceFunction).toContain(
      "expected_method_phases := pg_catalog.array_prepend(",
    );
    expect(methodChoiceFunction).toContain(
      "expected_active_target_ids := public.study_route_active_topic_ids_v1(",
    );
    expect(methodChoiceFunction).toContain(
      "expected_activity_limit := greatest(",
    );
    expect(methodChoiceFunction).toContain(
      "expected_active_minutes / expected_phase_count",
    );
    expect(methodChoiceFunction).toContain(
      "expected_active_minutes % expected_phase_count",
    );
    expect(methodChoiceFunction).toContain(
      "is distinct from 'method-' || requested_phase_ordinality::text",
    );
    expect(methodChoiceFunction).toContain(
      "requested_phase -> 'targetids'\n        is distinct from expected_active_target_ids",
    );
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_phase_contract_conflict'",
    );
  });

  it("freezes the complete v1 task-stage-mode eligibility boundary", () => {
    const normalizedFunction = methodChoiceFunction
      .replace(/\s+/gu, " ")
      .replace(/array\[ /gu, "array[")
      .replace(/ \]::text\[\]/gu, "]::text[]");
    const expectedContexts: string[] = [];
    for (const learningMode of ["study", "learn"] as const) {
      for (const taskType of LEARNING_TASK_TYPES) {
        for (const knowledgeStage of KNOWLEDGE_STAGES) {
          const context = `${learningMode}:${taskType}:${knowledgeStage}`;
          expectedContexts.push(context);
        }
      }
    }
    const eligibilityCases = [...normalizedFunction.matchAll(
      /when '(study|learn):([a-z_]+):(novice|developing|retrieval_ready)' then array\[([^\]]+)\]::text\[\]/gu,
    )];
    const actualContexts = eligibilityCases.map(
      (match) => `${match[1]}:${match[2]}:${match[3]}`,
    );
    expect(actualContexts).toEqual(expectedContexts);
    expect(Math.max(...eligibilityCases.map((match) => (
      [...(match[4] ?? "").matchAll(/'[^']+'/gu)].length
    )))).toBe(3);
    expect(methodChoiceFunction).toContain(
      "a later eligibility or alternative-count change needs a replacement",
    );
    expect(methodChoiceFunction).toContain(
      "when pg_catalog.bool_or(target.value ->> 'stage' = 'novice')",
    );
    expect(methodChoiceFunction).toContain(
      "when pg_catalog.bool_or(target.value ->> 'stage' = 'developing')",
    );
    expect(methodChoiceFunction).toContain(
      "or not (requested_method_id = any(expected_eligible_method_ids))",
    );
    expect(methodChoiceFunction).toContain(
      "requested_alternative_method_ids\n      is distinct from expected_alternative_method_ids",
    );
    expect(methodChoiceFunction).toContain(
      "pg_catalog.array_agg(candidate.method_id order by candidate.ordinality)",
    );
  });

  it("accepts only the helper's exact explanation and provenance versions", () => {
    expect(methodChoiceFunction).toContain(
      "predecessor_method_requirement := predecessor_method_name",
    );
    expect(methodChoiceFunction).toContain(
      "expected_task_requirements := pg_catalog.jsonb_build_array(\n"
      + "    expected_method_requirement",
    );
    expect(methodChoiceFunction).toContain(
      "explanation_item is distinct from predecessor_method_requirement",
    );
    expect(methodChoiceFunction).toContain(
      "pg_catalog.jsonb_array_length(expected_task_requirements) < 10",
    );
    expect(methodChoiceFunction).toContain(
      "pg_catalog.jsonb_array_length(expected_learner_declarations) < 10",
    );
    for (const field of [
      "taskrequirements",
      "learnerdeclarations",
      "observations",
      "uncertainties",
    ]) {
      expect(methodChoiceFunction).toMatch(new RegExp(
        `requested_route #> '\\{explanation,${field}\\}'\\n`
        + `      is distinct from expected_${field.replace(
          "taskrequirements",
          "task_requirements",
        ).replace(
          "learnerdeclarations",
          "learner_declarations",
        )}`,
        "u",
      ));
    }
    expect(methodChoiceFunction).toContain(
      "the legacy record does not show who selected the route or which control mode was active.",
    );
    expect(methodChoiceFunction).toContain(
      "the intended phase skeleton comes from the method contract rather than a saved executed sequence.",
    );
    expect(methodChoiceFunction).toContain(
      "foreach router_component in array pg_catalog.string_to_array(",
    );
    expect(methodChoiceFunction).toContain(
      "router_component <> 'study_route_method_plan_integration_v1'",
    );
    expect(methodChoiceFunction).toContain(
      "router_component <> 'method_runtime_capability_v1'",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{provenance,routerversion}'\n"
      + "      is distinct from expected_router_version",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #>> '{provenance,profileversion}'\n"
      + "      is distinct from predecessor_route.route_payload",
    );
    expect(methodChoiceFunction).toContain(
      "expected_evidence_refs := '[]'::jsonb",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #> '{provenance,evidencerefs}'\n"
      + "      is distinct from expected_evidence_refs",
    );
  });

  it("pins the exact conditional seven-entry deterministic rule-trace tail", () => {
    const traceStart = methodChoiceFunction.indexOf("expected_rule_trace :=");
    const traceEnd = methodChoiceFunction.indexOf(
      "if pg_catalog.jsonb_array_length(\n      requested_route #> '{execution,orderedphases}'",
      traceStart,
    );
    const traceBuilder = methodChoiceFunction.slice(traceStart, traceEnd);
    const ruleIds = [...traceBuilder.matchAll(
      /'ruleid', '([^']+)'/gu,
    )].map((match) => match[1]);

    expect(traceStart).toBeGreaterThan(-1);
    expect(traceEnd).toBeGreaterThan(traceStart);
    expect(ruleIds).toEqual([
      "post_commit_method_choice_v1",
      "method_decision_evidence_adapter_v1",
      "method_eligibility_v1",
      "canonical_method_selection_v1",
      "method_runtime_capability_v1",
      "method_presentation_v1",
      "study_route.material_successor",
    ]);
    expect(traceBuilder).toContain(
      "'result', predecessor_method_id || '->' || requested_method_id",
    );
    expect(traceBuilder).toContain(
      "'result', 'authorized_context_applied'",
    );
    expect(traceBuilder).toContain(
      "'result', 'learner_choice:' || requested_method_id",
    );
    expect(traceBuilder).toContain(
      "'result', expected_runtime_result",
    );
    expect(traceBuilder).toContain(
      "'result', 'created_provisional_successor'",
    );
    expect(methodChoiceFunction).toContain(
      "requested_route #> '{provenance,ruletrace}'\n"
      + "      is distinct from expected_rule_trace",
    );
    expect(methodChoiceFunction).not.toMatch(
      /requested_route #> '\{provenance,ruletrace\}'\)?\s*@>/u,
    );
  });

  it("derives the exact runtime-capability result and learner-visible reason", () => {
    for (const runtime of [
      "when 'retrieval_practice' then 'retrieval_round'",
      "when 'spaced_retrieval' then 'retrieval_round'",
      "when 'worked_example_fading' then 'worked_example'",
      "when 'practice_test_error_repair' then 'error_repair'",
    ]) {
      expect(methodChoiceFunction).toContain(runtime);
    }
    expect(methodChoiceFunction).toContain(
      "when expected_runtime_kind is null then 'validated_phase_contract'",
    );
    expect(methodChoiceFunction).toContain("else 'dedicated_runtime'");
    for (const path of ["'streamed'", "'reliable_or_full'"]) {
      expect(methodChoiceFunction).toContain(`then ${path}`);
    }
    expect(methodChoiceFunction).toContain("else 'full'");
    expect(methodChoiceFunction).toContain(
      "|| ':recovery_' || expected_bounded_recovery",
    );
    expect(methodChoiceFunction).toContain(
      "a bounded model recovery is possible only when its additional source, target, pacing, and evidence checks also pass.",
    );
    expect(methodChoiceFunction).toContain(
      "if primary generation fails, yova must retry or show recovery instead of relabeling a generic fallback as this method.",
    );
    expect(methodChoiceFunction).toContain(
      "expected_runtime_reason := 'yova can deliver this route through '",
    );
  });

  it("handles an exact replay before plan, status, review, or saved-work guards", () => {
    const identity = methodChoiceFunction.indexOf(
      "perform public.validate_study_route_write_identity(",
    );
    const semanticPayload = methodChoiceFunction.indexOf(
      "perform public.assert_study_route_payload_v1(requested_route - 'identity')",
    );
    const exactAlternative = methodChoiceFunction.indexOf(
      "into exact_stored_alternative",
    );
    const material = methodChoiceFunction.indexOf(
      "perform public.assert_study_route_successor_material_change(",
    );
    const replay = methodChoiceFunction.indexOf(
      "requested_session.committed_route_revision_id\n      = requested_route_revision_id",
    );
    const exactCommit = methodChoiceFunction.indexOf(
      "perform public.commit_study_route_revision(requested_route);",
      replay,
    );
    const inactive = methodChoiceFunction.indexOf("requested_plan.status <> 'active'", replay);
    const ready = methodChoiceFunction.indexOf("requested_session.status <> 'ready'", replay);
    const generated = methodChoiceFunction.indexOf(
      "requested_session.step_data ? 'generatedsession'",
      replay,
    );

    expect(identity).toBeGreaterThan(-1);
    expect(semanticPayload).toBeGreaterThan(identity);
    expect(exactAlternative).toBeGreaterThan(semanticPayload);
    expect(material).toBeGreaterThan(exactAlternative);
    expect(replay).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(material);
    expect(exactCommit).toBeGreaterThan(replay);
    expect(methodChoiceFunction.slice(replay, inactive)).toContain(
      "response_status := 'replayed'",
    );
    expect(inactive).toBeGreaterThan(exactCommit);
    expect(ready).toBeGreaterThan(inactive);
    expect(generated).toBeGreaterThan(ready);

    for (const exactReceiptCheck of [
      "existing_route.route_fingerprint is distinct from requested_route_fingerprint",
      "existing_route.route_lineage_id is distinct from requested_route_lineage_id",
      "existing_route.revision_number is distinct from requested_revision_number",
      "existing_route.user_id is distinct from current_user_id",
      "existing_route.plan_id is distinct from requested_plan.id",
      "existing_route.plan_session_id is distinct from requested_session.id",
      "existing_route.predecessor_revision_id",
      "existing_route.created_at is distinct from requested_created_at",
      "existing_route.committed_at is distinct from requested_committed_at",
      "requested_session.committed_route_revision_id",
      "is not distinct from existing_route.route_revision_id",
    ]) {
      expect(privateCommitFunction).toContain(exactReceiptCheck);
    }
  });

  it("protects every started-work surface before the first fresh mutation", () => {
    const checkpoint = methodChoiceFunction.indexOf("'activesessioncheckpoint'");
    const generated = methodChoiceFunction.indexOf("'generatedsession'", checkpoint);
    const interruption = methodChoiceFunction.indexOf(
      "event.event_type = 'session_interrupted'",
      generated,
    );
    const attempt = methodChoiceFunction.indexOf(
      "from public.session_attempts as attempt",
      interruption,
    );
    const projection = methodChoiceFunction.lastIndexOf(
      "perform public.persist_study_route_scalar_projection(",
    );

    expect(checkpoint).toBeGreaterThan(-1);
    expect(generated).toBeGreaterThan(checkpoint);
    expect(interruption).toBeGreaterThan(generated);
    expect(attempt).toBeGreaterThan(interruption);
    expect(projection).toBeGreaterThan(attempt);
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_saved_work_protected'",
    );
    expect(methodChoiceFunction).not.toContain("- 'generatedsession'");
    expect(methodChoiceFunction).not.toContain("- 'activesessioncheckpoint'");
  });

  it("protects terminal, upcoming, skipped, and scheduled-review sessions", () => {
    expect(methodChoiceFunction).toContain("requested_session.status <> 'ready'");
    expect(methodChoiceFunction).toContain("requested_session.step_data ->> 'reviewtype'");
    expect(methodChoiceFunction).toContain("'{timing,durationsource}'");
    expect(methodChoiceFunction).toContain("= 'scheduled_review'");
    expect(methodChoiceFunction).toContain(
      "message = 'post_commit_method_choice_review_protected'",
    );
  });

  it("projects, commits, verifies, and reads back in one transaction", () => {
    const projection = methodChoiceFunction.indexOf(
      "perform public.persist_study_route_scalar_projection(",
    );
    const commit = methodChoiceFunction.indexOf(
      "perform public.commit_study_route_revision(requested_route);",
      projection,
    );
    const verify = methodChoiceFunction.indexOf(
      "perform public.assert_committed_study_route_projection(",
      commit,
    );
    const readback = methodChoiceFunction.indexOf(
      "message = 'post_commit_method_choice_readback_failed'",
      verify,
    );

    expect(projection).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(projection);
    expect(verify).toBeGreaterThan(commit);
    expect(readback).toBeGreaterThan(verify);
  });

  it("returns only the minimal authoritative response contract", () => {
    for (const field of [
      "'status', response_status",
      "'planid', requested_plan.id",
      "'plansessionid', requested_session.id",
      "'previousrouterevisionid', expected_route_revision_id",
      "'id', requested_session.id",
      "'method', requested_session.method",
      "'methodreason', requested_session.method_rationale",
      "'estimatedminutes', requested_session.estimated_minutes",
      "'studyroute', canonical_route",
    ]) {
      expect(methodChoiceFunction).toContain(field);
    }
    expect(methodChoiceFunction).not.toContain("'generatedsession',");
    expect(methodChoiceFunction).not.toContain("'activesessioncheckpoint',");
  });

  it("retains predecessors and never invokes broad plan-adjustment behavior", () => {
    expect(methodChoiceFunction).not.toContain("delete from public.study_routes");
    expect(methodChoiceFunction).not.toContain("delete from public.plan_sessions");
    expect(methodChoiceFunction).not.toContain("update public.plan_sessions");
    expect(methodChoiceFunction).not.toContain("status = 'skipped'");
    expect(methodChoiceFunction).not.toContain("adjust_learning_plan_with_routes");
    expect(methodChoiceFunction).not.toContain("assert_study_route_origin_reference");
    expect(methodChoiceFunction).not.toContain("insert into public.learning_events");
  });

  it("contains no duplicate RAISE USING option in any exception block", () => {
    expect(migration).not.toMatch(
      /raise exception using\s+raise exception using/u,
    );
    expect(migration).not.toMatch(
      /\) as allowed\(\s*\) as allowed\(/u,
    );
    const raiseBlocks = [...migration.matchAll(/raise exception using([\s\S]*?);/g)];
    expect(raiseBlocks.length).toBeGreaterThan(0);

    for (const block of raiseBlocks) {
      const options = [...block[1]!.matchAll(
        /\b(errcode|message|detail|hint|column|constraint|datatype|table|schema)\s*=/g,
      )].map((match) => match[1]);
      expect(new Set(options).size, block[0]).toBe(options.length);
    }
  });

  it("does not schema-qualify PostgreSQL special forms", () => {
    expect(methodChoiceFunction).not.toContain("pg_catalog.coalesce(");
    expect(methodChoiceFunction).not.toContain("pg_catalog.nullif(");
    expect(methodChoiceFunction).not.toContain("pg_catalog.greatest(");
    expect(methodChoiceFunction).toContain("select coalesce(");
    expect(methodChoiceFunction).toContain("if coalesce(");
  });
});

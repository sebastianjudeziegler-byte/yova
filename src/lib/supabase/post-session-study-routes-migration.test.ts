import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608230005_post_session_study_routes.sql",
), "utf8").toLocaleLowerCase();

function functionBody(name: string, nextName?: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start + 1)
    : migration.length;
  return migration.slice(start, end);
}

const lockBinding = functionBody(
  "lock_study_route_binding_v2",
  "assert_study_route_binding",
);
const binding = functionBody(
  "assert_study_route_binding",
  "validate_study_route_write_identity",
);
const originReference = functionBody(
  "assert_study_route_origin_reference",
  "assert_study_route_successor_material_change",
);
const successorMaterialChange = functionBody(
  "assert_study_route_successor_material_change",
  "persist_study_route_scalar_projection",
);
const scalarProjection = functionBody(
  "persist_study_route_scalar_projection",
  "persist_route_session_arrays",
);
const arrayPersistence = functionBody(
  "persist_route_session_arrays",
  "assert_persisted_session_request",
);
const routeProjection = functionBody(
  "assert_committed_study_route_projection",
  "guard_study_route_pointer_transition",
);
const pointerGuard = functionBody(
  "guard_study_route_pointer_transition",
  "complete_plan_session_with_route",
);
const completion = functionBody(
  "complete_plan_session_with_route",
  "activate_concept_review_with_route",
);
const reviewActivation = functionBody("activate_concept_review_with_route");

describe("post-session StudyRoute migration", () => {
  it("uses the canonical account, plan, ordered-session lock sequence", () => {
    expect(lockBinding).toContain("security definer\nset search_path = ''");
    const advisory = lockBinding.indexOf("pg_advisory_xact_lock");
    const planLock = lockBinding.indexOf("from public.plans as plan");
    const orderedSessions = lockBinding.indexOf("order by session.sequence, session.id");
    const pointerRead = lockBinding.lastIndexOf("session.committed_route_revision_id");
    expect(advisory).toBeGreaterThan(0);
    expect(planLock).toBeGreaterThan(advisory);
    expect(orderedSessions).toBeGreaterThan(planLock);
    expect(pointerRead).toBeGreaterThan(orderedSessions);
    expect(lockBinding).toContain("route.lifecycle = 'committed'");
    expect(binding).toContain("public.lock_study_route_binding_v2(");
    expect(binding).toContain("false");
    expect(completion).toContain("public.lock_study_route_binding_v2(");
    expect(completion).toContain("requested_route_revision_id,\n    true");
  });

  it("requires complete route coverage and removes route objects from mature payloads", () => {
    expect(completion).toContain("post_session_study_route_coverage_conflict");
    expect(completion).toContain("adjustment_present is distinct from successor_present");
    expect(completion).toContain("follow_up_present is distinct from follow_up_route_present");
    expect(completion).toContain("continuation_present is distinct from continuation_route_present");
    expect(completion).toContain("- 'nextsessionstudyroute'");
    expect(completion).toContain("follow_up - 'studyroute'");
    expect(completion).toContain("continuation - 'studyroute'");
    expect(completion).toContain(
      "adjustment_present := coalesce(\n    pg_catalog.jsonb_typeof(adjustment) = 'object',\n    false",
    );
    expect(completion).toContain(
      "follow_up_route_present := coalesce(\n    pg_catalog.jsonb_typeof(follow_up_route) = 'object',\n    false",
    );
  });

  it("binds every child route to the exact evidence-origin revision", () => {
    expect(originReference).toContain(
      "evidence_refs @> pg_catalog.jsonb_build_array(\n      'route-revision:' || expected_origin_revision_id::text",
    );
    expect(originReference).toContain("origin.plan_id = requested_plan_id");
    expect(originReference).toContain("origin.user_id = current_user_id");
    expect(originReference).toContain("origin.lifecycle = 'committed'");
    expect(completion).toContain("perform public.assert_study_route_origin_reference(");
    expect(completion).toContain(
      "successor_route,\n        requested_plan_id,\n        requested_route_revision_id",
    );
    expect(completion).toContain(
      "follow_up_route,\n        requested_plan_id,\n        requested_route_revision_id",
    );
    expect(reviewActivation).toContain("originrouterevisionid");
    expect(reviewActivation).toContain(
      "requested_route,\n      requested_plan_id,\n      requested_origin_route_revision_id",
    );
  });

  it("rejects a successor whose only changes are identity or provenance", () => {
    expect(successorMaterialChange).toContain(
      "requested_route - 'identity' - 'provenance'",
    );
    expect(successorMaterialChange).toContain(
      "predecessor_payload - 'provenance'",
    );
    expect(successorMaterialChange).toContain(
      "post_session_study_route_no_material_change",
    );
    expect(completion).toContain(
      "perform public.assert_study_route_successor_material_change(",
    );
  });

  it("rejects adaptation over active work before mature cache invalidation", () => {
    const checkpointGuard = completion.indexOf(
      "adapted_session.step_data ? 'activesessioncheckpoint'",
    );
    const matureCompletion = completion.indexOf("public.complete_plan_session(sanitized_payload)");
    expect(checkpointGuard).toBeGreaterThan(0);
    expect(matureCompletion).toBeGreaterThan(checkpointGuard);
    expect(completion).toContain("message = 'study_route_active_checkpoint'");
    expect(completion).toContain("session.sequence = current_session.sequence + 1");
    expect(completion).toContain("adapted_session.status <> 'upcoming'");
  });

  it("short-circuits only an exact guided retry", () => {
    expect(completion).toContain(
      "requested_variant = 'guided' and existing_attempt_found",
    );
    expect(completion).toContain("current_session.status <> 'complete'");
    expect(completion).toContain("existing_attempt.result_data -> 'nextsessionadjustment'");
    expect(completion).toContain("existing_attempt.result_data -> 'followupsession'");
    expect(completion).toContain("study_route_completion_retry_conflict");
    expect(completion).toContain("event.event_type = 'session_completed'");
    expect(completion).toContain("return requested_plan_id;");
  });

  it("commits successor, follow-up, and continuation routes in the outer transaction", () => {
    for (const routeVariable of [
      "successor_route",
      "follow_up_route",
      "continuation_route",
    ]) {
      expect(completion).toContain(
        `perform public.commit_study_route_revision(${routeVariable})`,
      );
      expect(completion).toContain(
        `perform public.assert_committed_study_route_projection(\n        ${routeVariable}`,
      );
    }
    expect(completion).toContain("public.validate_study_route_write_identity(");
    expect(migration).toContain("post_session_persisted_session_conflict");
    expect(migration).toContain("post_session_study_route_projection_conflict");
  });

  it("repairs only the mature review writers that drop route-bound arrays", () => {
    expect(arrayPersistence).toContain("requested_session -> 'topicids'");
    expect(arrayPersistence).toContain("requested_session -> 'contenttargets'");
    expect(arrayPersistence).toContain("requested_session -> 'completionevidence'");
    expect(arrayPersistence).toContain("post_session_route_array_projection_conflict");
    expect(arrayPersistence).toContain("update public.plan_sessions as session");
    expect(completion).toContain("requested_variant = 'guided' and follow_up_route_present");
    expect(reviewActivation).toContain("public.persist_route_session_arrays(");
    expect(routeProjection).toContain("projected_topic_ids");
    expect(routeProjection).toContain("projected_completion_evidence");
  });

  it("makes route-owned legacy scalars canonical before route commitment", () => {
    expect(scalarProjection).toContain(
      "objective = requested_route #>> '{target,desiredoutcome}'",
    );
    expect(scalarProjection).toContain(
      "method = requested_route #>> '{approach,visiblemethodname}'",
    );
    expect(scalarProjection).toContain(
      "method_rationale = requested_route #>> '{explanation,shortreason}'",
    );
    expect(scalarProjection).toContain("estimated_minutes = requested_active_minutes");
    expect(scalarProjection).toContain(
      "session.committed_route_revision_id = requested_predecessor_revision_id",
    );
    expect(completion).toContain(
      "perform public.persist_study_route_scalar_projection(",
    );
    expect(reviewActivation).toContain(
      "perform public.persist_study_route_scalar_projection(",
    );
    expect(migration).toContain(
      "requested_route jsonb := requested_session -> 'studyroute'",
    );
  });

  it("verifies objective and execution environment against canonical rows", () => {
    expect(routeProjection).toContain("expected_desired_outcome");
    expect(routeProjection).toContain("join public.learning_items as item");
    expect(routeProjection).toContain("item.study_mode");
    expect(routeProjection).toContain("{target,desiredoutcome}");
    expect(routeProjection).toContain("{approach,executionenvironment}");
    expect(routeProjection).not.toContain("plan.study_mode");
  });

  it("activates concept reviews and their initial route idempotently", () => {
    expect(reviewActivation).toContain("security definer\nset search_path = ''");
    const advisory = reviewActivation.indexOf("pg_advisory_xact_lock");
    const planLock = reviewActivation.indexOf("from public.plans as plan");
    const orderedSessions = reviewActivation.indexOf("order by session.sequence, session.id");
    expect(planLock).toBeGreaterThan(advisory);
    expect(orderedSessions).toBeGreaterThan(planLock);
    expect(reviewActivation).toContain("concept_review_study_route_coverage_conflict");
    expect(reviewActivation).toContain("review_session - 'studyroute'");
    expect(reviewActivation).toContain("public.activate_concept_review(sanitized_payload)");
    expect(reviewActivation).toContain("public.commit_study_route_revision(requested_route)");
    expect(reviewActivation).toContain("concept_review_activation_retry_conflict");
    expect(reviewActivation).toContain("event.event_type = 'concept_review_activated'");
  });

  it("guards the route pointer using committed direct-successor state", () => {
    expect(pointerGuard).toContain("before update of committed_route_revision_id");
    expect(pointerGuard).toContain("new_route.lifecycle <> 'committed'");
    expect(pointerGuard).toContain("old_route.lifecycle <> 'superseded'");
    expect(pointerGuard).toContain(
      "new_route.predecessor_revision_id\n      is distinct from old_route.route_revision_id",
    );
    expect(pointerGuard).toContain(
      "new_route.revision_number <> old_route.revision_number + 1",
    );
    expect(pointerGuard).toContain("study_route_pointer_rpc_required");
  });

  it("keeps legacy null-pointer use through wrappers while closing mature RPCs", () => {
    for (const matureFunction of [
      "save_active_session_checkpoint(jsonb)",
      "save_active_session_checkpoint_with_completion_mode(jsonb)",
      "complete_plan_session(jsonb)",
      "complete_unguided_plan_session(jsonb)",
      "complete_guided_plan_session_with_continuation(jsonb)",
      "record_session_interruption(jsonb)",
      "record_session_interruption_with_activity_progress(jsonb)",
      "activate_concept_review(jsonb)",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${matureFunction}\nfrom public, anon, authenticated`,
      );
    }
    expect(migration).toContain(
      "grant execute on function public.complete_plan_session_with_route(jsonb)\nto authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.activate_concept_review_with_route(jsonb)\nto authenticated",
    );
    expect(completion).toContain("routed_origin := requested_route_revision_id is not null");
  });
});

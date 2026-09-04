import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202609040002_storage_and_untrusted_write_quotas.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("storage and untrusted-write quota migration", () => {
  it("preflights every live DDL target without waiting on a partial lock set", () => {
    const lockStart = migration.indexOf("lock table\n");
    const lockEnd = migration.indexOf("in access exclusive mode nowait;", lockStart);
    const firstSchemaChange = migration.indexOf(
      "create table private.account_daily_write_usage_v1",
    );

    expect(lockStart).toBeGreaterThan(-1);
    expect(lockEnd).toBeGreaterThan(lockStart);
    expect(lockEnd).toBeLessThan(firstSchemaChange);
    const lockSet = migration.slice(lockStart, lockEnd);
    for (const relation of [
      "public.plan_sessions",
      "public.plans",
      "public.learning_items",
      "public.study_routes",
      "public.session_attempts",
      "public.learning_events",
      "public.material_uploads",
      "public.materials",
      "public.material_chunks",
      "public.profiles",
      "public.learner_profiles",
      "public.deadline_milestones",
      "public.tutor_threads",
      "public.tutor_messages",
      "public.product_events",
      "public.error_reports",
      "public.support_requests",
      "storage.objects",
      "auth.users",
    ]) {
      expect(lockSet).toContain(relation);
    }
  });

  it("keeps daily counters private and increments them atomically", () => {
    expect(migration).toContain("create table private.account_daily_write_usage_v1");
    expect(migration).toContain("primary key (user_id, usage_day, write_kind)");
    expect(migration).toContain(
      "revoke all on table private.account_daily_write_usage_v1\nfrom public, anon, authenticated, service_role",
    );

    const quota = functionBody("private", "consume_account_daily_write_quota_v1");
    expect(quota).toContain("security definer\nset search_path = ''");
    expect(quota).toContain("on conflict (user_id, usage_day, write_kind) do update");
    expect(quota).toContain("delete from private.account_daily_write_usage_v1 as expired");
    expect(quota).toContain("at time zone 'UTC')::date - 7");
    expect(quota).toContain(
      "usage.rows_used <= requested_row_limit - excluded.rows_used",
    );
    expect(quota).toContain(
      "usage.bytes_used <= requested_byte_limit - excluded.bytes_used",
    );
    expect(quota).toContain("requested_write_kind || '_daily_quota_exceeded'");
    for (const writeKind of [
      "profile_save",
      "learning_state_growth",
      "plan_map_update",
      "deadline_milestone",
      "material_extraction",
    ]) {
      expect(quota).toContain(`'${writeKind}'`);
    }
    expect(migration).toContain(
      "revoke all on function private.consume_account_daily_write_quota_v1(\n  uuid, text, integer, bigint, integer, bigint\n) from public, anon, authenticated, service_role",
    );
  });

  it("wraps staged creation with active, account and daily row/byte quotas", () => {
    expect(migration).toContain(
      "rename to create_material_upload_without_account_quotas_v1",
    );
    expect(migration).toContain(
      "revoke all on function public.create_material_upload_without_account_quotas_v1(jsonb)",
    );

    const createUpload = functionBody("public", "create_material_upload");
    expect(createUpload).toContain("security definer\nset search_path = ''");
    expect(createUpload).toContain("material_upload_active_quota_exceeded");
    expect(createUpload).toContain("material_account_storage_quota_exceeded");
    expect(createUpload).toContain("staged_rows >= 20");
    expect(createUpload).toContain("total_material_rows >= 250");
    expect(createUpload).toContain("'material_upload',\n    1,\n    requested_byte_size,\n    40,");
    expect(createUpload).toContain(
      "return public.create_material_upload_without_account_quotas_v1(payload)",
    );
    expect(migration).toContain(
      "grant execute on function public.create_material_upload(jsonb) to authenticated",
    );
  });

  it("closes direct durable-material and chunk writes while preserving owner reads", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on table public.material_chunks\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on table public.materials\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      'create policy "material_chunks_owner_select" on public.material_chunks',
    );
    expect(migration).toContain(
      'create policy "materials_owner_select" on public.materials',
    );
    expect(migration).toContain("grant select on table public.material_chunks to authenticated");
    expect(migration).toContain("grant select on table public.materials to authenticated");

    expect(migration).toContain(
      "revoke insert, update, delete on table public.material_uploads\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant update (extracted_text, metadata) on table public.material_uploads\nto authenticated",
    );
    expect(migration).toContain(
      'drop policy if exists "learning_material_objects_owner_update" on storage.objects',
    );
    expect(migration).toContain(
      'drop policy if exists "learning_material_objects_owner_delete" on storage.objects',
    );
    expect(migration).not.toContain(
      'create policy "learning_material_objects_owner_update" on storage.objects',
    );
    expect(migration).not.toContain(
      'create policy "learning_material_objects_owner_delete" on storage.objects',
    );
    const extractionGuard = functionBody(
      "public",
      "guard_material_upload_extraction_update_v1",
    );
    expect(extractionGuard).toContain("'material_extraction'");
    expect(extractionGuard).toContain("consume_account_daily_write_quota_v1");
    expect(migration).toContain(
      "before update of extracted_text, metadata on public.material_uploads",
    );
  });

  it("keeps final material-cleanup receipt deletion service-role-only", () => {
    const confirmation = functionBody(
      "public",
      "confirm_material_upload_cleanup",
    );
    const serviceGuard = confirmation.indexOf(
      "if auth.role() is distinct from 'service_role' then",
    );
    const receiptDelete = confirmation.indexOf(
      "delete from public.private_storage_cleanup_receipts",
    );
    expect(serviceGuard).toBeGreaterThan(-1);
    expect(receiptDelete).toBeGreaterThan(serviceGuard);
    expect(confirmation).toContain(
      "if auth.role() = 'authenticated'\n    and current_user_id is distinct from receipt.user_id",
    );
  });

  it("bounds every mapper-controlled row before its privileged delegate runs", () => {
    expect(migration).toContain(
      "rename to persist_material_mapping_result_without_bounds_v1",
    );
    const mapper = functionBody("public", "persist_material_mapping_result");
    expect(mapper).toContain("requested_chunk_count > 48");
    expect(mapper).toContain(
      "coalesce(requested_metadata_patch ->> 'mappingStatus', '') not in ('ready', 'failed')",
    );
    expect(mapper).toContain("pg_catalog.octet_length(requested_chunks::text) > 1500000");
    expect(mapper).toContain("'material_mapping',\n    1,\n    requested_payload_bytes,\n    120,");
    expect(mapper).toContain(
      "return public.persist_material_mapping_result_without_bounds_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.persist_material_mapping_result(\n  text, uuid, jsonb, jsonb, jsonb\n) to authenticated",
    );
  });

  it("moves tutor persistence behind its bounded RPC without changing its signature", () => {
    expect(migration).toContain(
      "rename to save_tutor_exchange_without_account_quotas_v1",
    );
    const tutor = functionBody("public", "save_tutor_exchange");
    expect(tutor).toContain("existing_thread_count + new_thread_count > 100");
    expect(tutor).toContain("existing_message_count + new_message_count > 5000");
    expect(tutor).toContain("'tutor_exchange',\n    1,\n    new_message_bytes,\n    100,");
    expect(tutor).toContain(
      "return public.save_tutor_exchange_without_account_quotas_v1(payload)",
    );
    expect(migration).toContain(
      "revoke insert, update, delete on table public.tutor_threads, public.tutor_messages\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.save_tutor_exchange(jsonb) to authenticated",
    );
  });

  it("puts non-bypassable daily quotas on retained direct-insert endpoints", () => {
    const guard = functionBody("public", "guard_bounded_authenticated_insert_v1");
    expect(guard).toContain("auth.role() is distinct from 'authenticated'");
    expect(guard).toContain("new.user_id is distinct from current_user_id");
    expect(guard).toContain("current_user_id, 'product_event', 1, requested_bytes, 500, 1048576");
    expect(guard).toContain("current_user_id, 'error_report', 1, requested_bytes, 100, 262144");
    expect(guard).toContain("current_user_id, 'support_request', 1, requested_bytes, 10, 65536");
    for (const boundary of [
      "product_event_account_quota_exceeded",
      "error_report_account_quota_exceeded",
      "support_request_account_quota_exceeded",
    ]) {
      expect(guard).toContain(boundary);
    }
    for (const trigger of [
      "guard_bounded_product_event_insert_v1",
      "guard_bounded_error_report_insert_v1",
      "guard_bounded_support_request_insert_v1",
    ]) {
      expect(migration).toContain(`create trigger ${trigger}`);
    }
  });

  it("makes profile and core learning growth RPC-only and account bounded", () => {
    expect(migration).toContain("profiles_display_name_bounded_v1");
    expect(migration).toContain("learner_profiles_text_bounded_v1");
    expect(migration).toContain("learning_items_text_bounded_v1");
    expect(migration).toContain("plans_payload_bounded_v1");
    expect(migration).toContain(
      "revoke insert, update, delete on table\n  public.profiles,\n  public.learner_profiles,\n  public.learning_items,\n  public.plans\nfrom public, anon, authenticated",
    );
    for (const policy of [
      "profiles_owner_select",
      "learner_profiles_owner_select",
      "learning_items_owner_select",
      "plans_owner_select",
    ]) {
      expect(migration).toContain(`create policy "${policy}"`);
    }

    const profile = functionBody("public", "save_learner_profile");
    expect(profile).toContain("learner_profile_payload_invalid");
    expect(profile).toContain("'profile_save'");
    expect(profile).toContain(
      "public.save_learner_profile_without_write_quotas_v1(payload)",
    );

    const growth = functionBody(
      "public",
      "guard_bounded_learning_record_insert_v1",
    );
    for (const boundary of [
      "learning_items_account_quota_exceeded",
      "plans_account_quota_exceeded",
      "plan_sessions_account_quota_exceeded",
      "study_routes_account_quota_exceeded",
      "session_attempts_account_quota_exceeded",
      "learning_events_account_quota_exceeded",
    ]) {
      expect(growth).toContain(boundary);
    }
    expect(growth).toContain("'learning_state_growth'");
    for (const trigger of [
      "guard_bounded_learning_item_insert_v1",
      "guard_bounded_plan_insert_v1",
      "guard_bounded_plan_session_insert_v1",
      "guard_bounded_study_route_insert_v1",
      "guard_bounded_session_attempt_insert_v1",
      "guard_bounded_learning_event_insert_v1",
    ]) {
      expect(migration).toContain(`create trigger ${trigger}`);
    }
  });

  it("bounds diagnostic map writes while preserving the DB-first rollout", () => {
    const diagnostic = functionBody(
      "public",
      "update_plan_diagnostic_knowledge_map_v1",
    );
    expect(diagnostic).toContain("security definer\nset search_path = ''");
    expect(diagnostic).toContain("plan_diagnostic_map_invalid");
    expect(diagnostic).toContain("requested_topic_count not between 1 and 40");
    expect(migration).toContain(
      "grant execute on function public.update_plan_diagnostic_knowledge_map_v1(uuid, jsonb)\nto authenticated",
    );

    const compatibilityGuard = functionBody(
      "public",
      "guard_plan_knowledge_map_update_v1",
    );
    expect(compatibilityGuard).toContain("'plan_map_update'");
    expect(compatibilityGuard).toContain("consume_account_daily_write_quota_v1");
    expect(migration).toContain(
      "grant update (knowledge_map) on table public.plans to authenticated",
    );
    expect(migration).toContain(
      'create policy "plans_owner_knowledge_map_update" on public.plans',
    );
  });

  it("bounds milestone growth while keeping owner deletion available for privacy resets", () => {
    const milestone = functionBody(
      "public",
      "guard_deadline_milestone_write_v1",
    );
    expect(milestone).toContain("deadline_milestone_account_quota_exceeded");
    expect(milestone).toContain("new.id is distinct from old.id");
    expect(milestone).toContain("'deadline_milestone'");
    expect(milestone.indexOf("if tg_op = 'DELETE' then\n    return old")).toBeLessThan(
      milestone.indexOf("consume_account_daily_write_quota_v1"),
    );
    expect(migration).toContain(
      "before insert or update or delete on public.deadline_milestones",
    );
  });

  it("publishes an exact service-role-only combined abuse readiness contract", () => {
    const readiness = functionBody("public", "public_launch_abuse_readiness_v1");
    expect(readiness).toContain("'contractVersion', '202609040002'");
    expect(readiness).toContain("'ready', result_ready");
    expect(readiness).toContain("'aiActionsCovered', ai_actions_covered");
    expect(readiness).toContain("'materialUploadQuota', material_upload_quota_ready");
    expect(readiness).toContain(
      "'materialChunkWriteBoundary', material_chunk_write_boundary_ready",
    );
    expect(readiness).toContain("'untrustedInsertQuotas', untrusted_insert_quotas_ready");
    expect(readiness).toContain("'tutorWriteBoundary', tutor_write_boundary_ready");
    expect(readiness).toContain("guard_bounded_deadline_milestone_write_v1");
    expect(readiness).toContain("guard_plan_knowledge_map_update_v1");
    expect(readiness).toContain("has_any_column_privilege");
    expect(readiness).toContain("from pg_catalog.pg_class as relation");
    expect(readiness).toContain("relation.relname not in (");
    expect(readiness).toContain("product_event_account_quota_exceeded");
    expect(readiness).toContain("error_report_account_quota_exceeded");
    expect(readiness).toContain("support_request_account_quota_exceeded");
    expect(readiness).toContain("ai_usage_limits_v1(text,boolean)");
    expect(readiness).toContain("legacy_ai_claim_disabled");
    expect(readiness).toContain(
      "reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)",
    );
    expect(readiness).toContain(
      "release_ai_request_reservation_for_user(uuid,text,uuid,uuid)",
    );
    expect(readiness).toContain(
      "pg_catalog.strpos(reclaim_definition, 'release_ai_usage_reservation_locked') = 0",
    );
    expect(readiness).toContain(
      "pg_catalog.strpos(locked_release_definition, 'delete from public.ai_usage_claims') > 0",
    );
    expect(readiness).toContain(
      "pg_catalog.strpos(release_definition, 'consume_ai_request_claim_for_user_internal_v1') > 0",
    );
    expect(readiness).toContain(
      "'authenticated', 'public.claim_ai_request(text,integer,integer)', 'execute'",
    );
    for (const serviceRpc of [
      "reserve_ai_request_for_user(uuid,text,uuid,uuid,boolean)",
      "consume_ai_request_claim_for_user(uuid,uuid)",
      "release_ai_request_claim_for_user(uuid,uuid)",
      "release_ai_request_reservation_for_user(uuid,text,uuid,uuid)",
    ]) {
      expect(readiness).toContain(`'public.${serviceRpc}'`);
    }
    for (const action of [
      "plan_generation",
      "plan_adjustment",
      "intake_interpretation",
      "material_processing",
      "session_generation",
      "lesson_generation",
      "answer_evaluation",
      "tutor_message",
      "teaching_visual",
    ]) {
      expect(readiness).toContain(`'${action}'`);
    }
    expect(migration).toContain(
      "revoke all on function public.public_launch_abuse_readiness_v1()\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.public_launch_abuse_readiness_v1() to service_role",
    );
  });
});

function functionBody(schema: "private" | "public", name: string) {
  const start = migration.lastIndexOf(`create or replace function ${schema}.${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = migration.indexOf("\n$$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../supabase/migrations/202608210002_reconcile_active_plan_material_attachments.sql", import.meta.url),
  "utf8",
);
const lintFixMigration = readFileSync(
  new URL("../../../supabase/migrations/202608210004_fix_material_attachment_uuid_array.sql", import.meta.url),
  "utf8",
);
const generationRoute = readFileSync(
  new URL("../../app/api/sessions/generate/route.ts", import.meta.url),
  "utf8",
);

describe("active-plan material attachment migration", () => {
  it("repairs the deployed UUID accumulator without weakening the RPC grants", () => {
    expect(lintFixMigration).toContain("requested_ids uuid[] := array[]::uuid[];");
    expect(lintFixMigration).toContain("pg_get_functiondef");
    expect(lintFixMigration).toContain("raise exception 'The expected material-attachment UUID accumulator was not found.'");
    expect(lintFixMigration).toContain(
      "revoke all on function public.attach_materials_to_plan(jsonb) from public, anon;",
    );
    expect(lintFixMigration).toContain(
      "grant execute on function public.attach_materials_to_plan(jsonb) to authenticated;",
    );
  });

  it("rejects missing, null, or malformed direct-RPC payload fields before mutation", () => {
    expect(migration).toContain("jsonb_typeof(payload) is distinct from 'object'");
    expect(migration).toContain("jsonb_typeof(payload -> 'planId') is distinct from 'string'");
    expect(migration).toContain("jsonb_typeof(payload -> 'materialIds') is distinct from 'array'");
    expect(migration).toContain("jsonb_typeof(material_id.value) is distinct from 'string'");
    expect(migration).toContain("jsonb_typeof(candidate_map) is distinct from 'object'");
    expect(migration).toContain("candidate_map ->> 'version' is distinct from '1'");
    expect(migration).toContain("jsonb_typeof(candidate_map -> 'topics') is distinct from 'array'");
    expect(migration).toContain("jsonb_typeof(candidate.topic -> 'sourceReferences') is distinct from 'array'");
    expect(migration).toContain("jsonb_typeof(reference.value) is distinct from 'object'");
  });

  it("commits chunks, mapping metadata, and Ready status as one truth", () => {
    expect(migration).toContain("create or replace function public.persist_material_mapping_result");
    expect(migration).toContain("jsonb_typeof(requested_metadata_patch -> 'materialUnderstanding') is distinct from 'object'");
    expect(migration).toContain("raise exception 'The material mapping result is incomplete.'");
    expect(migration).toContain("(reference.value ->> 'materialId')::uuid <> requested_material_id");
    expect(migration).toContain("(chunk.value ->> 'id')::uuid = (reference.value ->> 'chunkId')::uuid");
    expect(migration).toContain("where not exists (\n        select 1\n        from jsonb_array_elements(requested_metadata_patch -> 'materialUnderstanding' -> 'topics')");
    expect(migration).toContain("processing_status = case when mark_ready then 'ready' else processing_status end");
    expect(migration.indexOf("processing_status = case when mark_ready"))
      .toBeGreaterThan(migration.indexOf("insert into public.material_chunks"));
  });

  it("requires durable mapping and verifies exact source chunk identities", () => {
    expect(migration).toContain("upload.metadata ->> 'mappingStatus' = 'ready'");
    expect(migration).toContain("jsonb_typeof(upload.metadata -> 'materialUnderstanding') = 'object'");
    expect(migration).toContain("chunk.id = (reference.value ->> 'chunkId')::uuid");
    expect(migration).toContain("chunk.chunk_index = (reference.value ->> 'chunkIndex')::smallint");
    expect(migration).toContain("material.learning_item_id = requested_plan.learning_item_id");
    expect(migration).toContain("chunk.material_id = any(requested_ids)");
  });

  it("makes prior provenance append-only and rejects unrequested new references", () => {
    expect(migration).toContain("candidate_reference.value = stored_reference.value");
    expect(migration).toContain("stored_reference.value = candidate_reference.value");
    expect(migration).toContain("candidate_reference.value ->> 'materialId')::uuid <> all(requested_ids)");
    expect(migration).toContain("Existing provenance is append-only at this boundary");
    expect(migration).toContain("with ordinality as stored_reference(value, position)");
    expect(migration).toContain("is distinct from stored_reference.value");
    expect(migration).toContain("count(distinct reference.value)");
  });

  it("keeps top-level map state and topic ordering immutable", () => {
    expect(migration).toContain("(candidate_map - 'topics') is distinct from (requested_plan.knowledge_map - 'topics')");
    expect(migration).toContain("with ordinality as stored(topic, position)");
    expect(migration).toContain("candidate.topic ->> 'id' is distinct from stored.topic ->> 'id'");
  });

  it("normalizes only schema defaults omitted by legacy plan maps", () => {
    expect(migration).toContain("case when topic.value ? 'initialEvidence'");
    expect(migration).toContain("case when topic.value ? 'sourceReferences'");
    expect(migration).toContain("if not (requested_plan.knowledge_map ? 'placementCheck') then");
    expect(migration).toContain("'demonstratedTopicIds', '[]'::jsonb");
  });

  it("only changes topic origin when a requested material adds a verified reference", () => {
    expect(migration).toContain("then candidate.topic ->> 'origin' <> 'material'");
    expect(migration).toContain("else (candidate.topic -> 'origin') is distinct from (stored.topic -> 'origin')");
  });

  it("keeps topic identities fixed and protects generated or interrupted work", () => {
    expect(migration).toContain("candidate.topic - 'sourceReferences' - 'origin'");
    expect(migration).toContain("session.step_data ? 'generatedSession'");
    expect(migration).toContain("session.step_data ? 'activeSessionCheckpoint'");
    expect(migration).toContain("event.event_type = 'session_interrupted'");
    expect(migration).toContain("material_attachment_saved_work_protected");
  });

  it("locks unfinished sessions before checking saved work or changing the source", () => {
    const lock = migration.indexOf("perform session.id");
    const savedWorkCheck = migration.indexOf("session.step_data ? 'generatedSession'");
    const sourceUpdate = migration.indexOf("set source_mode = 'user_materials'");

    expect(lock).toBeGreaterThan(migration.indexOf("for update;"));
    expect(savedWorkCheck).toBeGreaterThan(lock);
    expect(sourceUpdate).toBeGreaterThan(savedWorkCheck);
    expect(migration.slice(lock, savedWorkCheck)).toContain("for update;");
  });

  it("rejects a generated lesson cached against the pre-attachment context", () => {
    expect(migration).toContain("expectedKnowledgeMap");
    expect(migration).toContain("expectedSourceMode");
    const planShareLock = migration.indexOf("select plan.knowledge_map, plan.updated_at, plan.learning_item_id");
    const itemShareLock = migration.indexOf("select item.source_mode, item.updated_at");
    const sessionUpdateLock = migration.indexOf("select session.updated_at, session.step_data -> 'generatedSession'");
    expect(planShareLock).toBeGreaterThan(0);
    expect(itemShareLock).toBeGreaterThan(planShareLock);
    expect(sessionUpdateLock).toBeGreaterThan(itemShareLock);
    expect(migration.slice(planShareLock, itemShareLock)).toContain("for share;");
    expect(migration.slice(itemShareLock, sessionUpdateLock)).toContain("for share;");
    expect(migration).toContain("errcode = '40001', message = 'session_generation_context_changed'");
    expect(migration).toContain("stored_plan_updated_at is distinct from (payload ->> 'expectedPlanUpdatedAt')::timestamptz");
    expect(migration).toContain("stored_session_updated_at is distinct from (payload ->> 'expectedSessionUpdatedAt')::timestamptz");
    expect(migration).toContain("stored_learning_item_updated_at is distinct from (payload ->> 'expectedLearningItemUpdatedAt')::timestamptz");
    expect(migration).toContain("stored_source_mode = 'user_materials' and not has_expected_context");
    for (const field of [
      "expectedKnowledgeMap",
      "expectedSourceMode",
      "expectedPlanUpdatedAt",
      "expectedSessionUpdatedAt",
      "expectedLearningItemUpdatedAt",
    ]) expect(generationRoute).toContain(field);
  });

  it("is idempotent and returns the committed reconciled map", () => {
    expect(migration).toContain("if exists (\n      select 1 from public.materials");
    expect(migration).toContain("if attached_count > 0 then");
    expect(migration).toContain("'knowledgeMap', candidate_map");
  });

  it("requires every requested material to reach unfinished session scope", () => {
    expect(migration).toMatch(
      /select 1 from unnest\(requested_ids\) as requested\(id\)\s+where not exists \([\s\S]+session\.status in \('ready', 'upcoming'\)[\s\S]+materialId'\)::uuid = requested\.id/,
    );
  });

  it("keeps completed-only topic provenance immutable", () => {
    expect(migration).toContain("Completed-only topic provenance is learner history");
    expect(migration).toContain("session_topic.id = stored.topic ->> 'id'");
    expect(migration).toContain("candidate.topic -> 'sourceReferences' is distinct from stored.topic -> 'sourceReferences'");
    expect(migration).toContain("candidate.topic -> 'origin' is distinct from stored.topic -> 'origin'");
  });
});

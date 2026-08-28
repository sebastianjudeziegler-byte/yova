import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608240006_blurting_resource_store_v18.sql";
const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(
  resolve(migrationDirectory, migrationName),
  "utf8",
).toLocaleLowerCase();

function section(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

const resourceTable = section(
  "create table private.blurting_resources_v18 (",
  "create unique index blurting_resources_v18_one_ready_route_idx",
);
const deliveryTable = section(
  "create table private.blurting_delivery_receipts_v18 (",
  "create index blurting_delivery_receipts_v18_cleanup_idx",
);
const evaluationTable = section(
  "create table private.blurting_evaluation_receipts_v18 (",
  "create index blurting_evaluation_receipts_v18_cleanup_idx",
);
const cleanup = section(
  "create or replace function public.cleanup_blurting_resource_store_v18(",
  "alter function public.reset_yova_learning_data()",
);
const reset = section(
  "create or replace function public.reset_yova_learning_data()",
  "comment on table private.blurting_resources_v18",
);
const canonicalJson = section(
  "create or replace function private.canonical_json_v1(",
  "create or replace function private.blurting_public_payload_digest_v18(",
);
const digestHelpers = section(
  "create or replace function private.blurting_public_payload_digest_v18(",
  "-- pinned cross-language vector",
);
const sourceSnapshotValidator = section(
  "create or replace function private.blurting_source_snapshot_valid_v1(",
  "-- evaluation receipts retain only",
);
const publicPayloadValidator = section(
  "create or replace function private.blurting_public_resource_payload_valid_v18(",
  "-- canonical resources contain two deliberately separate json values.",
);

describe("dormant private Blurting V18 resource-store migration", () => {
  it("is ordered immediately after the migration-005 containment boundary and preflights it", () => {
    const ordered = readdirSync(migrationDirectory)
      .filter((name) => /^20260824000[56]_/.test(name))
      .sort();

    expect(ordered).toEqual([
      "202608240005_generated_resource_authority.sql",
      migrationName,
    ]);
    expect(migration).toContain(
      "'public.generated_resource_authority_permits'",
    );
    expect(migration).toContain(
      "'public.generated_resource_digest_v1(jsonb)'",
    );
    expect(migration).toContain(
      "'public.guard_generated_resource_authority_v1()'",
    );
    expect(migration).toContain(
      "%generated_resource_authority_unavailable%",
    );
    expect(migration).toContain([
      "or exists (",
      "      select 1",
      "      from public.generated_resource_authority_permits",
      "    )",
    ].join("\n"));
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["select", "insert", "update", "delete"]) {
        expect(migration).toContain(`'${role}'`);
        expect(migration).toContain(`'${privilege}'`);
      }
    }
    expect(migration).toContain(
      "message = 'blurting_resource_store_v18_dependency_changed'",
    );
  });

  it("creates one unexposed schema and exactly three private table roots", () => {
    expect(migration).toContain("create schema if not exists private;");
    expect(migration).toContain(
      "revoke all on schema private from public, anon, authenticated, service_role;",
    );
    expect(migration.match(/create table private\./gu)).toHaveLength(3);
    expect(migration).toContain(
      "create table private.blurting_resources_v18 (",
    );
    expect(migration).toContain(
      "create table private.blurting_delivery_receipts_v18 (",
    );
    expect(migration).toContain(
      "create table private.blurting_evaluation_receipts_v18 (",
    );
  });

  it("binds each canonical resource to the exact owner, plan, session, and route without a mismatched item copy", () => {
    for (const identity of [
      "user_id uuid not null references auth.users(id) on delete cascade",
      "plan_id uuid not null",
      "plan_session_id uuid not null",
      "route_revision_id uuid not null",
      "route_lineage_id uuid not null",
      "generation_key uuid not null",
    ]) {
      expect(resourceTable).toContain(identity);
    }
    expect(resourceTable).toContain(
      "references public.plans(id, user_id) on delete cascade",
    );
    expect(resourceTable).not.toContain("learning_item_id");
    expect(resourceTable).not.toContain("public.learning_items");
    expect(resourceTable).toContain(
      "references public.plan_sessions(id, plan_id, user_id) on delete cascade",
    );
    expect(resourceTable).toContain([
      "references public.study_routes(",
      "    route_revision_id,",
      "    route_lineage_id,",
      "    plan_session_id,",
      "    plan_id,",
      "    user_id",
      "  ) on delete cascade",
    ].join("\n"));
    expect(resourceTable).toContain(
      "unique (user_id, generation_key)",
    );
    expect(migration).toContain([
      "create unique index blurting_resources_v18_one_ready_route_idx",
      "on private.blurting_resources_v18(user_id, plan_session_id, route_revision_id)",
      "where state = 'ready';",
    ].join("\n"));
  });

  it("bounds source identity, lifecycle, payload size, timestamps, and all digests", () => {
    expect(resourceTable).toContain(
      "source_type in ('user_materials', 'trusted_external_source')",
    );
    expect(resourceTable).toContain(
      "private.blurting_source_ids_valid_v1(required_source_ids)",
    );
    expect(migration).toContain(
      "pg_catalog.array_ndims(source_ids) is distinct from 1",
    );
    expect(migration).toContain(
      "pg_catalog.array_lower(source_ids, 1) is distinct from 1",
    );
    expect(resourceTable).toContain(
      "server_payload #> '{sourceauthority,requiredsourceids}'\n      is not distinct from pg_catalog.to_jsonb(required_source_ids)",
    );
    expect(resourceTable).toContain([
      "private.blurting_source_snapshot_valid_v1(",
      "      server_payload #> '{sourceauthority,sourcesnapshot}',",
      "      source_type,",
      "      required_source_ids",
    ].join("\n"));
    expect(resourceTable).toContain(
      "state in ('ready', 'superseded', 'retired')",
    );
    expect(resourceTable).toContain(
      "retire_after = retired_at + interval '720 hours'",
    );
    expect(resourceTable).toContain(
      "pg_catalog.octet_length(public_payload::text) between 2 and 65536",
    );
    expect(resourceTable).toContain(
      "pg_catalog.octet_length(server_payload::text) between 2 and 262144",
    );
    expect(resourceTable).toContain(
      "public_payload #>> '{identity,resourcegeneratedat}'",
    );
    expect(resourceTable).toContain(
      ") between 20 and 64\n    and (\n      public_payload #>> '{identity,resourcegeneratedat}'\n    )::timestamptz = generated_at",
    );
    expect(resourceTable).toContain(
      "(server_payload #> '{sourceauthority,sourcesnapshot}')::text\n    ) between 2 and 196608",
    );
    expect(resourceTable.match(/pg_catalog\.octet_length\([^)]*digest\) = 32/gu))
      .toHaveLength(4);

    for (const key of [
      "'sourceid'",
      "'sourceversionid'",
      "'chunkid'",
      "'sourcelabel'",
      "'locationlabel'",
      "'contentdigest'",
      "'canonicaltext'",
    ]) {
      expect(sourceSnapshotValidator).toContain(key);
    }
    expect(sourceSnapshotValidator).toContain(
      "pg_catalog.jsonb_array_length(source_snapshot -> 'manifest')\n      not between 1 and 24",
    );
    expect(sourceSnapshotValidator).toContain(
      "pg_catalog.length(canonical_text) not between 1 and 7000",
    );
    expect(sourceSnapshotValidator).toContain(
      "canonical_text is distinct from pg_catalog.btrim(canonical_text)",
    );
    expect(sourceSnapshotValidator).toContain(
      "private.blurting_source_chunk_digest_v1(canonical_text)",
    );
    expect(sourceSnapshotValidator).toContain(
      "pair_identity = any(seen_pairs)",
    );
    expect(sourceSnapshotValidator).toContain(
      "required_source_id = any(seen_source_ids)",
    );
    expect(resourceTable).toContain(
      "create or replace function private.guard_blurting_resource_route_source_v18()",
    );
    expect(resourceTable).toContain([
      "route.route_payload",
      "      #>> '{target,sourcerequirements,sourcetype}',",
      "    route.route_payload",
      "      #> '{target,sourcerequirements,requiredsourceids}'",
    ].join("\n"));
    const routeGuard = resourceTable.indexOf(
      "create or replace function private.guard_blurting_resource_route_source_v18()",
    );
    const accountLock = resourceTable.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      routeGuard,
    );
    const sessionLock = resourceTable.indexOf(
      "from public.plan_sessions as session",
      accountLock,
    );
    const sessionShare = resourceTable.indexOf("for share;", sessionLock);
    const routeLock = resourceTable.indexOf(
      "from public.study_routes as route",
      sessionShare,
    );
    const routeShare = resourceTable.indexOf("for share;", routeLock);
    expect(accountLock).toBeGreaterThan(routeGuard);
    expect(sessionLock).toBeGreaterThan(accountLock);
    expect(sessionShare).toBeGreaterThan(sessionLock);
    expect(routeLock).toBeGreaterThan(sessionShare);
    expect(routeShare).toBeGreaterThan(routeLock);
    expect(resourceTable).toContain(
      "lock, then the plan lock, before inserting",
    );
    expect(resourceTable).toContain(
      "committed_route_revision_id is distinct from new.route_revision_id",
    );
    expect(resourceTable).toContain(
      "route_technique_id is distinct from 'blurting_v1'",
    );
    expect(resourceTable).toContain(
      "message = 'blurting_resource_route_source_mismatch'",
    );
    expect(resourceTable).toContain([
      "create trigger blurting_resources_v18_guard_route_source",
      "before insert or update of",
    ].join("\n"));
  });

  it("pins the exact answer-free public resource projection at the table boundary", () => {
    expect(resourceTable).toContain(
      "private.blurting_public_resource_payload_valid_v18(public_payload)",
    );
    for (const exactKeys of [
      "'schemaversion',\n        'boundarystatus',\n        'identity',\n        'orderedtargets',\n        'phasemetadata',\n        'gapcount',\n        'initialrecall'",
      "array['targetid', 'evidenceid', 'displaylabel']::text[]",
      "'phaseid',\n          'methodphase',\n          'activeminutes',\n          'targetids'",
      "array['sourceclosedreminder', 'prompt']::text[]",
    ]) {
      expect(publicPayloadValidator).toContain(exactKeys);
    }
    expect(publicPayloadValidator.match(
      /private\.jsonb_has_exact_keys_v1\(/gu,
    )).toHaveLength(5);
    expect(publicPayloadValidator).toContain(
      "'disabled_public_resource_template_only'",
    );
    expect(publicPayloadValidator).toContain(
      "!~ '^sr1:[0-9a-f]{16}$'",
    );
    expect(publicPayloadValidator).toContain(
      "evidence_id is distinct from 'blurting-final-check:' || target_id",
    );
    expect(publicPayloadValidator).toContain(
      "expected_phase_ids[phase_index]",
    );
    expect(publicPayloadValidator).toContain(
      "expected_phase_names[phase_index]",
    );
    expect(publicPayloadValidator).toContain(
      "is distinct from target_ids[phase_target_index]",
    );
    expect(publicPayloadValidator).toContain(
      "display_label is distinct from pg_catalog.btrim(display_label)",
    );
    expect(migration).toContain(
      "revoke all on function private.blurting_public_resource_payload_valid_v18(\n  jsonb\n) from public, anon, authenticated, service_role;",
    );
  });

  it("keeps the complete V18 candidate server-only and rejects nested secret smuggling in the public projection", () => {
    expect(resourceTable).toContain(
      "server_payload #>> '{session,schemaversion}'\n      is not distinct from '18'",
    );
    expect(resourceTable).toContain(
      "server_payload\n      #>> '{session,deliveryidentity,visiblesupportingtechniqueid}'",
    );
    expect(resourceTable).toContain(
      "private.jsonb_contains_any_key_v1(\n      public_payload",
    );
    expect(migration).toContain(
      "pg_catalog.lower(forbidden_key.key)\n          = pg_catalog.lower(object_entry.key)",
    );
    expect(migration).toContain(
      "exact nested object keys remain the primary allow-list",
    );
    for (const forbidden of [
      "'expectedanswer'",
      "'comparisoncriterion'",
      "'transfersuccesscriterion'",
      "'referenceanswer'",
      "'canonicalconcept'",
      "'sourceanchors'",
      "'sourcesnapshot'",
      "'learneranswer'",
      "'recalldraft'",
      "'correctiondraft'",
      "'transferdraft'",
    ]) {
      expect(resourceTable).toContain(forbidden);
    }
    expect(resourceTable).toContain(
      "public_payload ->> 'boundarystatus'\n      is not distinct from 'disabled_public_resource_template_only'",
    );
    expect(resourceTable).toContain(
      "server_payload ->> 'servercontractversion'\n      is not distinct from 'blurting_server_resource_v18'",
    );
    expect(resourceTable).toContain("'orderedpublictargets'");
    expect(resourceTable).toContain("'orderedevaluationreferences'");
    expect(resourceTable).toContain("'sourceauthority'");
    expect(resourceTable).toContain("'canonicaldigests'");
    expect(resourceTable).toContain(
      "server_payload -> 'orderedpublictargets'\n      is not distinct from public_payload -> 'orderedtargets'",
    );
    expect(resourceTable).not.toContain("delivery_handle");
    expect(resourceTable).not.toContain("deliveryhandle");
    expect(resourceTable).not.toContain("run_id");
    expect(resourceTable).not.toContain("activity_index");
  });

  it("makes resource content and identity immutable while allowing only monotonic retirement", () => {
    const immutableGuard = resourceTable.indexOf(
      "create or replace function private.guard_blurting_resource_immutability_v18()",
    );
    const lifecycleAccountLock = resourceTable.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      immutableGuard,
    );
    const immutableComparison = resourceTable.indexOf(
      "if new.id is distinct from old.id",
      immutableGuard,
    );
    expect(lifecycleAccountLock).toBeGreaterThan(immutableGuard);
    expect(immutableComparison).toBeGreaterThan(lifecycleAccountLock);
    for (const column of [
      "id",
      "generation_key",
      "user_id",
      "plan_id",
      "plan_session_id",
      "route_revision_id",
      "route_lineage_id",
      "resource_fingerprint",
      "schema_version",
      "resource_kind",
      "source_type",
      "required_source_ids",
      "source_snapshot_id",
      "generated_at",
      "public_payload",
      "server_payload",
      "public_payload_digest",
      "server_payload_digest",
      "source_snapshot_digest",
      "resource_digest",
      "created_at",
    ]) {
      expect(resourceTable).toContain(
        `new.${column} is distinct from old.${column}`,
      );
    }
    expect(resourceTable).toContain(
      "message = 'blurting_resource_content_immutable'",
    );
    expect(resourceTable).toContain([
      "if old.state = 'ready'",
      "    and new.state in ('superseded', 'retired') then",
    ].join("\n"));
    expect(resourceTable).toContain([
      "if old.state = 'superseded'",
      "    and new.state = 'retired'",
    ].join("\n"));
    expect(resourceTable).toContain(
      "message = 'blurting_resource_lifecycle_transition_invalid'",
    );
    expect(resourceTable).toContain([
      "create trigger blurting_resources_v18_guard_immutability",
      "before update on private.blurting_resources_v18",
    ].join("\n"));
  });

  it("uses private domain-separated SHA-256 digests and verifies them in row constraints", () => {
    for (const domain of [
      "yova.blurting.public.v18|",
      "yova.blurting.server.v18|",
      "yova.blurting.source_snapshot.v1|",
      "yova.blurting.source_chunk.v1|",
      "yova.blurting.resource.v18|",
      "yova.blurting.delivery_receipt.v18|",
      "yova.blurting.evaluation_request.v18|",
      "yova.blurting.evaluation_result.v18|",
    ]) {
      expect(migration).toContain(domain);
    }
    expect(migration.match(/extensions\.digest\(/gu)).toHaveLength(8);
    expect(migration.match(/'sha256'/gu)).toHaveLength(8);
    expect(digestHelpers.match(/private\.canonical_json_v1\(/gu))
      .toHaveLength(8);
    expect(canonicalJson).toContain("order by entry.key collate \"c\"");
    expect(canonicalJson).toContain("order by entry.ordinality");
    expect(canonicalJson).toContain("|| ':'");
    expect(resourceTable).toContain(
      "private.blurting_public_payload_digest_v18(public_payload)",
    );
    expect(resourceTable).toContain(
      "private.blurting_server_payload_digest_v18(\n        server_payload - 'canonicaldigests'",
    );
    expect(resourceTable).toContain(
      "private.blurting_source_snapshot_digest_v1(",
    );
    expect(resourceTable).toContain(
      "private.blurting_resource_digest_v18(",
    );
    expect(resourceTable).toContain(
      "'routeidentity', pg_catalog.jsonb_build_object(",
    );
    expect(resourceTable).toContain(
      "'resourcegeneratedat',\n          public_payload #>> '{identity,resourcegeneratedat}'",
    );
    expect(resourceTable).not.toContain("'learningitemid'");

    const pinnedDigest = createHash("sha256")
      .update("yova.blurting.source_chunk.v1|")
      .update(JSON.stringify('Blurting "A"\nB'))
      .digest("hex");
    expect(pinnedDigest).toBe(
      "86fd9b600999bd40b16fb5cdc84f34adcd344996a8ff5780369263273f6e8c2c",
    );
    expect(migration).toContain(pinnedDigest);
    expect(migration).toContain(
      "is distinct from '{\"a\":[\"x\",1],\"z\":2}'",
    );
    expect(migration).toContain(
      "message = 'blurting_canonical_digest_contract_changed'",
    );
  });

  it("makes delivery handles exact, bounded, expiring, stage-authorized, and cascading", () => {
    expect(deliveryTable).toContain([
      "unique (",
      "    user_id,",
      "    plan_session_id,",
      "    route_revision_id,",
      "    run_id,",
      "    activity_index",
    ].join("\n"));
    expect(deliveryTable).toContain([
      "references private.blurting_resources_v18(",
      "    id,",
      "    user_id,",
      "    plan_id,",
      "    plan_session_id,",
      "    route_revision_id,",
      "    public_payload_digest,",
      "    resource_digest",
      "  ) on delete cascade",
    ].join("\n"));
    expect(deliveryTable).toContain("activity_index between 0 and 23");
    expect(deliveryTable).toContain(
      "expires_at = issued_at + interval '192 hours'",
    );
    expect(migration).toContain(
      "every retention window below is an elapsed-time ttl",
    );
    expect(migration).toContain(
      "postgresql `days` use local-calendar",
    );
    expect(deliveryTable).toContain(
      "private.blurting_delivery_receipt_digest_v18(",
    );
    expect(deliveryTable).toContain(
      "'resourcedigest', pg_catalog.encode(\n          resource_digest",
    );
    expect(deliveryTable).toContain(
      "state in ('active', 'completed', 'revoked')",
    );
    for (const column of [
      "disclosure_stage text not null",
      "recall_disclosed_at timestamptz not null",
      "compare_disclosed_at timestamptz",
      "repair_disclosed_at timestamptz",
      "transfer_disclosed_at timestamptz",
      "complete_disclosed_at timestamptz",
    ]) {
      expect(deliveryTable).toContain(column);
    }
    expect(deliveryTable).not.toContain("comparison_disclosed_at");
    expect(deliveryTable).not.toContain("completed_disclosed_at");
    expect(deliveryTable).toContain(
      "disclosure_stage in ('recall', 'compare', 'repair', 'transfer', 'complete')",
    );
    expect(deliveryTable).toContain(
      "recall_disclosed_at >= issued_at\n    and recall_disclosed_at < expires_at",
    );
    expect(deliveryTable).toContain(
      "compare_disclosed_at >= recall_disclosed_at",
    );
    expect(deliveryTable).toContain(
      "repair_disclosed_at >= compare_disclosed_at",
    );
    expect(deliveryTable).toContain(
      "transfer_disclosed_at >= repair_disclosed_at",
    );
    expect(deliveryTable).toContain(
      "complete_disclosed_at >= transfer_disclosed_at",
    );
    expect(deliveryTable).toContain([
      "disclosure_stage = 'recall'",
      "        and compare_disclosed_at is null",
      "        and repair_disclosed_at is null",
      "        and transfer_disclosed_at is null",
      "        and complete_disclosed_at is null",
    ].join("\n"));
    expect(deliveryTable).toContain([
      "disclosure_stage = 'complete'",
      "        and compare_disclosed_at is not null",
      "        and repair_disclosed_at is not null",
      "        and transfer_disclosed_at is not null",
      "        and complete_disclosed_at is not null",
    ].join("\n"));
    expect(deliveryTable).toContain([
      "state = 'active'",
      "        and disclosure_stage in ('recall', 'compare', 'repair', 'transfer')",
      "        and closed_at is null",
    ].join("\n"));
    expect(deliveryTable).toContain([
      "state = 'completed'",
      "        and disclosure_stage = 'complete'",
      "        and closed_at is not distinct from complete_disclosed_at",
    ].join("\n"));
    expect(deliveryTable).toContain("state = 'revoked'");
    expect(deliveryTable.match(/\) is true\)/gu)).toHaveLength(5);
  });

  it("reserves only immutable, one-stage-at-a-time delivery transitions", () => {
    const insertGuardStart = deliveryTable.indexOf(
      "create or replace function private.guard_blurting_delivery_insert_v18()",
    );
    const guardStart = deliveryTable.indexOf(
      "create or replace function private.guard_blurting_delivery_transition_v18()",
    );
    expect(insertGuardStart).toBeGreaterThanOrEqual(0);
    expect(deliveryTable.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      insertGuardStart,
    )).toBeGreaterThan(insertGuardStart);
    const sessionLock = deliveryTable.indexOf(
      "from public.plan_sessions as session",
      insertGuardStart,
    );
    const routeLock = deliveryTable.indexOf(
      "from public.study_routes as route",
      sessionLock,
    );
    const resourceLock = deliveryTable.indexOf(
      "from private.blurting_resources_v18 as resource",
      routeLock,
    );
    expect(sessionLock).toBeGreaterThan(insertGuardStart);
    expect(routeLock).toBeGreaterThan(sessionLock);
    expect(resourceLock).toBeGreaterThan(routeLock);
    expect(deliveryTable).toContain(
      "committed_route_revision_id is distinct from new.route_revision_id",
    );
    expect(deliveryTable).toContain(
      "route_lifecycle is distinct from 'committed'",
    );
    expect(deliveryTable).toContain(
      "route_technique_id is distinct from 'blurting_v1'",
    );
    expect(deliveryTable).toContain(
      "resource_state is distinct from 'ready'",
    );
    expect(deliveryTable).toContain(
      "new.issued_at is distinct from pg_catalog.statement_timestamp()",
    );
    expect(deliveryTable).toContain(
      "new.recall_disclosed_at is distinct from new.issued_at",
    );
    expect(deliveryTable).toContain([
      "new.state is distinct from 'active'",
      "    or new.disclosure_stage is distinct from 'recall'",
      "    or new.compare_disclosed_at is not null",
      "    or new.repair_disclosed_at is not null",
      "    or new.transfer_disclosed_at is not null",
      "    or new.complete_disclosed_at is not null",
      "    or new.closed_at is not null",
      "    or new.last_seen_at is distinct from new.recall_disclosed_at",
    ].join("\n"));
    expect(deliveryTable).toContain(
      "message = 'blurting_delivery_initial_stage_invalid'",
    );
    expect(deliveryTable).toContain([
      "create trigger blurting_delivery_receipts_v18_guard_insert",
      "before insert on private.blurting_delivery_receipts_v18",
    ].join("\n"));
    const accountLock = deliveryTable.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      guardStart,
    );
    const immutableComparison = deliveryTable.indexOf(
      "if new.id is distinct from old.id",
      guardStart,
    );
    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(accountLock).toBeGreaterThan(guardStart);
    expect(immutableComparison).toBeGreaterThan(accountLock);
    for (const column of [
      "id",
      "resource_id",
      "user_id",
      "plan_id",
      "plan_session_id",
      "route_revision_id",
      "resource_public_digest",
      "resource_digest",
      "run_id",
      "activity_index",
      "receipt_digest",
      "issued_at",
      "expires_at",
    ]) {
      expect(deliveryTable).toContain(
        `new.${column} is distinct from old.${column}`,
      );
    }
    for (const timestamp of [
      "recall_disclosed_at",
      "compare_disclosed_at",
      "repair_disclosed_at",
      "transfer_disclosed_at",
      "complete_disclosed_at",
    ]) {
      expect(deliveryTable).toContain(`new.${timestamp} is distinct from old.${timestamp}`);
    }
    expect(deliveryTable).toContain(
      "message = 'blurting_delivery_identity_immutable'",
    );
    expect(deliveryTable).toContain(
      "message = 'blurting_delivery_disclosure_timestamp_immutable'",
    );
    expect(deliveryTable).toContain(
      "if old.state in ('completed', 'revoked') then",
    );
    expect(deliveryTable).toContain(
      "new.last_seen_at is distinct from old.last_seen_at",
    );
    expect(deliveryTable).toContain([
      "new.state = 'revoked'",
      "    and new.disclosure_stage is not distinct from old.disclosure_stage",
      "    and new.last_seen_at is not distinct from statement_at",
      "    and new.closed_at is not distinct from statement_at",
      "    and pg_catalog.clock_timestamp() < old.expires_at",
    ].join("\n"));
    const transitionSessionLock = deliveryTable.indexOf(
      "from public.plan_sessions as session",
      guardStart,
    );
    const transitionRouteLock = deliveryTable.indexOf(
      "from public.study_routes as route",
      transitionSessionLock,
    );
    const transitionResourceLock = deliveryTable.indexOf(
      "from private.blurting_resources_v18 as resource",
      transitionRouteLock,
    );
    expect(transitionSessionLock).toBeGreaterThan(guardStart);
    expect(transitionRouteLock).toBeGreaterThan(transitionSessionLock);
    expect(transitionResourceLock).toBeGreaterThan(transitionRouteLock);
    expect(deliveryTable).toContain(
      "checked_at := pg_catalog.clock_timestamp();",
    );
    expect(deliveryTable).toContain(
      "or checked_at >= old.expires_at",
    );
    expect(deliveryTable).toContain([
      "new.state = 'active'",
      "    and new.disclosure_stage is not distinct from old.disclosure_stage",
      "    and new.last_seen_at is not distinct from statement_at",
      "    and new.closed_at is null",
    ].join("\n"));
    expect(deliveryTable).toContain(
      "new_stage_index = old_stage_index + 1",
    );
    for (const [stage, timestamp] of [
      ["compare", "compare_disclosed_at"],
      ["repair", "repair_disclosed_at"],
      ["transfer", "transfer_disclosed_at"],
    ] as const) {
      expect(deliveryTable).toContain(
        `new.disclosure_stage = '${stage}'`,
      );
      expect(deliveryTable).toContain(
        `new.${timestamp} is not distinct from statement_at`,
      );
    }
    expect(deliveryTable).toContain(
      "old.disclosure_stage = 'transfer'",
    );
    expect(deliveryTable).toContain(
      "new.complete_disclosed_at is not distinct from statement_at",
    );
    expect(deliveryTable).toContain(
      "from private.blurting_evaluation_receipts_v18 as evaluation",
    );
    expect(deliveryTable).toContain(
      "evaluation_state in ('succeeded', 'unavailable')",
    );
    expect(deliveryTable).toContain(
      "-- the evaluation row lock may have blocked past either expiry.",
    );
    expect(deliveryTable.match(
      /checked_at := pg_catalog\.clock_timestamp\(\);/gu,
    )).toHaveLength(2);
    expect(deliveryTable).toContain(
      "and evaluation_completed_at >= old.transfer_disclosed_at\n      and evaluation_completed_at <= statement_at",
    );
    expect(deliveryTable).toContain(
      "and evaluation_completed_at < old.expires_at\n      and evaluation_completed_at < evaluation_expires_at\n      and checked_at < old.expires_at\n      and checked_at < evaluation_expires_at",
    );
    expect(deliveryTable).toContain(
      "message = 'blurting_delivery_evaluation_unavailable'",
    );
    expect(deliveryTable).toContain([
      "create trigger blurting_delivery_receipts_v18_guard_transition",
      "before update on private.blurting_delivery_receipts_v18",
    ].join("\n"));
  });

  it("stores only bounded evaluation commitments/results with exact delivery scope", () => {
    expect(evaluationTable).not.toContain("learner_answer");
    expect(evaluationTable).not.toContain("answer text");
    expect(evaluationTable).not.toContain("answer_commitment");
    expect(evaluationTable).toContain("answer_hmac bytea not null");
    expect(evaluationTable).toContain(
      "pg_catalog.octet_length(answer_hmac) = 32",
    );
    expect(evaluationTable).toContain("unique (delivery_receipt_id)");
    expect(evaluationTable).toContain("unique (user_id, request_token)");
    expect(evaluationTable).not.toContain(
      "unique (delivery_receipt_id, request_token)",
    );
    expect(evaluationTable).toContain([
      "references private.blurting_delivery_receipts_v18(",
      "    id,",
      "    resource_id,",
      "    user_id,",
      "    plan_id,",
      "    plan_session_id,",
      "    route_revision_id,",
      "    run_id,",
      "    activity_index",
      "  ) on delete cascade",
    ].join("\n"));
    expect(evaluationTable).toContain(
      "evaluator_version = 'blurting_target_evaluator_v1'",
    );
    expect(evaluationTable).toContain(
      "private.blurting_result_vector_valid_v18(result_vector)",
    );
    expect(evaluationTable).toContain(
      "private.blurting_result_vector_all_unverified_v18(result_vector)",
    );
    expect(migration).toContain(
      "create or replace function private.blurting_result_vector_matches_resource_v18(",
    );
    expect(migration).toContain(
      "ordered_targets := public_payload #> '{orderedtargets}'",
    );
    expect(migration).toContain(
      "target_entry ->> 'targetid'\n        is distinct from result_entry ->> 'targetid'",
    );
    expect(migration).toContain(
      "target_entry ->> 'evidenceid'\n        is distinct from result_entry ->> 'evidenceid'",
    );
    expect(evaluationTable).toContain(
      "pg_catalog.octet_length(result_vector::text) between 2 and 2048",
    );
    expect(evaluationTable).toContain(
      "expires_at = issued_at + interval '720 hours'",
    );
    expect(evaluationTable).toContain(
      "request_digest = private.blurting_evaluation_request_digest_v18(",
    );
    expect(evaluationTable).toContain(
      "result_digest = private.blurting_evaluation_result_digest_v18(",
    );
    for (const exactInput of [
      "'deliveryreceiptid', delivery_receipt_id::text",
      "'resourceid', resource_id::text",
      "'userid', user_id::text",
      "'routeidentity', pg_catalog.jsonb_build_object(",
      "'runid', run_id::text",
      "'activityindex', activity_index",
      "'requesttoken', request_token::text",
      "'answerhmac', pg_catalog.encode(answer_hmac, 'hex')",
      "'orderedresults', result_vector",
    ]) {
      expect(evaluationTable).toContain(exactInput);
    }
    expect(migration).toContain("yova.blurting.answer_hmac.v18|");
    expect(migration).toContain("a plain or unsalted answer hash");
    expect(migration).toContain("server-only key");
    expect(evaluationTable).toContain(
      "completed_at >= issued_at\n        and completed_at < expires_at",
    );
    expect(evaluationTable).not.toContain(
      "completed_at between issued_at and expires_at",
    );
  });

  it("starts evaluation only at a live transfer and makes resolution terminal", () => {
    const insertGuardStart = evaluationTable.indexOf(
      "create or replace function private.guard_blurting_evaluation_insert_v18()",
    );
    const sessionLock = evaluationTable.indexOf(
      "from public.plan_sessions as session",
      insertGuardStart,
    );
    const routeLock = evaluationTable.indexOf(
      "from public.study_routes as route",
      sessionLock,
    );
    const resourceLock = evaluationTable.indexOf(
      "from private.blurting_resources_v18 as resource",
      routeLock,
    );
    const deliveryLock = evaluationTable.indexOf(
      "from private.blurting_delivery_receipts_v18 as delivery",
      resourceLock,
    );
    expect(insertGuardStart).toBeGreaterThanOrEqual(0);
    expect(evaluationTable.indexOf(
      "pg_catalog.pg_advisory_xact_lock(",
      insertGuardStart,
    )).toBeGreaterThan(insertGuardStart);
    expect(sessionLock).toBeGreaterThan(insertGuardStart);
    expect(routeLock).toBeGreaterThan(sessionLock);
    expect(resourceLock).toBeGreaterThan(routeLock);
    expect(deliveryLock).toBeGreaterThan(resourceLock);
    expect(evaluationTable).toContain(
      "committed_route_revision_id is distinct from new.route_revision_id",
    );
    expect(evaluationTable).toContain(
      "route_lifecycle is distinct from 'committed'",
    );
    expect(evaluationTable).toContain(
      "route_technique_id is distinct from 'blurting_v1'",
    );
    expect(evaluationTable).toContain(
      "resource_state is distinct from 'ready'",
    );
    expect(evaluationTable).toContain([
      "delivery_state is distinct from 'active'",
      "    or delivery_stage is distinct from 'transfer'",
      "    or transfer_disclosed_at is null",
      "    or checked_at < transfer_disclosed_at",
      "    or checked_at < delivery_issued_at",
      "    or checked_at >= delivery_expires_at",
      "    or new.issued_at is distinct from pg_catalog.statement_timestamp()",
      "    or new.issued_at < transfer_disclosed_at",
      "    or new.issued_at < delivery_issued_at",
      "    or new.issued_at >= delivery_expires_at",
    ].join("\n"));
    expect(evaluationTable).toContain([
      "new.state is distinct from 'pending'",
      "    or new.result_vector is not null",
      "    or new.result_digest is not null",
      "    or new.completed_at is not null",
      "    or new.leased_until is null",
    ].join("\n"));
    expect(evaluationTable).toContain([
      "create trigger blurting_evaluation_receipts_v18_guard_insert",
      "before insert on private.blurting_evaluation_receipts_v18",
    ].join("\n"));

    const transitionStart = evaluationTable.indexOf(
      "create or replace function private.guard_blurting_evaluation_transition_v18()",
    );
    expect(transitionStart).toBeGreaterThan(deliveryLock);
    for (const column of [
      "id",
      "delivery_receipt_id",
      "resource_id",
      "user_id",
      "plan_id",
      "plan_session_id",
      "route_revision_id",
      "run_id",
      "activity_index",
      "request_token",
      "answer_hmac",
      "evaluator_version",
      "request_digest",
      "issued_at",
      "expires_at",
    ]) {
      expect(evaluationTable).toContain(
        `new.${column} is distinct from old.${column}`,
      );
    }
    expect(evaluationTable).toContain(
      "old.state = 'pending' and new.state = 'pending'",
    );
    const transitionSessionLock = evaluationTable.indexOf(
      "from public.plan_sessions as session",
      transitionStart,
    );
    const transitionRouteLock = evaluationTable.indexOf(
      "from public.study_routes as route",
      transitionSessionLock,
    );
    const transitionResourceLock = evaluationTable.indexOf(
      "from private.blurting_resources_v18 as resource",
      transitionRouteLock,
    );
    const transitionDeliveryLock = evaluationTable.indexOf(
      "from private.blurting_delivery_receipts_v18 as delivery",
      transitionResourceLock,
    );
    expect(transitionSessionLock).toBeGreaterThan(transitionStart);
    expect(transitionRouteLock).toBeGreaterThan(transitionSessionLock);
    expect(transitionResourceLock).toBeGreaterThan(transitionRouteLock);
    expect(transitionDeliveryLock).toBeGreaterThan(transitionResourceLock);
    expect(evaluationTable).toContain(
      "old.leased_until is null or checked_at >= old.leased_until",
    );
    expect(evaluationTable).toContain(
      "message = 'blurting_evaluation_lease_expired'",
    );
    expect(evaluationTable).toContain(
      "recovery requires a later\n    -- fenced-writer migration",
    );
    expect(evaluationTable).toContain(
      "and new.state in ('succeeded', 'unavailable', 'failed')",
    );
    expect(evaluationTable).toContain([
      "new.leased_until is not null",
      "      or new.completed_at is null",
      "      or new.completed_at < transfer_disclosed_at",
      "      or new.completed_at < pg_catalog.statement_timestamp()",
      "      or new.completed_at > checked_at",
      "      or new.completed_at >= old.leased_until",
      "      or new.completed_at >= delivery_expires_at",
    ].join("\n"));
    expect(evaluationTable).toContain([
      "private.blurting_result_vector_matches_resource_v18(",
      "        new.result_vector,",
      "        resource_public_payload",
    ].join("\n"));
    expect(evaluationTable).toContain(
      "message = 'blurting_evaluation_target_binding_mismatch'",
    );
    expect(evaluationTable).toContain(
      "old.state in ('succeeded', 'unavailable', 'failed')",
    );
    expect(evaluationTable).toContain(
      "message = 'blurting_evaluation_terminal_state_immutable'",
    );
    expect(evaluationTable).toContain([
      "create trigger blurting_evaluation_receipts_v18_guard_transition",
      "before update on private.blurting_evaluation_receipts_v18",
    ].join("\n"));
  });

  it("enables RLS with zero direct grants on every private table and helper", () => {
    expect(migration.match(
      /constraint blurting_(?:resources|delivery_receipts|evaluation_receipts)_v18_[a-z0-9_]+_check check \(\(/gu,
    )).toHaveLength(17);
    expect(migration.match(/^  \) is true\)[,]?$/gmu)).toHaveLength(17);
    expect(migration.match(/alter table private\.[a-z0-9_]+ enable row level security;/gu))
      .toHaveLength(3);
    expect(migration.match(/revoke all on table private\.[a-z0-9_]+/gu))
      .toHaveLength(3);
    expect(migration).not.toMatch(
      /grant\s+(select|insert|update|delete|all)\s+on\s+(table\s+)?private\./u,
    );
    expect(migration).not.toMatch(/create policy\s+/u);

    const privateFunctions = migration.match(
      /create or replace function private\.[a-z0-9_]+\(/gu,
    ) ?? [];
    expect(privateFunctions).toHaveLength(23);
    expect(migration.match(/set search_path = ''/gu)).toHaveLength(25);
    expect(migration.match(/revoke all on function private\./gu)).toHaveLength(23);
  });

  it("adds no mint, writer, delivery/evaluation RPC, public read, generic cache mutation, or app gate change", () => {
    expect(migration).not.toMatch(/\binsert\s+into\b/u);
    expect(migration).not.toMatch(/\bupdate\s+(public|private)\./u);
    expect(migration).not.toContain("set step_data");
    expect(migration).not.toContain("cache_generated_session(");
    expect(migration).not.toContain("mint_blurting");
    expect(migration).not.toContain("save_blurting");
    expect(migration).not.toContain("deliver_blurting");
    expect(migration).not.toContain("evaluate_blurting");
    expect(migration.match(/create or replace function public\./gu)).toHaveLength(2);
  });

  it("exposes only deletion-only service cleanup in parent-to-child lock order", () => {
    expect(cleanup).toContain("auth.role() is distinct from 'service_role'");
    expect(cleanup).toContain("for update skip locked");
    const evaluationDelete = cleanup.indexOf(
      "delete from private.blurting_evaluation_receipts_v18",
    );
    const deliveryDelete = cleanup.indexOf(
      "delete from private.blurting_delivery_receipts_v18",
    );
    const resourceDelete = cleanup.indexOf(
      "delete from private.blurting_resources_v18",
    );
    expect(resourceDelete).toBeGreaterThanOrEqual(0);
    expect(deliveryDelete).toBeGreaterThan(resourceDelete);
    expect(evaluationDelete).toBeGreaterThan(deliveryDelete);
    expect(migration).toContain(
      "lock candidates in the same parent-to-child order",
    );
    expect(migration).toContain(
      "orphaned during this call is intentionally collected by the next call",
    );
    expect(cleanup).not.toMatch(/\binsert\s+into\b/u);
    expect(cleanup).not.toMatch(/\bupdate\s+(public|private)\./u);
    expect(migration).toContain([
      "revoke all on function public.cleanup_blurting_resource_store_v18(integer)",
      "from public, anon, authenticated, service_role;",
      "grant execute on function public.cleanup_blurting_resource_store_v18(integer)",
      "to service_role;",
    ].join("\n"));
  });

  it("wraps Reset under the account lock and relies on receipt cascades", () => {
    expect(migration).toContain([
      "alter function public.reset_yova_learning_data()",
      "rename to reset_yova_learning_data_without_blurting_resource_store_v18;",
    ].join("\n"));
    const advisory = reset.indexOf("pg_advisory_xact_lock");
    const resourceDelete = reset.indexOf(
      "delete from private.blurting_resources_v18",
    );
    const delegate = reset.indexOf(
      "public.reset_yova_learning_data_without_blurting_resource_store_v18()",
      resourceDelete,
    );
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(resourceDelete).toBeGreaterThan(advisory);
    expect(delegate).toBeGreaterThan(resourceDelete);
    expect(reset).not.toContain(
      "delete from private.blurting_delivery_receipts_v18",
    );
    expect(reset).not.toContain(
      "delete from private.blurting_evaluation_receipts_v18",
    );
    expect(migration).toContain([
      "revoke all on function public.reset_yova_learning_data()",
      "from public, anon, authenticated, service_role;",
      "grant execute on function public.reset_yova_learning_data()",
      "to authenticated;",
    ].join("\n"));
  });
});

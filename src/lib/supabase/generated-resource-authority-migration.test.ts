import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608240005_generated_resource_authority.sql",
), "utf8").toLocaleLowerCase();
const generationRoute = readFileSync(resolve(
  process.cwd(),
  "src/app/api/sessions/generate/route.ts",
), "utf8");

function section(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

const broadDetector = section(
  "create or replace function public.generated_session_has_broad_recall_v1(",
  "create table public.generated_resource_authority_permits",
);
const triggerGuard = section(
  "create or replace function public.guard_generated_resource_authority_v1()",
  "create or replace function public.cleanup_generated_resource_authority_permits_v1(",
);
const ordinaryWriter = section(
  "create or replace function public.cache_generated_session(payload jsonb)",
  "comment on function public.cache_generated_session(jsonb)",
);

describe("generated-resource authority compatibility migration", () => {
  it("locks the mature cache dependencies and refuses an unexpected delegate or existing broad resource", () => {
    const lock = migration.indexOf("lock table\n  public.plans,");
    const delegatePreflight = migration.indexOf(
      "message = 'generated_resource_cache_delegate_preflight_failed'",
    );
    const cohortPreflight = migration.indexOf(
      "message = 'generated_resource_authority_preflight_failed'",
    );
    const table = migration.indexOf(
      "create table public.generated_resource_authority_permits",
    );

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(migration.slice(lock, delegatePreflight)).toContain([
      "public.plans,",
      "  public.learning_items,",
      "  public.plan_sessions,",
      "  public.study_routes",
      "in share row exclusive mode;",
    ].join("\n"));
    expect(delegatePreflight).toBeGreaterThan(lock);
    expect(cohortPreflight).toBeGreaterThan(delegatePreflight);
    expect(table).toBeGreaterThan(cohortPreflight);
    expect(migration).toContain("pg_get_functiondef(");
    expect(migration).toContain(
      "'public.cache_generated_session(jsonb)'::pg_catalog.regprocedure",
    );
    expect(migration).toContain(
      "stored_generated_session is not distinct from requested_generated_session",
    );
    expect(migration.slice(lock, table)).toContain("'blurting_v1'");
    expect(migration.slice(lock, table)).toContain(
      "public.generated_session_has_broad_recall_v1(",
    );
  });

  it("recognizes both legacy broad signals and the isolated V18 candidate for rejection", () => {
    expect(broadDetector).toContain(
      "generated_session ->> 'schemaversion' = '18'",
    );
    expect(broadDetector).toContain("'disabled_schema_only'");
    expect(broadDetector).toContain(
      "'{deliveryidentity,visiblesupportingtechniqueid}'",
    );
    expect(broadDetector).toContain("generated_session -> 'orderedtargets'");
    expect(broadDetector).toContain("generated_session -> 'phaseenvelopes'");
    expect(broadDetector).toContain("'{methodruntime,format}'");
    expect(broadDetector).toContain("'{methodruntime,targetbindings}'");
    expect(broadDetector).toContain("'{runtime,format}'");
    expect(broadDetector).toContain("'{runtime,targetbindings}'");
  });

  it("keeps only a zero-access, zero-mint private schema reservation", () => {
    const table = section(
      "create table public.generated_resource_authority_permits",
      "create or replace function public.generated_resource_digest_v1(",
    );
    for (const identity of [
      "user_id uuid not null",
      "plan_id uuid not null",
      "learning_item_id uuid not null",
      "plan_session_id uuid not null",
      "route_revision_id uuid not null",
      "resource_generated_at timestamptz not null",
      "generated_resource_digest bytea not null",
    ]) {
      expect(table).toContain(identity);
    }
    expect(table).toContain("references auth.users(id) on delete cascade");
    expect(table).toContain("references public.study_routes(route_revision_id)\n    on delete cascade");
    expect(table).toContain("references public.plans(id, user_id) on delete cascade");
    expect(table).toContain(
      "references public.learning_items(id, user_id) on delete cascade",
    );
    expect(table).toContain(
      "references public.plan_sessions(id, plan_id, user_id) on delete cascade",
    );
    expect(table).toContain("pg_catalog.octet_length(generated_resource_digest) = 32");
    expect(table).toContain("expires_at = issued_at + interval '5 minutes'");
    expect(table).toContain(
      "alter table public.generated_resource_authority_permits enable row level security",
    );
    expect(table).toContain([
      "revoke all on table public.generated_resource_authority_permits",
      "from public, anon, authenticated, service_role;",
    ].join("\n"));
    expect(migration).not.toContain(
      "insert into public.generated_resource_authority_permits",
    );
    expect(migration).not.toContain(
      "grant select on table public.generated_resource_authority_permits",
    );
    expect(migration).not.toContain(
      "grant insert on table public.generated_resource_authority_permits",
    );
  });

  it("reserves a private canonical digest without presenting it as authority", () => {
    const digest = section(
      "create or replace function public.generated_resource_digest_v1(",
      "create or replace function public.guard_generated_resource_authority_v1()",
    );
    expect(digest).toContain("language sql\nimmutable\nstrict\nsecurity definer");
    expect(digest).toContain("set search_path = ''");
    expect(digest).toContain("'yova.generated_resource_reservation.v1|'");
    expect(digest).toContain("generated_resource::text");
    expect(digest).toContain("extensions.digest(");
    expect(digest).toContain("'sha256'");
    expect(digest).toContain([
      "revoke all on function public.generated_resource_digest_v1(jsonb)",
      "from public, anon, authenticated, service_role;",
    ].join("\n"));
  });

  it("unconditionally rejects broad storage and every non-null resource under active Blurting", () => {
    expect(triggerGuard).toContain(
      "public.generated_session_has_broad_recall_v1(generated_session)",
    );
    expect(triggerGuard).toContain(
      "#>> '{approach,visiblesupportingtechniqueid}' = 'blurting_v1'",
    );
    expect(triggerGuard).toContain("if has_broad_signal or active_blurting_route then");
    expect(triggerGuard).toContain(
      "message = 'generated_resource_authority_unavailable'",
    );
    expect(triggerGuard).toContain("route_pointer_changed boolean");
    expect(triggerGuard).toContain(
      "before insert or update of step_data, committed_route_revision_id\non public.plan_sessions",
    );
    expect(triggerGuard).not.toContain("current_setting(");
    expect(triggerGuard).not.toContain("permit_matches");
  });

  it("exposes deletion-only cleanup and clears the reservation on Reset or cascade", () => {
    expect(migration).toContain([
      "revoke all on function public.cleanup_generated_resource_authority_permits_v1(integer)",
      "from public, anon, authenticated, service_role;",
      "grant execute on function public.cleanup_generated_resource_authority_permits_v1(integer)",
      "to service_role;",
    ].join("\n"));
    expect(migration).toContain([
      "alter function public.reset_yova_learning_data()",
      "rename to reset_yova_learning_data_without_generated_resource_reservation_v1;",
    ].join("\n"));
    const reset = section(
      "create or replace function public.reset_yova_learning_data()",
      "alter function public.cache_generated_session(jsonb)",
    );
    const advisory = reset.indexOf("pg_advisory_xact_lock");
    const deletion = reset.indexOf(
      "delete from public.generated_resource_authority_permits",
    );
    const delegate = reset.indexOf(
      "reset_yova_learning_data_without_generated_resource_reservation_v1()",
      deletion,
    );
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(deletion).toBeGreaterThan(advisory);
    expect(delegate).toBeGreaterThan(deletion);
  });

  it("creates no mint, GUC, consumable writer, or authenticated two-argument overload", () => {
    expect(migration).not.toContain("mint_generated_resource_authority");
    expect(migration).not.toContain("current_generated_resource_permit_matches");
    expect(migration).not.toContain("generated_resource_authority_permit_id");
    expect(migration).not.toContain("pg_catalog.set_config(");
    expect(migration).not.toContain("pg_catalog.current_setting(");
    expect(migration).not.toContain(
      "create or replace function public.cache_generated_session(\n  payload jsonb,",
    );
    expect(migration).not.toContain(
      "grant execute on function public.cache_generated_session(jsonb, uuid)",
    );
    expect(migration).not.toContain(
      "update public.generated_resource_authority_permits",
    );
  });

  it("retains the original ordinary RPC and delegates only after reserved-route containment", () => {
    expect(migration).toContain([
      "alter function public.cache_generated_session(jsonb)",
      "rename to cache_generated_session_without_generated_resource_authority_v1;",
    ].join("\n"));
    expect(migration).toContain([
      "revoke all on function public.cache_generated_session_without_generated_resource_authority_v1(jsonb)",
      "from public, anon, authenticated, service_role;",
    ].join("\n"));
    expect(ordinaryWriter).toContain(
      "public.generated_session_has_broad_recall_v1(generated_session)",
    );
    expect(ordinaryWriter).toContain(
      "#>> '{approach,visiblesupportingtechniqueid}' = 'blurting_v1'",
    );
    expect(ordinaryWriter).toContain(
      "message = 'generated_resource_authority_unavailable'",
    );
    expect(ordinaryWriter).toContain(
      "perform public.cache_generated_session_without_generated_resource_authority_v1(\n    payload",
    );
    expect(migration).toContain([
      "revoke all on function public.cache_generated_session(jsonb)",
      "from public, anon, authenticated, service_role;",
      "grant execute on function public.cache_generated_session(jsonb)",
      "to authenticated;",
    ].join("\n"));
  });

  it("preserves malformed ordinary parse-before-lock behavior", () => {
    const parse = ordinaryWriter.indexOf("begin\n    requested_session_id :=");
    const structuralFailure = ordinaryWriter.indexOf(
      "if requested_session_id is null",
      parse,
    );
    const advisory = ordinaryWriter.indexOf("pg_advisory_xact_lock", parse);
    expect(parse).toBeGreaterThanOrEqual(0);
    expect(structuralFailure).toBeGreaterThan(parse);
    expect(advisory).toBeGreaterThan(structuralFailure);
    expect(ordinaryWriter.slice(parse, advisory)).toContain(
      "cache_generated_session_without_generated_resource_authority_v1",
    );
  });

  it("keeps every helper pinned/private and reloads only the ordinary PostgREST signature", () => {
    expect(migration.match(/create or replace function public\./gu)).toHaveLength(6);
    expect(migration.match(/set search_path = ''/gu)).toHaveLength(6);
    expect(migration).not.toContain(
      "grant execute on function public.generated_session_has_broad_recall_v1",
    );
    expect(migration).not.toContain(
      "grant execute on function public.guard_generated_resource_authority_v1",
    );
    expect(migration).not.toContain(
      "grant execute on function public.generated_resource_digest_v1",
    );
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });

  it("keeps application issuance disabled and the early Blurting generation gate intact", () => {
    expect(generationRoute).toContain("blurtingRuntimeUnavailableResponse(requestId)");
    expect(generationRoute).toContain("code: \"blurting_runtime_unavailable\"");
    expect(generationRoute).not.toContain("mint_generated_resource_authority_permit_v1");
    expect(generationRoute).not.toContain("generated_resource_authority_permit_id");
  });
});

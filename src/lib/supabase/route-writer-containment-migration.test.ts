import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readMigration("202608230008_route_writer_containment.sql");

const durationAdjustment = functionBody(
  "adjust_plan_session_duration",
  "set_plan_session_learning_mode",
);
const learningModeAdjustment = functionBody(
  "set_plan_session_learning_mode",
  "attach_materials_to_plan",
);
const materialAttachment = functionBody("attach_materials_to_plan");

describe("StudyRoute writer containment migration", () => {
  it("closes direct authenticated inserts, deletes, and every retained scalar update grant", () => {
    expect(migration).toContain(
      "revoke insert, delete, update on table public.plan_sessions\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke update (\n  sequence,\n  title,\n  objective,\n  method,\n  method_rationale,\n  estimated_minutes,\n  status,\n  step_data\n) on table public.plan_sessions\nfrom public, anon, authenticated",
    );
    expect(migration).not.toContain("revoke select on table public.plan_sessions");
    expect(migration).not.toContain("revoke all on table public.plan_sessions");
  });

  it("keeps supported ownership-checked RPCs working after the table ACL cutover", () => {
    for (const signature of [
      "save_generated_plan_with_routes(jsonb)",
      "cache_generated_session(jsonb)",
      "save_learner_profile(jsonb)",
      "delete_active_session_checkpoint(uuid, uuid)",
    ]) {
      expect(migration).toContain(
        `alter function public.${signature} security definer`,
      );
      expect(migration).toContain(
        `grant execute on function public.${signature}\nto authenticated`,
      );
    }

    expect(migration).toContain(
      "revoke all on function public.save_generated_plan(jsonb)\nfrom public, anon, authenticated",
    );

    const establishedWriters = [
      [
        "202608230002_atomic_plan_study_routes.sql",
        "save_generated_plan_with_routes",
      ],
      [
        "202608210002_reconcile_active_plan_material_attachments.sql",
        "cache_generated_session",
      ],
      [
        "202608170002_account_bound_learner_profile_save.sql",
        "save_learner_profile",
      ],
      [
        "202608170001_cloud_active_session_checkpoints.sql",
        "delete_active_session_checkpoint",
      ],
    ] as const;

    for (const [migrationName, functionName] of establishedWriters) {
      const establishedBody = bodyFromMigration(
        readMigration(migrationName),
        functionName,
      );
      expect(establishedBody, functionName).toContain("set search_path = ''");
      expect(establishedBody, functionName).toContain("auth.uid()");
    }
  });

  it("lets only null-pointer legacy sessions use single-session duration changes", () => {
    expect(migration).toContain(
      "rename to adjust_plan_session_duration_without_study_routes",
    );
    expect(migration).toContain(
      "revoke all on function public.adjust_plan_session_duration_without_study_routes(jsonb)\nfrom public, anon, authenticated",
    );
    expect(durationAdjustment).toContain("security definer\nset search_path = ''");

    const routeLock = durationAdjustment.indexOf(
      "public.lock_study_route_binding_v2(\n    requested_session_id,\n    null,\n    false",
    );
    const legacyDelegate = durationAdjustment.indexOf(
      "public.adjust_plan_session_duration_without_study_routes(payload)",
    );
    expect(routeLock).toBeGreaterThan(0);
    expect(legacyDelegate).toBeGreaterThan(routeLock);
  });

  it("lets only null-pointer legacy sessions change learning mode in place", () => {
    expect(migration).toContain(
      "rename to set_plan_session_learning_mode_without_study_routes",
    );
    expect(migration).toContain(
      "revoke all on function public.set_plan_session_learning_mode_without_study_routes(uuid, text)\nfrom public, anon, authenticated",
    );
    expect(learningModeAdjustment).toContain("security definer\nset search_path = ''");

    const routeLock = learningModeAdjustment.indexOf(
      "public.lock_study_route_binding_v2(\n    requested_session_id,\n    null,\n    false",
    );
    const legacyDelegate = learningModeAdjustment.indexOf(
      "public.set_plan_session_learning_mode_without_study_routes(",
    );
    expect(routeLock).toBeGreaterThan(0);
    expect(legacyDelegate).toBeGreaterThan(routeLock);
  });

  it("fails material attachment closed for routed plans after canonical locking", () => {
    expect(materialAttachment).toContain("security definer\nset search_path = ''");
    const accountLock = materialAttachment.indexOf("pg_advisory_xact_lock");
    const planLock = materialAttachment.indexOf("from public.plans as plan");
    const sessionLocks = materialAttachment.indexOf(
      "order by session.sequence, session.id\n  for update",
    );
    const routeCount = materialAttachment.indexOf(
      "session.committed_route_revision_id is not null",
    );
    const rejection = materialAttachment.indexOf(
      "material_attachment_route_update_required",
    );
    const legacyDelegate = materialAttachment.indexOf(
      "public.attach_materials_to_plan_without_study_routes(payload)",
    );

    expect(planLock).toBeGreaterThan(accountLock);
    expect(sessionLocks).toBeGreaterThan(planLock);
    expect(routeCount).toBeGreaterThan(sessionLocks);
    expect(rejection).toBeGreaterThan(routeCount);
    expect(legacyDelegate).toBeGreaterThan(rejection);
    expect(migration).toContain(
      "revoke all on function public.attach_materials_to_plan_without_study_routes(jsonb)\nfrom public, anon, authenticated",
    );
  });

  it("does not narrow the route-aware writers or authorized parent cascades", () => {
    for (const routeWriter of [
      "save_active_session_checkpoint_with_route",
      "complete_plan_session_with_route",
      "record_session_interruption_with_route",
      "activate_concept_review_with_route",
      "adjust_learning_plan_with_routes",
    ]) {
      expect(migration).not.toContain(`revoke all on function public.${routeWriter}`);
    }
    expect(migration).not.toContain("revoke delete on table public.plans");
    expect(migration).not.toContain("revoke delete on table public.learning_items");

    for (const [migrationName, functionName] of [
      ["202608180004_delete_archived_learning_plans.sql", "delete_archived_learning_plan"],
      ["202608210007_late_upload_cleanup_receipts.sql", "reset_yova_learning_data"],
      ["202608210007_late_upload_cleanup_receipts.sql", "delete_yova_account"],
    ] as const) {
      expect(
        bodyFromMigration(readMigration(migrationName), functionName),
        functionName,
      ).toContain("security definer");
    }
  });
});

function readMigration(name: string) {
  return readFileSync(resolve(migrationsDirectory, name), "utf8").toLocaleLowerCase();
}

function functionBody(name: string, nextName?: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start + 1)
    : migration.length;
  return migration.slice(start, end);
}

function bodyFromMigration(source: string, name: string) {
  const start = source.lastIndexOf(`create or replace function public.${name}`);
  const end = source.indexOf("$$;", start) + 3;
  return source.slice(start, end);
}

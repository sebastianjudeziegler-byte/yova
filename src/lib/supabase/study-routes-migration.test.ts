import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608230001_study_routes.sql";
const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(
  resolve(migrationsDirectory, migrationName),
  "utf8",
);

const immutabilityGuard = migration.slice(
  migration.indexOf("create or replace function public.guard_study_route_immutability()"),
  migration.indexOf("create trigger study_routes_guard_immutability"),
);
const commitFunction = migration.slice(
  migration.indexOf("create or replace function public.commit_study_route_revision(payload jsonb)"),
  migration.indexOf("revoke all on function public.guard_study_route_immutability()"),
);

describe("StudyRoute persistence migration", () => {
  it("creates the version-one immutable revision vocabulary with bounded JSON", () => {
    expect(migration).toContain("create table public.study_routes (");
    for (const field of [
      "route_revision_id uuid primary key",
      "route_lineage_id uuid not null",
      "revision_number integer not null",
      "schema_version smallint not null default 1",
      "lifecycle text not null",
      "user_id uuid not null",
      "plan_id uuid not null",
      "plan_session_id uuid not null",
      "predecessor_revision_id uuid",
      "route_payload jsonb not null",
      "route_fingerprint text not null",
      "created_at timestamptz not null",
      "committed_at timestamptz",
    ]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("check (schema_version = 1)");
    expect(migration).toContain(
      "check (lifecycle in ('provisional', 'committed', 'superseded'))",
    );
    expect(migration).toContain("jsonb_typeof(route_payload) = 'object'");
    expect(migration).toContain(
      "octet_length(route_payload::text) between 2 and 262144",
    );
    expect(migration).toContain("check (route_fingerprint ~ '^sr1:[0-9a-f]{64}$')");
  });

  it("enforces owner, plan, session, and predecessor scope with recoverable deletes", () => {
    expect(migration).toContain(
      "unique (id, plan_id, user_id)",
    );
    expect(migration).toContain(
      "foreign key (plan_id, user_id)\n    references public.plans(id, user_id)\n    on delete cascade",
    );
    expect(migration).toContain(
      "foreign key (plan_session_id, plan_id, user_id)\n    references public.plan_sessions(id, plan_id, user_id)\n    on delete cascade",
    );
    expect(migration).toContain("constraint study_routes_predecessor_scope_fk");
    expect(migration).toMatch(
      /foreign key \(\s*predecessor_revision_id,\s*route_lineage_id,\s*plan_session_id,\s*plan_id,\s*user_id\s*\)[\s\S]*references public\.study_routes\([\s\S]*route_revision_id,[\s\S]*route_lineage_id,[\s\S]*plan_session_id,[\s\S]*plan_id,[\s\S]*user_id[\s\S]*\)\s*on delete cascade/,
    );
    expect(migration).toContain(
      "on delete no action\ndeferrable initially deferred",
    );
    expect(migration).not.toContain(
      "on delete set null (committed_route_revision_id)",
    );
  });

  it("allows one committed revision and binds the nullable pointer to its own session", () => {
    expect(migration).toContain(
      "unique (route_lineage_id, revision_number)",
    );
    expect(migration).toContain(
      "create unique index study_routes_one_committed_per_session_idx\non public.study_routes(plan_session_id)\nwhere lifecycle = 'committed'",
    );
    expect(migration).toContain(
      "add column committed_route_revision_id uuid",
    );
    expect(migration).toMatch(
      /foreign key \(committed_route_revision_id, id, plan_id, user_id\)\s*references public\.study_routes\(\s*route_revision_id,\s*plan_session_id,\s*plan_id,\s*user_id\s*\)/,
    );
  });

  it("exposes owner reads while revoking every direct authenticated write", () => {
    expect(migration).toContain(
      "alter table public.study_routes enable row level security",
    );
    expect(migration).toContain(
      'create policy "study_routes_owner_select" on public.study_routes\nfor select to authenticated\nusing ((select auth.uid()) = user_id)',
    );
    expect(migration).toContain(
      "revoke all on table public.study_routes from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant select on table public.study_routes to authenticated",
    );
    expect(migration).toContain(
      "revoke all on function public.commit_study_route_revision(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.commit_study_route_revision(jsonb)\nto authenticated",
    );
    expect(migration).not.toContain(
      "grant execute on function public.commit_study_route_revision(jsonb) to anon",
    );
  });

  it("makes identity and payload immutable and permits only forward lifecycle transitions", () => {
    expect(immutabilityGuard).toContain("security definer\nset search_path = ''");
    expect(immutabilityGuard).toContain(
      "pg_catalog.current_setting(\n    'yova.study_route_lifecycle_revision'",
    );
    expect(immutabilityGuard).toContain("message = 'study_route_rpc_required'");
    for (const field of [
      "route_revision_id",
      "route_lineage_id",
      "revision_number",
      "schema_version",
      "user_id",
      "plan_id",
      "plan_session_id",
      "predecessor_revision_id",
      "route_payload",
      "route_fingerprint",
      "created_at",
    ]) {
      expect(immutabilityGuard).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
    expect(immutabilityGuard).toContain(
      "old.lifecycle = 'provisional'\n    and new.lifecycle = 'committed'",
    );
    expect(immutabilityGuard).toContain(
      "old.lifecycle = 'committed'\n    and new.lifecycle = 'superseded'",
    );
    expect(immutabilityGuard).toContain(
      "message = 'study_route_lifecycle_transition_invalid'",
    );
  });

  it("accepts the strict TypeScript route envelope and derives its fingerprint in code", () => {
    expect(commitFunction).toContain("security definer\nset search_path = ''");
    expect(commitFunction).toContain("from jsonb_object_keys(payload)");
    expect(commitFunction).toContain("from jsonb_object_keys(requested_identity)");
    for (const field of [
      "routeLineageId",
      "routeRevisionId",
      "revisionNumber",
      "schemaVersion",
      "lifecycleStatus",
      "planId",
      "sessionId",
      "createdAt",
      "committedAt",
      "supersedesRevisionId",
    ]) {
      expect(commitFunction).toContain(`'${field}'`);
    }
    expect(commitFunction).toContain(
      "requested_identity -> 'schemaVersion' is distinct from '1'::jsonb",
    );
    expect(commitFunction).toContain(
      "requested_identity ->> 'lifecycleStatus' is distinct from 'committed'",
    );
    expect(commitFunction).toContain(
      "requested_route_payload := payload - 'identity'",
    );
    expect(commitFunction).toContain("extensions.digest(");
    expect(commitFunction).toContain("'sha256'");
  });

  it("authenticates and serializes the plan/session invariant set before writing", () => {
    expect(commitFunction).toContain("current_user_id uuid := auth.uid()");
    expect(commitFunction).toContain("message = 'study_route_authentication_required'");

    const advisoryLock = commitFunction.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const planLock = commitFunction.indexOf("from public.plans as plan");
    const sessionLock = commitFunction.indexOf("from public.plan_sessions as session");
    const firstWrite = commitFunction.indexOf("update public.study_routes");

    expect(advisoryLock).toBeGreaterThan(-1);
    expect(advisoryLock).toBeLessThan(planLock);
    expect(planLock).toBeLessThan(sessionLock);
    expect(sessionLock).toBeLessThan(firstWrite);
    expect(commitFunction.slice(planLock, sessionLock)).toContain("for update;");
    expect(commitFunction.slice(sessionLock, firstWrite)).toContain("for update;");
  });

  it("requires a direct same-lineage predecessor and rejects route switches under active work", () => {
    expect(commitFunction).toContain(
      "route.route_revision_id = requested_predecessor_revision_id",
    );
    expect(commitFunction).toContain(
      "route.route_lineage_id = requested_route_lineage_id",
    );
    expect(commitFunction).toContain(
      "route.plan_session_id = requested_session.id",
    );
    expect(commitFunction).toContain(
      "route.plan_id = requested_plan.id",
    );
    expect(commitFunction).toContain(
      "route.user_id = current_user_id",
    );
    expect(commitFunction).toContain(
      "predecessor_route.revision_number + 1 <> requested_revision_number",
    );
    expect(commitFunction).toContain(
      "requested_session.committed_route_revision_id\n        is distinct from predecessor_route.route_revision_id",
    );
    expect(commitFunction).toContain(
      "requested_session.step_data ? 'activeSessionCheckpoint'",
    );
    expect(commitFunction).toContain("message = 'study_route_active_checkpoint'");
  });

  it("returns exact same-ID/fingerprint retries without mutating active work", () => {
    const fingerprintComparison = commitFunction.indexOf(
      "existing_route.route_fingerprint is distinct from requested_route_fingerprint",
    );
    const idempotentReturn = commitFunction.indexOf(
      "'routeFingerprint', existing_route.route_fingerprint",
    );
    const checkpointGuard = commitFunction.indexOf(
      "requested_session.step_data ? 'activeSessionCheckpoint'",
    );
    const terminalGuard = commitFunction.indexOf(
      "requested_session.status not in ('ready', 'upcoming')",
    );
    const inactivePlanGuard = commitFunction.indexOf(
      "requested_plan.status <> 'active'",
    );

    expect(fingerprintComparison).toBeGreaterThan(-1);
    expect(idempotentReturn).toBeGreaterThan(fingerprintComparison);
    expect(idempotentReturn).toBeLessThan(inactivePlanGuard);
    expect(idempotentReturn).toBeLessThan(terminalGuard);
    expect(idempotentReturn).toBeLessThan(checkpointGuard);
    expect(commitFunction).toContain("message = 'study_route_revision_conflict'");
  });

  it("supersedes, commits, and repoints in one ordered RPC transaction", () => {
    const supersede = commitFunction.indexOf(
      "set lifecycle = 'superseded'",
    );
    const commitExisting = commitFunction.indexOf(
      "lifecycle = 'committed',\n      committed_at = requested_committed_at",
    );
    const insertRevision = commitFunction.indexOf(
      "insert into public.study_routes (",
    );
    const pointerUpdate = commitFunction.indexOf(
      "update public.plan_sessions as session",
    );

    expect(supersede).toBeGreaterThan(-1);
    expect(commitExisting).toBeGreaterThan(supersede);
    expect(insertRevision).toBeGreaterThan(supersede);
    expect(pointerUpdate).toBeGreaterThan(commitExisting);
    expect(pointerUpdate).toBeGreaterThan(insertRevision);
    expect(commitFunction).toContain(
      "session.committed_route_revision_id is not distinct from\n      requested_session.committed_route_revision_id",
    );
    expect(commitFunction).toContain("message = 'study_route_pointer_conflict'");
  });

  it("introduces StudyRoute storage only in the new migration", () => {
    const earlierMigrations = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql") && name < migrationName);

    expect(earlierMigrations.length).toBeGreaterThan(0);
    for (const name of earlierMigrations) {
      const earlierMigration = readFileSync(
        resolve(migrationsDirectory, name),
        "utf8",
      );
      expect(earlierMigration, name).not.toContain("create table public.study_routes");
      expect(earlierMigration, name).not.toContain("committed_route_revision_id");
    }
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "202608240002_plan_activation_permits.sql";
const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(
  resolve(migrationsDirectory, migrationName),
  "utf8",
).toLocaleLowerCase();

const mintPermit = functionBody("mint_plan_activation_permit_v1");
const cleanupPermits = functionBody("cleanup_plan_activation_permits_v1");
const permitMatches = functionBody("current_plan_activation_permit_matches_v1");
const resetLearningData = functionBody("reset_yova_learning_data");
const activatePlan = functionBody("save_generated_plan_with_routes");

describe("server-issued plan activation permit migration", () => {
  it("adds an account-cascading, content-free permit and durable outcome receipt", () => {
    const tableDefinition = migration.slice(
      migration.indexOf("create table public.plan_activation_permits"),
      migration.indexOf("create index plan_activation_permits_expiry_idx"),
    );

    expect(tableDefinition).toContain(
      "user_id uuid not null references auth.users(id) on delete cascade",
    );
    for (const column of [
      "receipt_issued_at timestamptz not null",
      "consumed_at timestamptz",
      "saved_plan_id uuid",
    ]) {
      expect(tableDefinition).toContain(column);
    }
    expect(tableDefinition).toContain("unique (user_id, plan_id, payload_digest)");
    expect(tableDefinition).toContain(
      "check (expires_at = issued_at + interval '5 minutes')",
    );
    expect(tableDefinition).toContain("saved_plan_id = plan_id");
    expect(tableDefinition).not.toMatch(/\bpayload\s+jsonb/);
    expect(migration).toContain(
      "alter table public.plan_activation_permits enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.plan_activation_permits\n"
      + "from public, anon, authenticated, service_role",
    );
    expect(migration).not.toContain("create policy");
  });

  it("binds service-only minting to the verified receipt epoch after the account lock", () => {
    expect(migration).toContain(
      "public.mint_plan_activation_permit_v1(jsonb, uuid, timestamptz)",
    );
    expect(mintPermit).toContain("auth.role() is distinct from 'service_role'");
    expect(mintPermit).toContain("draft_receipt_issued_at is null");
    expect(mintPermit).toContain("from auth.users as auth_user");
    expect(mintPermit).toContain("pg_catalog.octet_length(requested_payload_text) > 8388608");
    expect(mintPermit).toContain("requested_plan_id := nullif(payload ->> 'id', '')::uuid");

    const accountLock = mintPermit.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const effectiveTime = mintPermit.indexOf(
      "effective_issued_at := pg_catalog.clock_timestamp()",
    );
    const resetEpoch = mintPermit.indexOf(
      "from public.private_learning_data_reset_boundaries as boundary",
    );
    const digest = mintPermit.indexOf("'yova.plan_activation_permit.v2|'");
    expect(accountLock).toBeGreaterThan(-1);
    expect(effectiveTime).toBeGreaterThan(accountLock);
    expect(resetEpoch).toBeGreaterThan(effectiveTime);
    expect(digest).toBeGreaterThan(resetEpoch);
    expect(mintPermit).toContain(
      "draft_receipt_issued_at < effective_issued_at - interval '24 hours'",
    );
    expect(mintPermit).toContain(
      "draft_receipt_issued_at > effective_issued_at + interval '1 minute'",
    );
    expect(mintPermit).toContain(
      "draft_receipt_issued_at\n      <= latest_reset_completed_at + interval '1 minute'",
    );
    expect(mintPermit).toContain(
      "extract(epoch from draft_receipt_issued_at) * 1000000",
    );
    expect(mintPermit).toContain("|| requested_payload_text");
    expect(migration).toContain(
      "grant execute on function public.mint_plan_activation_permit_v1(jsonb, uuid, timestamptz)\n"
      + "to service_role",
    );
  });

  it("retains the Reset epoch for the full signed-draft lifetime without extending its upload embargo", () => {
    expect(migration).toContain(
      "add column plan_activation_epoch_expires_at timestamptz",
    );
    expect(migration).toContain(
      "plan_activation_epoch_expires_at\n    >= reset_completed_at + interval '24 hours 1 minute'",
    );
    const retentionGuard = functionBody("guard_plan_activation_reset_epoch_v1");
    expect(retentionGuard).toContain("if tg_op = 'delete' then");
    expect(retentionGuard).toContain("auth.role() = 'service_role'");
    expect(retentionGuard).toContain(
      "old.plan_activation_epoch_expires_at > pg_catalog.clock_timestamp()",
    );
    expect(retentionGuard).toContain("return null");
    expect(retentionGuard).not.toContain("compatibility_writes_blocked_until :=");
    expect(migration).toContain(
      "before insert or update of reset_completed_at or delete\n"
      + "on public.private_learning_data_reset_boundaries",
    );
  });

  it("reuses live and consumed exact rows but rotates an expired unconsumed UUID", () => {
    const purge = mintPermit.indexOf(
      "delete from public.plan_activation_permits as stale_permit",
    );
    const exactRead = mintPermit.indexOf(
      "from public.plan_activation_permits as permit",
      purge,
    );
    const existingReturn = mintPermit.indexOf("return existing_permit.id", exactRead);
    const insert = mintPermit.indexOf("insert into public.plan_activation_permits", exactRead);

    expect(purge).toBeGreaterThan(-1);
    expect(exactRead).toBeGreaterThan(purge);
    expect(existingReturn).toBeGreaterThan(exactRead);
    expect(insert).toBeGreaterThan(existingReturn);
    expect(mintPermit).toContain("stale_permit.consumed_at is null");
    expect(mintPermit).toContain("stale_permit.expires_at <= effective_issued_at");
    expect(mintPermit).toContain("stale_permit.consumed_at is not null");
    expect(mintPermit).toContain("effective_issued_at - interval '24 hours'");
    expect(mintPermit).toContain(
      "on conflict (user_id, plan_id, payload_digest) do nothing",
    );
    expect(migration).toContain("id uuid primary key default extensions.gen_random_uuid()");
  });

  it("makes the GUC a pointer only to one live, unconsumed, post-reset row", () => {
    expect(permitMatches).toContain(
      "pg_catalog.current_setting(\n    'yova.plan_activation_permit_id',\n    true",
    );
    expect(permitMatches).toContain("exception when invalid_text_representation then");
    expect(permitMatches).toContain("permit.consumed_at is null");
    expect(permitMatches).toContain("permit.saved_plan_id is null");
    expect(permitMatches).toContain("permit.expires_at > pg_catalog.clock_timestamp()");
    expect(permitMatches).toContain(
      "permit.receipt_issued_at\n            <= boundary.reset_completed_at + interval '1 minute'",
    );
    expect(migration).toContain(
      "revoke all on function public.current_plan_activation_permit_matches_v1(uuid, uuid)\n"
      + "from public, anon, authenticated, service_role",
    );
  });

  it("wraps Reset so permit deletion and the mature reset share one account transaction", () => {
    expect(migration).toContain(
      "alter function public.reset_yova_learning_data()\n"
      + "rename to reset_yova_learning_data_without_plan_activation_permits_v1",
    );
    expect(migration).toContain(
      "revoke all on function public.reset_yova_learning_data_without_plan_activation_permits_v1()\n"
      + "from public, anon, authenticated, service_role",
    );

    const accountLock = resetLearningData.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const permitDelete = resetLearningData.indexOf(
      "delete from public.plan_activation_permits as permit",
    );
    const delegate = resetLearningData.indexOf(
      "public.reset_yova_learning_data_without_plan_activation_permits_v1()",
    );
    expect(resetLearningData).toContain("current_user_id uuid := auth.uid()");
    expect(accountLock).toBeGreaterThan(-1);
    expect(permitDelete).toBeGreaterThan(accountLock);
    expect(delegate).toBeGreaterThan(permitDelete);
    expect(migration).toContain(
      "grant execute on function public.reset_yova_learning_data()\nto authenticated",
    );
  });

  it("makes the old writer private and replays only an exact consumed outcome", () => {
    expect(migration).toContain(
      "alter function public.save_generated_plan_with_routes(jsonb)\n"
      + "rename to save_generated_plan_with_routes_without_activation_permit_v1",
    );
    expect(migration).toContain(
      "revoke all on function public.save_generated_plan_with_routes_without_activation_permit_v1(jsonb)\n"
      + "from public, anon, authenticated, service_role",
    );

    const accountLock = activatePlan.indexOf("pg_catalog.pg_advisory_xact_lock(");
    const permitLock = activatePlan.indexOf("from public.plan_activation_permits as permit");
    const rowLock = activatePlan.indexOf("for update", permitLock);
    const resetEpoch = activatePlan.indexOf(
      "from public.private_learning_data_reset_boundaries as boundary",
    );
    const digest = activatePlan.indexOf("'yova.plan_activation_permit.v2|'");
    const exactCheck = activatePlan.indexOf(
      "locked_permit.payload_digest is distinct from requested_payload_digest",
    );
    const replay = activatePlan.indexOf("if locked_permit.consumed_at is not null then");
    const guc = activatePlan.indexOf("'yova.plan_activation_permit_id'");
    const delegate = activatePlan.indexOf(
      "public.save_generated_plan_with_routes_without_activation_permit_v1(",
    );
    const outcome = activatePlan.indexOf(
      "update public.plan_activation_permits as consumed_permit",
    );

    expect(accountLock).toBeGreaterThan(-1);
    expect(permitLock).toBeGreaterThan(accountLock);
    expect(rowLock).toBeGreaterThan(permitLock);
    expect(resetEpoch).toBeGreaterThan(rowLock);
    expect(activatePlan).toContain(
      "locked_permit.receipt_issued_at\n      <= latest_reset_completed_at + interval '1 minute'",
    );
    expect(digest).toBeGreaterThan(resetEpoch);
    expect(exactCheck).toBeGreaterThan(digest);
    expect(replay).toBeGreaterThan(exactCheck);
    expect(guc).toBeGreaterThan(replay);
    expect(delegate).toBeGreaterThan(guc);
    expect(outcome).toBeGreaterThan(delegate);
    expect(activatePlan).toContain("return locked_permit.saved_plan_id");
    expect(activatePlan).toContain("saved_plan_id = delegated_saved_plan_id");
    expect(activatePlan).not.toContain("delete from public.plan_activation_permits");
    expect(migration).toContain(
      "grant execute on function public.save_generated_plan_with_routes(jsonb, uuid)\n"
      + "to authenticated",
    );
  });

  it("offers bounded service cleanup only for dead capabilities and expired outcomes", () => {
    expect(cleanupPermits).toContain("auth.role() is distinct from 'service_role'");
    expect(cleanupPermits).toContain("requested_limit not between 1 and 2000");
    expect(cleanupPermits).toContain("for update skip locked");
    expect(cleanupPermits).toContain("limit requested_limit");
    expect(cleanupPermits).toContain("permit.consumed_at is null");
    expect(cleanupPermits).toContain("permit.expires_at <= pg_catalog.clock_timestamp()");
    expect(cleanupPermits).toContain("permit.consumed_at is not null");
    expect(cleanupPermits).toContain("interval '24 hours'");
    expect(migration).toContain(
      "grant execute on function public.cleanup_plan_activation_permits_v1(integer)\n"
      + "to service_role",
    );
  });

  it("declares a coordinated signature cutover and refreshes PostgREST", () => {
    expect(migration).not.toContain(
      "grant execute on function public.save_generated_plan_with_routes(jsonb)\n",
    );
    expect(migration).toContain("forward-only cutover");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("keeps the digest terminator and private-delegate revoke syntactically singular", () => {
    expect(mintPermit).toContain("'sha256'\n  );\n\n  -- an unconsumed capability");
    expect(mintPermit).not.toContain("'sha256'\n  );\n  );");
    expect(migration.match(
      /revoke all on function public\.save_generated_plan_with_routes_without_activation_permit_v1\(jsonb\)\nfrom public, anon, authenticated, service_role;/gu,
    )).toHaveLength(1);
    expect(migration).not.toContain(
      "from public, anon, authenticated, service_role;\n"
      + "from public, anon, authenticated, service_role;",
    );
  });

  it("is the first migration to define the server-issued activation permit", () => {
    const earlierMigrations = readdirSync(migrationsDirectory)
      .filter((name) => name.endsWith(".sql") && name < migrationName);

    for (const name of earlierMigrations) {
      expect(
        readFileSync(resolve(migrationsDirectory, name), "utf8"),
        name,
      ).not.toContain("plan_activation_permit");
    }
  });
});

function functionBody(name: string) {
  const needle = `create or replace function public.${name}(`;
  const start = migration.indexOf(needle);
  const end = migration.indexOf("\n$$;", start) + "\n$$;".length;
  expect(start, `${name} start`).toBeGreaterThan(-1);
  expect(end, `${name} end`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

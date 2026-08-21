import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608210003_ai_usage_reservation_lifecycle.sql"),
  "utf8",
);

function functionSource(name: string, nextName?: string) {
  const afterStart = migration.split(`create or replace function public.${name}`)[1] ?? "";
  return nextName
    ? afterStart.split(`create or replace function public.${nextName}`)[0] ?? ""
    : afterStart;
}

describe("bounded AI usage reservation lifecycle migration", () => {
  it("backfills historical claims into terminal states before enforcing the lifecycle shape", () => {
    expect(migration).toContain("add column state text");
    expect(migration).toContain("add column operation_key uuid");
    expect(migration).toContain("add column recovery_key uuid");
    expect(migration).toContain("add column lease_expires_at timestamptz");
    expect(migration).toContain("add column consumed_at timestamptz");
    expect(migration).toContain("when day_window_started_at = date_trunc('day', now()) then 'reserved'");
    expect(migration).toContain("then day_window_started_at + interval '1 day'");
    expect(migration).toContain("state in ('reserved', 'consumed', 'released')");
  });

  it("makes operation keys owner/action idempotent without replaying provider work", () => {
    expect(migration).toContain("create unique index ai_usage_claims_operation_key_idx");
    expect(migration).toContain("on public.ai_usage_claims(user_id, action, operation_key)");
    expect(migration).toContain("where operation_key is not null");
    expect(migration).toContain("operation_key is not null");
    expect(migration).toContain("recovery_key is not null");
    expect(migration).toContain("operation_key <> recovery_key");

    const reserve = functionSource("reserve_ai_request", "consume_ai_request_claim");
    expect(reserve).toContain("and operation_key = request_operation_key");
    expect(reserve).toContain("for update");
    expect(reserve).toContain("'denialReason', 'operation_in_progress'");
    expect(reserve).toContain("prior_claim.lease_expires_at - request_timestamp");
    expect(reserve).not.toContain("'claimId', prior_claim.id");
    expect(reserve).not.toContain("'replayed', true");
    expect(reserve).toContain("request_operation_key = request_recovery_key");
  });

  it("serializes reclaim and idempotency before quota counts or increments", () => {
    const reserve = functionSource("reserve_ai_request", "consume_ai_request_claim");
    const advisory = reserve.indexOf("pg_advisory_xact_lock");
    const reclaim = reserve.indexOf("reclaim_expired_ai_usage_reservations");
    const count = reserve.indexOf("coalesce(max(request_count)");
    const increment = reserve.indexOf("insert into public.ai_usage_windows");

    expect(advisory).toBeGreaterThan(-1);
    expect(reclaim).toBeGreaterThan(advisory);
    expect(count).toBeGreaterThan(reclaim);
    expect(increment).toBeGreaterThan(count);
    expect(reserve.indexOf("request_timestamp := pg_catalog.clock_timestamp()"))
      .toBeGreaterThan(advisory);
  });

  it("bounds strict reservations with a database lease", () => {
    const reserve = functionSource("reserve_ai_request", "consume_ai_request_claim");
    expect(reserve).toContain("lease_seconds not between 30 and 600");
    expect(reserve).toContain("request_timestamp + pg_catalog.make_interval(secs => lease_seconds)");

    const reclaim = functionSource(
      "reclaim_expired_ai_usage_reservations",
      "reserve_ai_request",
    );
    expect(reclaim).toContain("state = 'reserved'");
    expect(reclaim).toContain("lease_expires_at <= request_timestamp");
    expect(reclaim).toContain("for update");
    expect(reclaim).toContain("release_ai_usage_reservation_locked");
  });

  it("reclaims expired reservations before status counts too", () => {
    const status = functionSource("read_ai_usage_status");
    expect(status).toContain("volatile");
    expect(status.indexOf("reclaim_expired_ai_usage_reservations"))
      .toBeLessThan(status.indexOf("coalesce(max(request_count)"));
  });

  it("settles and releases only an exact owner-scoped reserved claim under the same lock order", () => {
    const consume = functionSource("consume_ai_request_claim", "release_ai_request_claim");
    expect(consume.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(consume.indexOf("for update"));
    expect(consume).toContain("and user_id = current_user_id");
    expect(consume).toContain("set state = 'consumed'");
    expect(consume).toContain("and state = 'reserved'");

    const release = functionSource(
      "release_ai_request_claim",
      "release_ai_request_reservation",
    );
    expect(release.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(release.indexOf("release_ai_usage_reservation_locked"));
    expect(release).toContain("and user_id = current_user_id");
  });

  it("recovers an unknown claim outcome only with the server-private recovery key", () => {
    const recovery = functionSource(
      "release_ai_request_reservation",
      "claim_ai_request",
    );
    expect(recovery).toContain("user_id = current_user_id");
    expect(recovery).toContain("action = request_action");
    expect(recovery).toContain("operation_key = request_operation_key");
    expect(recovery).toContain("recovery_key = request_recovery_key");
    expect(recovery).toContain("for update");
    expect(migration).toContain(
      "drop function if exists public.release_ai_request_reservation(text, uuid)",
    );
    expect(migration).toContain(
      "drop function if exists public.reserve_ai_request(text, integer, integer, uuid, integer)",
    );
  });

  it("keeps the legacy three-argument RPC safe during the database-first window", () => {
    const legacy = functionSource("claim_ai_request", "read_ai_usage_status");
    expect(migration).toContain("public.claim_ai_request(text, integer, integer)");
    expect(legacy).toContain("'claimId', usage_claim_id");
    expect(legacy).toContain("'reserved'");
    expect(legacy).toContain("day_start + interval '1 day'");
    expect(legacy).toContain("reclaim_expired_ai_usage_reservations");
  });
});

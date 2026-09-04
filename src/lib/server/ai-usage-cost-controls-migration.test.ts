import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609040001_expand_ai_usage_cost_controls.sql"),
  "utf8",
);

function functionSource(signature: string) {
  const marker = `create or replace function public.${signature}`;
  const start = migration.indexOf(marker);
  expect(start, `missing ${signature}`).toBeGreaterThanOrEqual(0);
  const next = migration.indexOf("\ncreate or replace function public.", start + marker.length);
  return migration.slice(start, next < 0 ? undefined : next);
}

const ACTION_LIMITS = [
  ["plan_generation", 3, 5, 5, 20],
  ["plan_adjustment", 3, 5, 8, 20],
  ["intake_interpretation", 6, 10, 30, 80],
  ["material_processing", 1, 2, 3, 10],
  ["session_generation", 5, 8, 10, 40],
  ["lesson_generation", 8, 12, 20, 80],
  ["answer_evaluation", 12, 20, 40, 120],
  ["tutor_message", 10, 15, 30, 80],
  ["teaching_visual", 1, 2, 3, 12],
] as const;

describe("expanded durable AI cost controls migration", () => {
  it.each(ACTION_LIMITS)(
    "owns immutable public/tester caps for %s",
    (action, publicMinute, testerMinute, publicDay, testerDay) => {
      const limits = functionSource("ai_usage_limits_v1(");
      expect(limits).toContain(
        `when '${action}' then case when request_public_accounts then ${publicMinute} else ${testerMinute} end`,
      );
      expect(limits).toContain(
        `when '${action}' then case when request_public_accounts then ${publicDay} else ${testerDay} end`,
      );
    },
  );

  it.each(ACTION_LIMITS.map(([action]) => action))(
    "allows %s in both ledgers",
    (action) => {
      const windowsConstraint = migration.slice(
        migration.indexOf("add constraint ai_usage_windows_action_check"),
        migration.indexOf("alter table public.ai_usage_claims"),
      );
      const claimsConstraint = migration.slice(
        migration.indexOf("add constraint ai_usage_claims_action_check"),
        migration.indexOf("create or replace function public.ai_usage_limits_v1"),
      );
      expect(windowsConstraint).toContain(`'${action}'`);
      expect(claimsConstraint).toContain(`'${action}'`);
    },
  );

  it.each([
    "plan_adjustment",
    "intake_interpretation",
    "material_processing",
  ])("routes the new %s action through strict reserve and recovery validation", (action) => {
    const limits = functionSource("ai_usage_limits_v1(");
    const reserve = functionSource("reserve_ai_request_for_user_internal_v1(");
    const recovery = functionSource("release_ai_request_reservation_for_user(");

    expect(limits).toContain(`when '${action}'`);
    expect(reserve).toContain("from public.ai_usage_limits_v1(");
    expect(recovery).toContain("from public.ai_usage_limits_v1(request_action, true)");
  });

  it("makes the operation-key decision before either quota increment", () => {
    const reserve = functionSource("reserve_ai_request_for_user_internal_v1(");
    const operationLookup = reserve.indexOf("and operation_key = request_operation_key");
    const inProgress = reserve.indexOf("'denialReason', 'operation_in_progress'");
    const increment = reserve.indexOf("insert into public.ai_usage_windows");

    expect(reserve.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
    expect(operationLookup).toBeGreaterThan(-1);
    expect(inProgress).toBeGreaterThan(operationLookup);
    expect(increment).toBeGreaterThan(inProgress);
    expect(reserve).toContain("request_timestamp + interval '180 seconds'");
  });

  it("keeps trusted per-user entry points service-role only", () => {
    const signatures = [
      "reserve_ai_request_for_user(uuid, text, uuid, uuid, boolean)",
      "consume_ai_request_claim_for_user(uuid, uuid)",
      "release_ai_request_claim_for_user(uuid, uuid)",
      "release_ai_request_reservation_for_user(uuid, text, uuid, uuid)",
    ];

    for (const signature of signatures) {
      const source = functionSource(`${signature.split("(")[0]}(`);
      expect(source).toContain("auth.role() is distinct from 'service_role'");
      expect(migration).toContain(`grant execute on function public.${signature}\nto service_role;`);
      expect(migration).not.toContain(`grant execute on function public.${signature}\nto authenticated;`);
    }
  });

  it("keeps the rolling-deploy reserve signature but ignores caller limits and lease", () => {
    const compatibility = functionSource("reserve_ai_request(\n");
    const body = compatibility.split("as $reserve_compat$")[1] ?? "";

    expect(body).toContain("reserve_ai_request_for_user_internal_v1(");
    expect(body).toContain("request_recovery_key,\n    true");
    expect(body).not.toContain("minute_limit");
    expect(body).not.toContain("day_limit");
    expect(body).not.toContain("lease_seconds");
    expect(migration).toContain(
      "grant execute on function public.reserve_ai_request(text, integer, integer, uuid, uuid, integer)\nto authenticated;",
    );
  });

  it("consumes expired leases without decrementing either window", () => {
    const reclaim = functionSource("reclaim_expired_ai_usage_reservations(");

    expect(reclaim).toContain("set state = 'consumed'");
    expect(reclaim).toContain("and lease_expires_at <= request_timestamp");
    expect(reclaim).not.toContain("release_ai_usage_reservation_locked");
    expect(reclaim).not.toContain("ai_usage_windows");
  });

  it("deletes a timely true release but consumes a release after expiry", () => {
    const release = functionSource("release_ai_usage_reservation_locked(");
    const expiry = release.indexOf("reservation.lease_expires_at <= release_timestamp");
    const consume = release.indexOf("set state = 'consumed'", expiry);
    const decrement = release.indexOf("request_count = request_count - 1");

    expect(expiry).toBeGreaterThan(-1);
    expect(consume).toBeGreaterThan(expiry);
    expect(decrement).toBeGreaterThan(consume);
    expect(release).toContain("delete from public.ai_usage_claims");
    expect(release).not.toContain("set state = 'released'");
  });

  it("makes authenticated compatibility release endpoints consume-only", () => {
    const claimRelease = functionSource("release_ai_request_claim(\n");
    const operationRelease = functionSource("release_ai_request_reservation(\n");

    expect(claimRelease).toContain("consume_ai_request_claim_for_user_internal_v1(");
    expect(operationRelease).toContain("consume_ai_request_claim_for_user_internal_v1(");
    expect(claimRelease).not.toContain("release_ai_usage_reservation_locked");
    expect(operationRelease).not.toContain("release_ai_usage_reservation_locked");
  });

  it("disables and revokes the unused non-idempotent claim RPC", () => {
    const claim = functionSource("claim_ai_request(");

    expect(claim).toContain("message = 'legacy_ai_claim_disabled'");
    expect(migration).toContain(
      "revoke all on function public.claim_ai_request(text, integer, integer)\nfrom public, anon, authenticated, service_role;",
    );
    expect(migration).not.toContain(
      "grant execute on function public.claim_ai_request(text, integer, integer)",
    );
  });

  it("keeps status legacy-only and clamps its inputs to public hard caps", () => {
    const status = functionSource("read_ai_usage_status(");

    expect(status).toContain("effective_minute_limit := least(minute_limit, hard_minute_limit)");
    expect(status).toContain("effective_day_limit := least(day_limit, hard_day_limit)");
    expect(status).not.toContain("'plan_adjustment'");
    expect(status).not.toContain("'intake_interpretation'");
    expect(status).not.toContain("'material_processing'");
  });
});

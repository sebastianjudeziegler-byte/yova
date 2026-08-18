import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608170003_account_data_export.sql",
  ),
  "utf8",
);
const completeResetMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608160001_complete_learning_data_reset.sql",
  ),
  "utf8",
);

function between(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

const tableSection = between(
  "create table public.account_data_exports",
  "create or replace function public.account_export_constant_time_equal",
);
const amrFunction = between(
  "create or replace function public.account_export_has_recent_human_amr()",
  "create or replace function public.begin_account_data_export",
);
const beginFunction = between(
  "create or replace function public.begin_account_data_export",
  "create or replace function public.claim_account_data_export",
);
const claimFunction = between(
  "create or replace function public.claim_account_data_export",
  "create or replace function public.complete_account_data_export",
);
const completeFunction = between(
  "create or replace function public.complete_account_data_export",
  "create or replace function public.fail_account_data_export",
);
const failFunction = between(
  "create or replace function public.fail_account_data_export",
  "create or replace function public.revoke_account_data_export",
);
const revokeFunction = between(
  "create or replace function public.revoke_account_data_export",
  "create or replace function public.export_account_operational_records",
);
const operationalFunction = between(
  "create or replace function public.export_account_operational_records",
  "create or replace function public.export_yova_account_data",
);
const exportFunction = between(
  "create or replace function public.export_yova_account_data",
  "create or replace function public.build_account_data_export",
);
const cleanupFunctions = migration.slice(
  migration.indexOf("create or replace function public.claim_expired_account_data_exports"),
);
const resetFunction = between(
  "create function public.reset_yova_learning_data()",
  "revoke all on function public.begin_account_data_export",
);

const learnerTransactionLock = `perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('yova_learning_data'),
    pg_catalog.hashtext(current_user_id::text)
  )`;

describe("account-data export migration", () => {
  it("creates a private JSON-only bounded bucket with no direct browser policy", () => {
    expect(migration).toContain("'account-exports',\n  'account-exports',\n  false,\n  26214400");
    expect(migration).toContain("array['application/json']");
    expect(migration).not.toContain("create policy \"account_export_objects");
    expect(migration).not.toContain("account_export_storage_access");
  });

  it("keeps the export-job ledger internal and tracks both cleanup paths from begin", () => {
    expect(tableSection).toContain("alter table public.account_data_exports enable row level security");
    expect(tableSection).toContain(
      "an admin/Auth deletion must not erase\n  -- the exact private-object cleanup receipt",
    );
    expect(tableSection).not.toMatch(/user_id uuid[^,]*references auth[.]users/i);
    expect(tableSection).not.toMatch(/user_id uuid[^,]*on delete cascade/i);
    expect(tableSection).toContain(
      "revoke all on table public.account_data_exports from public, anon, authenticated, service_role",
    );
    expect(tableSection).not.toMatch(/grant\s+(select|insert|update|delete).*account_data_exports/i);
    expect(tableSection).toContain("final_storage_path text not null");
    expect(tableSection).toContain("finalize_grant_digest is not null");
    expect(tableSection).toContain(
      "final_storage_path = user_id::text || '/' || id::text || '/yova-data.json'",
    );
    expect(beginFunction).toContain(
      "current_user_id::text || '/' || requested_export_id::text || '/device-state.json'",
    );
    expect(beginFunction).toContain(
      "current_user_id::text || '/' || requested_export_id::text || '/yova-data.json'",
    );
  });

  it("requires verified recent human authentication without trusting JWT issuance time", () => {
    expect(beginFunction).toContain("account_export_reauthentication_required");
    expect(beginFunction).toContain("email_confirmed_at is not null");
    expect(beginFunction).toContain("coalesce(is_anonymous, false) is false");
    expect(beginFunction).toContain("auth.jwt() ->> 'session_id'");
    expect(amrFunction).toContain("pg_catalog.jsonb_typeof(entry) = 'object'");
    expect(amrFunction).toContain("pg_catalog.jsonb_typeof(entry -> 'timestamp') = 'number'");
    expect(amrFunction).toContain("now() - interval '10 minutes'");
    const allowedMethods = [
      "password",
      "otp",
      "oauth",
      "totp",
      "mfa/totp",
      "mfa/phone",
      "mfa/webauthn",
      "sso/saml",
      "magiclink",
      "web3",
    ];
    const methodList = amrFunction.match(
      /lower\(entry ->> 'method'\) in \(([\s\S]*?)\n\s*\)/,
    );
    expect(methodList).not.toBeNull();
    expect(
      [...(methodList?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]),
    ).toEqual(allowedMethods);
    for (const rejectedMethod of [
      "email",
      "webauthn",
      "oauth_provider/authorization_code",
      "recovery",
      "invite",
      "anonymous",
      "token_refresh",
      "email_change",
    ]) {
      expect(amrFunction).not.toContain(`'${rejectedMethod}'`);
    }
    expect(`${amrFunction}${beginFunction}`).not.toContain("->> 'iat'");
  });

  it("stores only a one-time digest and consumes it in a constant-time account/session claim", () => {
    expect(tableSection).toContain("finalize_grant_digest bytea");
    expect(tableSection).not.toMatch(/finalize_grant\s+text/);
    expect(beginFunction).toContain("extensions.gen_random_bytes(32)");
    expect(beginFunction).toContain("extensions.digest(");
    expect(beginFunction).toContain("'sha256'");
    expect(claimFunction).toContain("and user_id = current_user_id");
    expect(claimFunction).toContain("and session_id = current_session_id");
    expect(claimFunction).toContain("public.account_export_constant_time_equal(");
    expect(claimFunction).toContain("status = 'finalizing'");
    expect(claimFunction).toContain("finalize_grant_digest = null");
    expect(claimFunction.indexOf("public.account_export_constant_time_equal(")).toBeLessThan(
      claimFunction.indexOf("status = 'finalizing'"),
    );
  });

  it("enforces durable one-active, hourly, and daily quotas with distinct retry codes", () => {
    expect(tableSection).toContain("account_data_exports_one_active_per_user_idx");
    expect(tableSection).toContain("where status in ('preparing', 'finalizing')");
    expect(beginFunction).toContain("if recent_hour_count >= 2");
    expect(beginFunction).toContain("errcode = 'PXA01'");
    expect(beginFunction).toContain("account_export_hourly_quota_exceeded");
    expect(beginFunction).toContain("if recent_day_count >= 5");
    expect(beginFunction).toContain("errcode = 'PXA02'");
    expect(beginFunction).toContain("account_export_daily_quota_exceeded");
    expect(beginFunction).toContain("errcode = 'PXA03'");
    expect(beginFunction).toContain("detail = 'retry_after_seconds='");
    expect(beginFunction).toContain(
      "from public.account_data_exports\n  where user_id = current_user_id",
    );
    expect(tableSection).toContain("storage_cleaned_at timestamptz");
  });

  it("requires the exact bounded temporary object before atomically claiming", () => {
    expect(claimFunction).toContain("object.bucket_id = 'account-exports'");
    expect(claimFunction).toContain("object.name = stored_temp_storage_path");
    expect(claimFunction).toContain("device_size not between 1 and 2097152");
    expect(claimFunction).toContain("device_mime <> 'application/json'");
    expect(claimFunction).toContain("for update");
  });

  it("builds one bounded explicit-field snapshot under the Reset transaction lock", () => {
    expect(exportFunction).toContain(learnerTransactionLock);
    expect(exportFunction.indexOf(learnerTransactionLock)).toBeLessThan(
      exportFunction.indexOf("with section_counts"),
    );
    expect(exportFunction).toContain("status = 'finalizing'");
    expect(exportFunction).toContain(
      "prepare_expires_at > now() + interval '3 minutes'",
    );
    expect(exportFunction).toContain("largest_section_count > 10000");
    expect(exportFunction).toContain("total_record_count > 25000");
    expect(exportFunction).toContain("owned_storage_object_count > 2000");
    expect(exportFunction).toContain("with actual_section_counts(section_count) as");
    expect(exportFunction).toContain("pg_catalog.jsonb_array_length(result -> 'learningItems')");
    expect(exportFunction).toContain("pg_catalog.jsonb_array_length(result #> '{operational,aiUsageWindows}')");
    expect(exportFunction).toContain("pg_catalog.jsonb_array_length(result -> 'storageManifest')");
    expect(exportFunction).toContain("result := result || pg_catalog.jsonb_build_object(");
    expect(exportFunction.lastIndexOf("largest_section_count > 10000")).toBeGreaterThan(
      exportFunction.indexOf("with actual_section_counts(section_count) as"),
    );
    expect(exportFunction.lastIndexOf("total_record_count > 25000")).toBeGreaterThan(
      exportFunction.indexOf("with actual_section_counts(section_count) as"),
    );
    expect(exportFunction.lastIndexOf("owned_storage_object_count > 2000")).toBeGreaterThan(
      exportFunction.indexOf("with actual_section_counts(section_count) as"),
    );
    expect(exportFunction.indexOf("record_count = total_record_count::integer")).toBeGreaterThan(
      exportFunction.indexOf("result := result || pg_catalog.jsonb_build_object("),
    );
    expect(exportFunction).toContain("pg_catalog.octet_length(result::text) > 26214400");
    expect(exportFunction).toContain("message = 'account_export_limit_exceeded'");
    expect(exportFunction).not.toMatch(/select\s+\*/i);
    expect(exportFunction).not.toContain("to_jsonb(");
  });

  it("includes every reviewed account section and the exact owned Storage manifest", () => {
    for (const key of [
      "profile",
      "learnerProfile",
      "learningItems",
      "plans",
      "planSessions",
      "materials",
      "sessionAttempts",
      "learningEvents",
      "tutorThreads",
      "tutorMessages",
      "materialUploads",
      "productEvents",
      "supportRequests",
      "errorReports",
      "deadlineMilestones",
      "materialChunks",
      "operational",
      "storageManifest",
    ]) {
      expect(exportFunction).toContain(`'${key}'`);
    }
    expect(exportFunction).toContain("object.bucket_id = 'learning-materials'");
    expect(exportFunction).toContain(
      "(storage.foldername(object.name))[1] = current_user_id::text",
    );
    expect(exportFunction).toContain("else 'orphaned'");
    expect(exportFunction).toContain("'relativePath'");
    expect(exportFunction).not.toContain("'storagePath'");
  });

  it("excludes provider request/response identifiers from the artifact", () => {
    expect(exportFunction).not.toContain("message.response_id");
    expect(exportFunction).not.toContain("report.request_id");
    expect(exportFunction).not.toContain("'responseId'");
    expect(exportFunction).not.toContain("'requestId'");
    expect(exportFunction).not.toContain("raw_app_meta_data");
    expect(exportFunction).not.toContain("raw_user_meta_data");
    expect(exportFunction).toContain("event.event_data #- '{diagnostics,lessonRequestId}'");
    expect(exportFunction).toContain("'role', message.role");
    expect(exportFunction).toContain("'content', message.content");
  });

  it("sanitizes retained usage and access ledgers", () => {
    expect(operationalFunction).toContain("where usage_window.user_id = current_user_id");
    expect(operationalFunction).toContain("where founder.user_id = current_user_id");
    expect(operationalFunction).toContain("invite.auth_user_id = current_user_id");
    expect(operationalFunction).toContain("'isFounder'");
    expect(operationalFunction).toContain("'testerAccess'");
    expect(operationalFunction).not.toContain("'invitedBy'");
    expect(operationalFunction).not.toContain("'sendCount'");
    expect(operationalFunction).not.toContain("'id', invite.id");
  });

  it("validates the final artifact and makes failure/revocation cleanup-safe", () => {
    expect(completeFunction).toContain("and session_id = current_session_id");
    expect(completeFunction).toContain("requested_size_bytes is null");
    expect(completeFunction).toContain("stored_size <> requested_size_bytes");
    expect(completeFunction).toContain("stored_mime <> 'application/json'");
    expect(completeFunction).toContain("artifact_expires_at = now() + interval '40 minutes'");
    expect(failFunction).toContain("finalize_grant_digest = null");
    expect(revokeFunction).toContain("where id = requested_export_id\n    and user_id = current_user_id");
    expect(revokeFunction).toContain("'tempStoragePath', stored_temp_storage_path");
    expect(revokeFunction).toContain("'finalStoragePath', stored_final_storage_path");
  });

  it("leases only eligible cleanup rows and confirms or releases by token", () => {
    expect(cleanupFunctions).toContain(
      "requested_limit is null or requested_limit not between 1 and 1000",
    );
    expect(cleanupFunctions).toContain("for update skip locked");
    expect(cleanupFunctions).toContain("status in ('failed', 'cancelled')");
    expect(cleanupFunctions).toContain(
      "when export_job.status in ('preparing', 'finalizing') then 'failed'",
    );
    expect(cleanupFunctions).toContain("finalize_grant_digest = null");
    expect(cleanupFunctions).toContain("cleanup_claimed_at <= now() - interval '5 minutes'");
    expect(cleanupFunctions).toContain("cleanup_token = extensions.gen_random_uuid()");
    expect(cleanupFunctions).not.toMatch(/cleanup_token\s*=\s*gen_random_uuid\(\)/);
    expect(cleanupFunctions).toContain("export_job.cleanup_token = requested_cleanup_token");
    expect(cleanupFunctions).toContain("cleanup_claimed_at = null");
    expect(cleanupFunctions).toContain("cleanup_token = null");
    expect(cleanupFunctions).toContain("storage_cleaned_at = now()");
    expect(cleanupFunctions).toContain("created_at < now() - interval '1 day'");
    expect(cleanupFunctions).toContain("if job_created_at >= now() - interval '1 day' then");
    expect(cleanupFunctions.indexOf("storage_cleaned_at = now()")).toBeLessThan(
      cleanupFunctions.indexOf("delete from public.account_data_exports as export_job"),
    );
    expect(cleanupFunctions).toContain(
      "grant execute on function public.claim_expired_account_data_exports(integer) to service_role",
    );
    for (const role of ["public", "anon", "authenticated"]) {
      expect(cleanupFunctions).toContain(
        `from public, anon, authenticated`,
      );
      expect(cleanupFunctions).not.toContain(
        `grant execute on function public.claim_expired_account_data_exports(integer) to ${role}`,
      );
    }
  });

  it("retains quota history after artifact cleanup and purges it after one day", () => {
    const confirmation = between(
      "create or replace function public.confirm_account_data_export_cleanup",
      "create or replace function public.release_account_data_export_cleanup",
    );
    expect(cleanupFunctions).toContain("export_job.storage_cleaned_at is null");
    expect(cleanupFunctions).toContain("export_job.storage_cleaned_at is not null");
    expect(cleanupFunctions).toContain("export_job.created_at < now() - interval '1 day'");
    expect(confirmation).toContain("if job_created_at >= now() - interval '1 day' then");
    expect(confirmation).toContain("storage_cleaned_at = now()");
    expect(confirmation).toContain("delete from public.account_data_exports as export_job");
    expect(confirmation.indexOf("storage_cleaned_at = now()")).toBeLessThan(
      confirmation.indexOf("delete from public.account_data_exports as export_job"),
    );
  });

  it("atomically cancels export grants and artifacts when learning data is reset", () => {
    expect(migration).toContain("drop function public.reset_yova_learning_data()");
    expect(resetFunction).toContain(learnerTransactionLock);
    expect(resetFunction).toContain("export_job.temp_storage_path as storage_path");
    expect(resetFunction).toContain("export_job.final_storage_path as storage_path");
    expect(resetFunction).toContain("status = 'cancelled'");
    expect(resetFunction).toContain("finalize_grant_digest = null");
    expect(resetFunction).toContain("'accountExportPaths', account_export_paths");
    expect(resetFunction.indexOf("status = 'cancelled'")).toBeLessThan(
      resetFunction.indexOf("delete from public.material_chunks"),
    );
    for (const table of [
      "material_chunks",
      "deadline_milestones",
      "learning_events",
      "learning_items",
      "tutor_threads",
      "material_uploads",
      "learner_profiles",
      "product_events",
      "error_reports",
    ]) {
      expect(resetFunction).toContain(
        `delete from public.${table}\n  where user_id = current_user_id`,
      );
    }
    const priorResetDeletes = [
      ...completeResetMigration.matchAll(/delete from public[.]([a-z_]+)/g),
    ].map((match) => match[1]);
    const replacementResetDeletes = [
      ...resetFunction.matchAll(/delete from public[.]([a-z_]+)/g),
    ].map((match) => match[1]);
    expect(replacementResetDeletes).toEqual(priorResetDeletes);
    expect(resetFunction).toContain(
      "update public.profiles\n  set onboarding_completed_at = null\n  where id = current_user_id",
    );
    for (const retainedTable of [
      "support_requests",
      "ai_usage_windows",
      "founder_accounts",
      "tester_invites",
    ]) {
      expect(resetFunction).not.toContain(`delete from public.${retainedTable}`);
    }
    expect(resetFunction).not.toContain("delete from public.account_data_exports");
    expect(migration).toContain(
      "revoke all on function public.reset_yova_learning_data() from public, anon",
    );
    expect(migration).toContain(
      "grant execute on function public.reset_yova_learning_data() to authenticated",
    );
    expect(migration).not.toMatch(
      /grant execute on function public[.]reset_yova_learning_data\(\) to (?:public|anon|service_role)/,
    );
  });

  it("exposes only the reviewed authenticated lifecycle RPCs", () => {
    for (const signature of [
      "public.begin_account_data_export(uuid)",
      "public.claim_account_data_export(uuid, text)",
      "public.export_account_operational_records()",
      "public.export_yova_account_data()",
      "public.build_account_data_export()",
      "public.complete_account_data_export(uuid, bigint, text)",
      "public.fail_account_data_export(uuid)",
      "public.revoke_account_data_export(uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon`);
      expect(migration).toContain(`grant execute on function ${signature} to authenticated`);
    }
    expect(migration).not.toContain("reuse_ready_account_data_export");
  });
});

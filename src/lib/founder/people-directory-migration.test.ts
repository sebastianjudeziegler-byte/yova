import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202609070006_fix_founder_people_directory.sql",
    import.meta.url,
  ),
  "utf8",
);
const normalized = migration.toLowerCase();

function functionBlock(name: string) {
  const marker = `create or replace function public.${name}`;
  const start = normalized.indexOf(marker);
  const next = normalized.indexOf(
    "\ncreate or replace function public.",
    start + marker.length,
  );

  return normalized.slice(start, next < 0 ? undefined : next);
}

describe("founder people directory migration", () => {
  const directory = functionBlock("founder_people_directory");

  it("defines the bounded directory contract with stable defaults", () => {
    expect(directory).toContain(
      "search_text text default '',\n  kind_filter text default 'all',\n  status_filter text default 'all',",
    );
    expect(directory).toContain("cursor_seen_at timestamptz default null");
    expect(directory).toContain("cursor_email text default null");
    expect(directory).toContain("result_limit integer default 25");
    expect(directory).toContain("returns jsonb");
    expect(directory).toContain("least(coalesce(result_limit, 25), 100)");
    expect(directory).not.toMatch(
      /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/,
    );
    expect(directory).toContain("pg_catalog.char_length(normalized_search) > 120");
    expect(directory).toContain("pg_catalog.char_length(normalized_cursor_email) > 320");
  });

  it("keeps the RPC behind the repeated founder-account boundary", () => {
    expect(directory).toContain("stable");
    expect(directory).toContain("security definer");
    expect(directory).toContain("set search_path = ''");
    expect(directory).toContain("from public.founder_accounts as founder");
    expect(directory).toContain("where founder.user_id = current_user_id");
    expect(directory).toContain("raise exception 'founder access is required.'");
    expect(directory).toContain(
      "revoke all on function public.founder_people_directory(\n  text,\n  text,\n  text,\n  timestamptz,\n  text,\n  integer\n)\nfrom public, anon, authenticated, service_role",
    );
    expect(directory).toContain(
      "grant execute on function public.founder_people_directory(\n  text,\n  text,\n  text,\n  timestamptz,\n  text,\n  integer\n)\nto authenticated",
    );
  });

  it("excludes founder identities from all three source sets", () => {
    expect(directory).toContain("founder_emails as materialized");
    expect(directory).toContain("where founder.user_id = auth_user.id");
    expect(directory).toContain(
      "where founder.email = pg_catalog.lower(pg_catalog.btrim(auth_user.email))",
    );
    expect(directory).toContain(
      "where founder.email = pg_catalog.lower(pg_catalog.btrim(invite.email))",
    );
    expect(directory).toContain("where founder.email = lead.email_normalized");
  });

  it("merges only exact normalized emails and states that match basis", () => {
    expect(directory).toContain(
      "left join account_rollup as account on account.email = person.email",
    );
    expect(directory).toContain(
      "left join eligible_leads as lead on lead.email_normalized = person.email",
    );
    expect(directory).toContain(
      "left join invite_rollup as invite on invite.email = person.email",
    );
    expect(directory).toContain("then 'exact_normalized_email'");
    expect(directory).not.toContain("fuzzy");
  });

  it("supports only the documented kind and status filters", () => {
    for (const kind of ["all", "accounts", "leads", "waitlist", "testers"]) {
      expect(directory).toContain(`'${kind}'`);
    }
    for (const status of [
      "all",
      "onboarding_incomplete",
      "report_unlocked",
      "confirmation_pending",
      "waitlist_confirmed",
      "email_failed",
    ]) {
      expect(directory).toContain(`'${status}'`);
    }
    expect(directory).toContain("when 'accounts' then person.has_yova_account");
    expect(directory).toContain("when 'leads' then person.has_study_profile_lead");
    expect(directory).toContain("when 'testers' then person.invite_status is not null");
  });

  it("uses deterministic keyset pagination", () => {
    expect(directory).toContain("order by person.recent_at desc, person.email asc");
    expect(directory).toContain("person.recent_at < cursor_seen_at");
    expect(directory).toContain("person.recent_at = cursor_seen_at");
    expect(directory).toContain("person.email > normalized_cursor_email");
    expect(directory).toContain("limit resolved_limit + 1");
    expect(directory).toContain("when metadata.has_more then metadata.last_cursor");
  });

  it("returns the strict top-level and row contracts", () => {
    for (const key of [
      "generatedAt",
      "summary",
      "total",
      "rows",
      "hasMore",
      "nextCursor",
      "uniquePeople",
      "yovaAccounts",
      "studyProfileLeads",
      "confirmedWaitlist",
      "pendingInvites",
    ]) {
      expect(migration).toContain(`'${key}'`);
    }

    for (const key of [
      "email",
      "kind",
      "matchBasis",
      "displayName",
      "recentAt",
      "hasYovaAccount",
      "hasStudyProfileLead",
      "accountCreatedAt",
      "emailConfirmedAt",
      "lastSignInAt",
      "onboardingCompletedAt",
      "inviteStatus",
      "invitedAt",
      "joinedAt",
      "lastProductActivityAt",
      "plansCount",
      "sessionsCompleted",
      "studyMinutes",
      "leadCreatedAt",
      "profileStatus",
      "reportCount",
      "latestReportAt",
      "reportEmailStatus",
      "reportEmailSentAt",
      "reportViewedAt",
      "marketingConsentAt",
      "waitlistStatus",
      "waitlistConfirmationStatus",
      "waitlistConsentSource",
      "waitlistRequestedAt",
      "waitlistJoinedAt",
      "confirmationDeliveryStatus",
      "schoolLevel",
      "ageBand",
      "primaryPattern",
      "energyWindow",
      "source",
      "medium",
      "campaign",
      "content",
      "term",
      "deviceType",
      "hasMetaClick",
      "betaInterest",
    ]) {
      expect(migration).toContain(`'${key}'`);
    }
  });

  it("redacts every attribution label at the final read boundary", () => {
    expect(directory.match(/private\.founder_safe_attribution_label\(/g)).toHaveLength(5);
    for (const alias of ["source", "medium", "campaign", "content", "term"]) {
      expect(directory).toContain(`end as ${alias}`);
      expect(directory).toContain(`'${alias}', page.${alias}`);
    }
  });

  it("does not emit private payloads or raw identifiers", () => {
    const forbiddenOutputKeys = [
      "id",
      "userId",
      "leadId",
      "responseId",
      "visitorId",
      "rawAnswers",
      "rawScores",
      "normalizedScores",
      "classifications",
      "profileSnapshot",
      "reportState",
      "optionalFreeResponse",
      "reportTokenHash",
      "tokenHash",
      "consumedTokenHash",
      "emailProviderMessageId",
      "deliveryProviderMessageId",
      "rawUserMetaData",
      "eventData",
      "fbclid",
    ];

    for (const key of forbiddenOutputKeys) {
      expect(migration).not.toContain(`'${key}'`);
    }
  });

  it("adds no tables, indexes, policies, or persistent write path", () => {
    expect(normalized).not.toContain("create table");
    expect(normalized).not.toContain("create index");
    expect(normalized).not.toContain("create policy");
    expect(directory).not.toMatch(/\b(insert into|update|delete from|truncate)\b/);
  });
});

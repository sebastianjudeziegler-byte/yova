import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/202609070004_founder_analytics_dashboards.sql",
    import.meta.url,
  ),
  "utf8",
);
const normalized = migration.toLowerCase();

function functionBlock(name: string) {
  const marker = `create or replace function public.${name}`;
  const start = normalized.indexOf(marker);
  const next = normalized.indexOf("\ncreate or replace function public.", start + marker.length);
  return normalized.slice(start, next < 0 ? undefined : next);
}

describe("founder analytics dashboard migration", () => {
  it("adds only a broad, bounded device category to both event streams", () => {
    for (const table of ["product_events", "study_profile_events"]) {
      expect(normalized).toContain(`alter table public.${table}\nadd column device_type text not null default 'unknown'`);
      expect(normalized).toContain(`${table}_device_type_check check`);
      expect(normalized).toContain(`${table}_device_time_idx`);
    }
    for (const device of ["mobile", "tablet", "desktop", "unknown"]) {
      expect(normalized).toContain(`'${device}'`);
    }
    expect(normalized).not.toContain("user_agent");
    expect(normalized).not.toContain("browser_version");
  });

  it("indexes the confirmation timestamps used by the dashboard", () => {
    expect(normalized).toContain("study_profile_waitlist_confirmations_requested_time_idx");
    expect(normalized).toContain("on public.study_profile_waitlist_confirmations (requested_at desc)");
    expect(normalized).toContain("study_profile_waitlist_confirmations_confirmed_time_idx");
    expect(normalized).toContain("on public.study_profile_waitlist_confirmations (confirmed_at desc)");
    expect(normalized).toContain("where confirmed_at is not null");
  });

  it("keeps both analytics functions behind the founder account boundary", () => {
    for (const name of ["founder_product_analytics", "founder_study_profile_analytics"]) {
      const block = functionBlock(name);
      expect(block).toContain("security definer");
      expect(block).toContain("set search_path = ''");
      expect(block).toContain("from public.founder_accounts as founder");
      expect(block).toContain("where founder.user_id = current_user_id");
      expect(block).toContain("raise exception 'founder access is required.'");
      expect(block).toContain(`revoke all on function public.${name}(integer)\nfrom public, anon`);
      expect(block).toContain(`grant execute on function public.${name}(integer)\nto authenticated`);
      expect(block).toContain("least(coalesce(window_days, 30), 90)");
    }
  });

  it("uses authoritative product sources and excludes operational generation events", () => {
    const block = functionBlock("founder_product_analytics");
    for (const source of [
      "public.profiles",
      "public.plans",
      "public.product_events",
      "public.session_attempts",
      "public.tutor_messages",
      "public.error_reports",
      "public.support_requests",
    ]) {
      expect(block).toContain(source);
    }
    expect(block).toContain("event.event_name <> 'generation_observed'");
    expect(block).toContain("attempt.completed_at is not null");
    expect(block).toContain("attempt.result_data ->> 'status' = 'interrupted'");
    expect(block).toContain("where attempt.user_feedback is not null");
    expect(block).toContain("100.0 * summary.fit_sessions / summary.rated_sessions");
  });

  it("uses each lead's latest in-window report for audience distributions", () => {
    const block = functionBlock("founder_study_profile_analytics");
    expect(block).toContain("latest_window_responses as materialized");
    expect(block).toContain("select distinct on (response.lead_id)");
    expect(block).toContain("order by response.lead_id, response.created_at desc, response.id desc");
    expect(block).toContain("from latest_window_responses");
  });

  it("guards question-number casts against malformed stored telemetry", () => {
    const block = functionBlock("founder_study_profile_analytics");
    expect(block).toContain(
      "when event.event_data ->> 'questionnumber' ~ '^[0-9]{1,2}$'",
    );
    expect(block).toContain(
      "then (event.event_data ->> 'questionnumber')::integer",
    );
    expect(block).not.toContain("'dropfromprevious', greatest(");
  });

  it("returns the complete dashboard contracts", () => {
    const product = functionBlock("founder_product_analytics");
    const studyProfile = functionBlock("founder_study_profile_analytics");

    for (const key of [
      "windowdays", "generatedat", "summary", "cohortfunnel", "daily",
      "devicebreakdown", "eventbreakdown", "totalaccounts", "newaccounts",
      "onboardingrate", "engagedusers", "returningusers", "planscreated",
      "activeplans", "sessionstarts", "resumedsessions", "sessionscompleted",
      "sessioncompletionrate", "studyminutes", "sessionfitrate",
      "tutorquestions", "producterrors", "erroraffectedusers",
      "opensupportrequests",
    ]) {
      expect(product).toContain(`'${key}'`);
    }

    for (const key of [
      "windowdays", "generatedat", "summary", "rates", "daily",
      "questionreach", "acquisition", "audience", "delivery",
      "devicebreakdown", "pageviews", "trackedvisits", "started", "completed",
      "reportunlocks", "uniquereportleads", "reportviews", "waitlistrequests",
      "confirmedwaitlist", "reportwaitlist", "sharetaps", "lifetimewaitlist",
      "pendingconfirmations", "visittostart", "starttocomplete",
      "completetounlock", "unlocktoreportview", "unlocktowaitlist",
      "visittowaitlist",
    ]) {
      expect(studyProfile).toContain(`'${key}'`);
    }
    expect(studyProfile).toContain("confirmation.response_id is not null");
    expect(studyProfile).toMatch(
      /confirmation\.report_waitlist\s*\/\s*response\.unique_report_leads/,
    );
  });

  it("does not expose direct identifiers or private response fields as JSON keys", () => {
    const blocks = [
      functionBlock("founder_product_analytics"),
      functionBlock("founder_study_profile_analytics"),
    ];
    const forbiddenOutputKeys = [
      "email",
      "emailnormalized",
      "userid",
      "visitorid",
      "responseid",
      "leadid",
      "rawanswers",
      "rawscores",
      "reporttoken",
      "reporttokenhash",
      "fbclid",
      "content",
      "message",
    ];

    for (const block of blocks) {
      const quotedKeys = [...block.matchAll(/'([a-z][a-z0-9]*)'\s*,/g)]
        .map((match) => match[1]);
      for (const forbidden of forbiddenOutputKeys) {
        expect(quotedKeys).not.toContain(forbidden);
      }
    }
  });

  it("redacts sensitive attribution again at the aggregate read boundary", () => {
    expect(normalized).toContain(
      "create or replace function private.founder_safe_attribution_label",
    );
    expect(normalized).toContain("normalized_value like '%@%'");
    expect(normalized).toContain("study-profile(/|%2f|%252f)report");
    expect(normalized).toContain("return 'redacted'");
    expect(normalized).toContain(
      "revoke all on function private.founder_safe_attribution_label",
    );
    const studyProfile = functionBlock("founder_study_profile_analytics");
    expect(studyProfile.match(/private\.founder_safe_attribution_label\(/g)).toHaveLength(9);
  });
});

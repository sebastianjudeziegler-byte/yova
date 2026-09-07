import {
  BarList,
  DashboardError,
  DashboardGrid,
  DashboardNote,
  DashboardPanel,
  DataRows,
  FounderPageHeader,
  FunnelList,
  MetricCard,
  MetricGrid,
  TrendChart,
  formatNumber,
  formatPercent,
  humanize,
} from "@/components/founder-dashboard";
import {
  FounderProductAnalyticsSchema,
  parseFounderAnalyticsWindow,
} from "@/lib/founder/analytics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function FounderOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = parseFounderAnalyticsWindow((await searchParams).days);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("founder_product_analytics", { window_days: days });
  const parsed = FounderProductAnalyticsSchema.safeParse(data);

  if (error || !parsed.success) {
    if (error) console.error("YOVA founder product analytics failed", { code: error.code ?? "unknown" });
    return <DashboardError title="Product analytics unavailable" body="Apply the founder analytics database migration, then reload this page." />;
  }

  const analytics = parsed.data;
  const { summary } = analytics;

  return (
    <>
      <FounderPageHeader
        eyebrow="Founder overview"
        title="How YOVA is being used"
        description="A private view of account activation, meaningful product use, study completion, and operational signals. Founder activity is excluded."
        windowDays={days}
        route="/founder/overview"
      />

      <MetricGrid>
        <MetricCard label="Engaged learners" value={formatNumber(summary.engagedUsers)} detail={`Meaningful product activity in the last ${days} days`} tone="primary" />
        <MetricCard label="New accounts" value={formatNumber(summary.newAccounts)} detail={`${formatNumber(summary.totalAccounts)} retained learner accounts in total`} />
        <MetricCard label="Sessions completed" value={formatNumber(summary.sessionsCompleted)} detail={`${formatPercent(summary.sessionCompletionRate)} terminal completion rate`} />
        <MetricCard label="Measured study time" value={formatStudyTime(summary.studyMinutes)} detail="Completed session minutes only" />
      </MetricGrid>

      <DashboardGrid>
        <DashboardPanel eyebrow="Daily movement" title="Learner activity over time" description="Exact totals are shown above. The chart shows how activity moved day by day in UTC.">
          <TrendChart
            data={analytics.daily}
            series={[
              { key: "engagedUsers", label: "Engaged learners", color: "#346bff" },
              { key: "sessionsCompleted", label: "Completed sessions", color: "#7a5cff" },
              { key: "newAccounts", label: "New accounts", color: "#16a466" },
            ]}
          />
        </DashboardPanel>
        <DashboardPanel eyebrow="Activation" title="New-account funnel" description="Accounts created in this window and the furthest product milestone they have reached so far.">
          <FunnelList items={analytics.cohortFunnel.map((item) => ({ label: item.label, count: item.count }))} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Product depth" title="What healthy use looks like" description="Use these signals together. No single count tells the full story.">
          <DataRows rows={[
            { label: "Onboarding completion", value: formatPercent(summary.onboardingRate), detail: "New-account cohort" },
            { label: "Returning engaged learners", value: formatNumber(summary.returningUsers), detail: "Active in this and the prior equal window" },
            { label: "Plans created", value: formatNumber(summary.plansCreated), detail: `${formatNumber(summary.activePlans)} plans are active now` },
            { label: "New session starts", value: formatNumber(summary.sessionStarts), detail: `${formatNumber(summary.resumedSessions)} resumed starts counted separately` },
            { label: "Session felt about right", value: formatPercent(summary.sessionFitRate), detail: "Completed sessions with about-right feedback" },
            { label: "Tutor questions", value: formatNumber(summary.tutorQuestions), detail: "Questions sent by learners" },
          ]} />
        </DashboardPanel>
        <DashboardPanel eyebrow="Operations" title="What may need attention" description="Product errors and support are separated from engagement so growth does not hide reliability problems.">
          <DataRows rows={[
            { label: "Product errors", value: formatNumber(summary.productErrors), detail: `${formatNumber(summary.errorAffectedUsers)} affected learners`, accent: summary.productErrors > 0 ? "warn" : "good" },
            { label: "Open support requests", value: formatNumber(summary.openSupportRequests), detail: "Current total, open or in progress", accent: summary.openSupportRequests > 0 ? "warn" : "good" },
          ]} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Devices" title="Where product activity happens" description="A broad category only. One learner can appear in more than one category, and YOVA does not store raw browser fingerprints.">
          <BarList items={analytics.deviceBreakdown.map((item) => ({ label: humanize(item.device), value: item.count, displayValue: `${formatNumber(item.count)} learners` }))} />
        </DashboardPanel>
        <DashboardPanel eyebrow="Events" title="Meaningful actions recorded" description="Client events are best-effort and are used for direction, not billing-grade accounting.">
          <BarList items={analytics.eventBreakdown.map((item) => ({ label: humanize(item.eventName), value: item.count, detail: `${formatNumber(item.users)} learners` })).slice(0, 10)} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardNote>
        YOVA does not currently record app opens or historical sign-ins, so this dashboard uses the honest label “engaged learners” instead of DAU or WAU. Device reporting begins with this analytics release, so older events appear as Unknown.
      </DashboardNote>
    </>
  );
}

function formatStudyTime(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours.toLocaleString("en-US")} hr`;
}

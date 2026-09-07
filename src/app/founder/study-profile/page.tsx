import {
  AcquisitionRows,
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
  FounderStudyProfileAnalyticsSchema,
  parseFounderAnalyticsWindow,
} from "@/lib/founder/analytics";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const QUESTION_LABELS = [
  "Q1: Starting on time",
  "Q2: Starting difficult work",
  "Q3: Handling ambiguity",
  "Q4: Planning a busy week",
  "Q5: Sustaining attention",
  "Q6: Recovering attention",
  "Q7: Preparing for a test",
  "Q8: Confidence calibration",
  "Q9: Committing before checking",
  "Q10: Finishing imperfect work",
  "Q11: Cognitive stamina",
  "Q12: Time-of-day effects",
  "Q13: Study goal",
  "Q14: Study context",
] as const;

const AUDIENCE_LABELS: Record<string, string> = {
  starting_friction: "Starting friction",
  structure_need: "Structure need",
  attention_variability: "Attention variability",
  calibration_risk: "Calibration risk",
  mistake_sensitivity: "Mistake sensitivity",
  cognitive_stamina: "Cognitive stamina",
  high_school: "High school",
  college: "College",
  other: "Other",
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late night",
  varies: "Varies",
};

export default async function FounderStudyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = parseFounderAnalyticsWindow((await searchParams).days);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("founder_study_profile_analytics", { window_days: days });
  const parsed = FounderStudyProfileAnalyticsSchema.safeParse(data);

  if (error || !parsed.success) {
    if (error) console.error("YOVA founder Study Profile analytics failed", { code: error.code ?? "unknown" });
    return <DashboardError title="Study Profile analytics unavailable" body="Apply the founder analytics database migration, then reload this page." />;
  }

  const analytics = parsed.data;
  const { summary, rates } = analytics;

  return (
    <>
      <FounderPageHeader
        eyebrow="Lead magnet analytics"
        title="Study Profile performance"
        description="See where visitors continue, where they stop, which sources unlock reports, and how many people confirm the YOVA waitlist."
        windowDays={days}
        route="/founder/study-profile"
      />

      <MetricGrid>
        <MetricCard label="Tracked visits" value={formatNumber(summary.trackedVisits)} detail={`${formatNumber(summary.pageViews)} page-view events`} tone="primary" />
        <MetricCard label="Quiz started" value={formatNumber(summary.started)} detail={`${formatPercent(rates.visitToStart)} of tracked visits`} />
        <MetricCard label="Reports unlocked" value={formatNumber(summary.reportUnlocks)} detail={`${formatPercent(rates.completeToUnlock)} of completed journeys`} />
        <MetricCard label="Confirmed waitlist" value={formatNumber(summary.confirmedWaitlist)} detail={`${formatNumber(summary.reportWaitlist)} came through the report flow`} />
      </MetricGrid>

      <DashboardGrid>
        <DashboardPanel eyebrow="Daily movement" title="Funnel activity over time" description="The report and waitlist totals use authoritative database records. Visit and step activity is best-effort telemetry.">
          <TrendChart
            data={analytics.daily}
            series={[
              { key: "trackedVisits", label: "Tracked visits", color: "#346bff" },
              { key: "completed", label: "Quiz completions", color: "#7a5cff" },
              { key: "reportUnlocks", label: "Report unlocks", color: "#16a466" },
              { key: "confirmedWaitlist", label: "Confirmed waitlist", color: "#f59e0b" },
            ]}
          />
        </DashboardPanel>
        <DashboardPanel eyebrow="Conversion" title="Visitor funnel" description="A visit is one tracked browser journey. It is not a persistent person across reloads or devices.">
          <FunnelList items={[
            { label: "Tracked visits", count: summary.trackedVisits },
            { label: "Quiz started", count: summary.started },
            { label: "Quiz completed", count: summary.completed },
            { label: "Report unlocked", count: summary.reportUnlocks },
            { label: "Report-flow waitlist confirmed", count: summary.reportWaitlist },
          ]} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Question reach" title="Where people leave the quiz" description="Reach is measured against tracked quiz starts. A reload can begin a new journey, so use this as directional drop-off data.">
          <BarList
            maxValue={Math.max(1, summary.started)}
            items={analytics.questionReach.map((item) => ({
              label: QUESTION_LABELS[item.questionNumber - 1] ?? `Question ${item.questionNumber}`,
              value: item.answeredJourneys,
              displayValue: formatPercent(item.percentOfStarts),
              detail: item.dropFromPrevious > 0
                ? `${item.dropFromPrevious} fewer journeys than the prior step`
                : item.dropFromPrevious < 0
                  ? `${Math.abs(item.dropFromPrevious)} more journeys after reloads or repeats`
                  : "No measured drop from the prior step",
            }))}
          />
        </DashboardPanel>
        <DashboardPanel eyebrow="Conversion rates" title="The numbers to watch" description="Window-based rates can occasionally exceed 100% when a journey began before the selected date range.">
          <DataRows rows={[
            { label: "Visit to quiz start", value: formatPercent(rates.visitToStart) },
            { label: "Start to quiz completion", value: formatPercent(rates.startToComplete) },
            { label: "Completion to report unlock", value: formatPercent(rates.completeToUnlock) },
            { label: "Unlock to report view", value: formatPercent(rates.unlockToReportView) },
            { label: "Unique report leads to report-flow waitlist", value: formatPercent(rates.unlockToWaitlist) },
            { label: "Visit to any confirmed waitlist", value: formatPercent(rates.visitToWaitlist) },
            { label: "Unique report emails", value: formatNumber(summary.uniqueReportLeads), detail: `${formatNumber(summary.reportUnlocks)} total report unlocks` },
            { label: "Confirmation requests", value: formatNumber(summary.waitlistRequests), detail: "Email request attempts in this window" },
            { label: "Active confirmations pending", value: formatNumber(summary.pendingConfirmations), detail: "Unexpired requests across all time" },
            { label: "Lifetime confirmed waitlist", value: formatNumber(summary.lifetimeWaitlist) },
            { label: "Share taps", value: formatNumber(summary.shareTaps) },
          ]} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardPanel eyebrow="Attribution" title="Where report demand comes from" description="First-touch source, medium, and campaign values captured by YOVA. Direct traffic appears separately.">
        <AcquisitionRows rows={analytics.acquisition} />
      </DashboardPanel>

      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Audience" title="Most common study patterns" description="Latest report per email in this date range, grouped without exposing individual quiz answers.">
          <BarList items={analytics.audience.patterns.map((item) => ({ label: audienceLabel(item.key), value: item.count, displayValue: formatPercent(item.percent) }))} />
        </DashboardPanel>
        <DashboardPanel eyebrow="Audience" title="School level and energy window" description="Useful for product decisions and messaging, not for diagnosing learners.">
          <BarList items={[
            ...analytics.audience.schoolLevels.map((item) => ({ label: `School: ${audienceLabel(item.key)}`, value: item.count, displayValue: formatPercent(item.percent) })),
            ...analytics.audience.energyWindows.map((item) => ({ label: `Energy: ${audienceLabel(item.key)}`, value: item.count, displayValue: formatPercent(item.percent) })),
          ]} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Devices" title="Where visitors take the quiz" description="Only a broad device category is saved. Raw browser user agents are discarded.">
          <BarList items={analytics.deviceBreakdown.map((item) => ({ label: humanize(item.device), value: item.count, displayValue: `${formatNumber(item.count)} visits` }))} />
        </DashboardPanel>
        <DashboardPanel eyebrow="Email health" title="Report and confirmation delivery" description="Failures here directly reduce how many people reach their report or confirm the waitlist.">
          <DataRows rows={[
            { label: "Report emails sent", value: formatNumber(analytics.delivery.reportSent), accent: "good" },
            { label: "Report emails failed", value: formatNumber(analytics.delivery.reportFailed), accent: analytics.delivery.reportFailed > 0 ? "warn" : "good" },
            { label: "Report emails pending", value: formatNumber(analytics.delivery.reportPending), accent: analytics.delivery.reportPending > 0 ? "warn" : "muted" },
            { label: "Report emails skipped", value: formatNumber(analytics.delivery.reportSkipped), accent: analytics.delivery.reportSkipped > 0 ? "warn" : "muted" },
            { label: "Confirmation emails sent", value: formatNumber(analytics.delivery.confirmationSent), accent: "good" },
            { label: "Confirmation emails failed", value: formatNumber(analytics.delivery.confirmationFailed), accent: analytics.delivery.confirmationFailed > 0 ? "warn" : "good" },
            { label: "Confirmation emails pending", value: formatNumber(analytics.delivery.confirmationPending), accent: analytics.delivery.confirmationPending > 0 ? "warn" : "muted" },
          ]} />
        </DashboardPanel>
      </DashboardGrid>

      <DashboardNote>
        Report unlocks and confirmed waitlist joins are authoritative. Page, question, report-view, and share events are deliberately best effort so analytics can never interrupt the quiz. Device reporting begins with this release, so earlier traffic appears as Unknown.
      </DashboardNote>
    </>
  );
}

function audienceLabel(key: string) {
  return AUDIENCE_LABELS[key] ?? humanize(key);
}

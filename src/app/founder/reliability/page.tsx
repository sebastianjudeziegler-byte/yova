import { z } from "zod";
import {
  BarList,
  DashboardError,
  DashboardGrid,
  DashboardPanel,
  DataRows,
  FounderPageHeader,
  MetricCard,
  MetricGrid,
} from "@/components/founder-dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ReliabilitySummarySchema = z.object({
  windowDays: z.number(),
  totalGenerations: z.number(),
  planGenerations: z.number(),
  sessionGenerations: z.number(),
  safeStudyRecoveryAttempts: z.number(),
  safeStudyRecoverySuccesses: z.number(),
  firstPassRate: z.coerce.number(),
  postRepairSuccessRate: z.coerce.number(),
  p50LatencyMs: z.coerce.number(),
  p95LatencyMs: z.coerce.number(),
  topFailingValidators: z.array(z.object({
    validator: z.string(),
    failures: z.number(),
  })),
});

export default async function FounderReliabilityPage() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("founder_generation_reliability", { window_days: 30 });
  const parsed = ReliabilitySummarySchema.safeParse(data);

  if (error || !parsed.success) {
    return <DashboardError title="Reliability analytics unavailable" body="This private dashboard could not load generation telemetry right now." />;
  }

  const summary = parsed.data;

  return (
    <>
      <FounderPageHeader
        eyebrow="Production quality"
        title="Generation reliability"
        description={`Plan and session generations from the last ${summary.windowDays} days. No learner content is stored in this telemetry.`}
      />
      <MetricGrid>
        <MetricCard label="First attempt passed" value={`${summary.firstPassRate}%`} detail="Passed every validator without repair" tone="primary" />
        <MetricCard label="Succeeded after repair" value={`${summary.postRepairSuccessRate}%`} detail="Of generations that needed one repair" />
        <MetricCard label="Typical latency" value={formatDuration(summary.p50LatencyMs)} detail="p50 total generation time" />
        <MetricCard label="Slow-end latency" value={formatDuration(summary.p95LatencyMs)} detail="p95 total generation time" />
      </MetricGrid>
      <DashboardGrid balanced>
        <DashboardPanel eyebrow="Production volume" title={`${summary.totalGenerations} generations`} description="Validated generation attempts recorded in production.">
          <DataRows rows={[
            { label: "Plans", value: String(summary.planGenerations) },
            { label: "Sessions", value: String(summary.sessionGenerations) },
            { label: "Safe study recoveries", value: `${summary.safeStudyRecoverySuccesses}/${summary.safeStudyRecoveryAttempts}`, detail: "Successful recoveries over attempts" },
          ]} />
        </DashboardPanel>
        <DashboardPanel eyebrow="Validation" title="What needs attention" description="The most frequent validator failures in this window.">
          <BarList items={summary.topFailingValidators.map((item) => ({ label: formatValidator(item.validator), value: item.failures }))} />
        </DashboardPanel>
      </DashboardGrid>
    </>
  );
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} sec`;
}

function formatValidator(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

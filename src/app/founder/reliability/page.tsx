import { z } from "zod";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ReliabilitySummarySchema = z.object({
  windowDays: z.number(),
  totalGenerations: z.number(),
  planGenerations: z.number(),
  sessionGenerations: z.number(),
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
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <FounderMessage title="Sign in first" body="Use your YOVA founder account, then reopen this page." />;
  }

  const { data, error } = await supabase.rpc("founder_generation_reliability", { window_days: 30 });
  const parsed = ReliabilitySummarySchema.safeParse(data);

  if (error || !parsed.success) {
    return <FounderMessage title="Founder access required" body="This dashboard is private. Add this signed-in account to YOVA's founder allowlist after applying the database migration." />;
  }

  const summary = parsed.data;

  return (
    <main className="founder-reliability-shell">
      <header>
        <BrandMark />
        <div><span>FOUNDER VIEW</span><h1>Generation reliability</h1><p>Production plan and session generations from the last {summary.windowDays} days. No learner content is stored here.</p></div>
        <Link href="/founder/testers">Testers</Link>
      </header>
      <section className="founder-metric-grid" aria-label="Generation reliability summary">
        <Metric label="First attempt passed" value={`${summary.firstPassRate}%`} detail="Passed every validator without repair" primary />
        <Metric label="Succeeded after repair" value={`${summary.postRepairSuccessRate}%`} detail="Of generations that needed one repair" />
        <Metric label="Typical latency" value={formatDuration(summary.p50LatencyMs)} detail="p50 total generation time" />
        <Metric label="Slow-end latency" value={formatDuration(summary.p95LatencyMs)} detail="p95 total generation time" />
      </section>
      <section className="founder-reliability-details">
        <article>
          <span>PRODUCTION VOLUME</span>
          <h2>{summary.totalGenerations} generations</h2>
          <div><p><strong>{summary.planGenerations}</strong> plans</p><p><strong>{summary.sessionGenerations}</strong> sessions</p></div>
        </article>
        <article>
          <span>TOP FAILING VALIDATORS</span>
          <h2>What needs attention</h2>
          {summary.topFailingValidators.length ? <ol>{summary.topFailingValidators.map((item) => <li key={item.validator}><strong>{formatValidator(item.validator)}</strong><span>{item.failures} {item.failures === 1 ? "failure" : "failures"}</span></li>)}</ol> : <p className="founder-empty-metric">No validation failures have been recorded in this window.</p>}
        </article>
      </section>
    </main>
  );
}

function Metric({ label, value, detail, primary = false }: { label: string; value: string; detail: string; primary?: boolean }) {
  return <article className={primary ? "primary" : ""}><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>;
}

function FounderMessage({ title, body }: { title: string; body: string }) {
  return <main className="founder-reliability-shell centered"><BrandMark /><section><h1>{title}</h1><p>{body}</p><Link href="/">Return to YOVA</Link></section></main>;
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(1)} sec`;
}

function formatValidator(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, CircleAlert, DatabaseZap } from "lucide-react";
import { FOUNDER_ANALYTICS_WINDOWS, type FounderAnalyticsWindow } from "@/lib/founder/analytics";
import styles from "@/components/founder-dashboard.module.css";

export function FounderPageHeader({
  eyebrow,
  title,
  description,
  windowDays,
  route,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  windowDays?: FounderAnalyticsWindow;
  route?: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <span className={styles.kicker}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {windowDays && route ? (
        <DateWindowNav active={windowDays} route={route} />
      ) : children}
    </header>
  );
}

export function DateWindowNav({ active, route }: { active: FounderAnalyticsWindow; route: string }) {
  return (
    <nav className={styles.windowNav} aria-label="Analytics date range">
      {FOUNDER_ANALYTICS_WINDOWS.map((days) => (
        <Link
          className={active === days ? styles.windowActive : undefined}
          href={`${route}?days=${days}`}
          aria-current={active === days ? "page" : undefined}
          key={days}
        >
          {days} days
        </Link>
      ))}
    </nav>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <section className={styles.metricGrid}>{children}</section>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "primary" | "warning";
}) {
  const toneClass = tone === "default" ? "" : styles[tone];
  return (
    <article className={`${styles.metricCard} ${toneClass}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

export function DashboardGrid({ children, balanced = false }: { children: ReactNode; balanced?: boolean }) {
  return <div className={balanced ? styles.dashboardGridBalanced : styles.dashboardGrid}>{children}</div>;
}

export function DashboardPanel({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ""}`}>
      <header className={styles.panelHeader}>
        <div>
          {eyebrow ? <span className={styles.kicker}>{eyebrow}</span> : null}
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export type BarDatum = {
  label: string;
  value: number;
  detail?: string;
  displayValue?: string;
};

export function BarList({ items, maxValue }: { items: BarDatum[]; maxValue?: number }) {
  const maximum = maxValue ?? Math.max(1, ...items.map((item) => item.value));

  if (!items.length) return <EmptyState label="No activity in this date range" />;

  return (
    <ol className={styles.barList}>
      {items.map((item) => (
        <li key={`${item.label}-${item.detail ?? ""}`}>
          <div className={styles.barLabel}>
            <span>{item.label}</span>
            <strong>{item.displayValue ?? item.value.toLocaleString()}</strong>
          </div>
          <span className={styles.barTrack} aria-hidden="true">
            <span style={{ width: `${Math.max(item.value > 0 ? 2 : 0, Math.min(100, (item.value / maximum) * 100))}%` }} />
          </span>
          {item.detail ? <small>{item.detail}</small> : null}
        </li>
      ))}
    </ol>
  );
}

type TrendPoint = { date: string } & Record<string, string | number>;
type TrendSeries = { key: string; label: string; color: string };

export function TrendChart({ data, series }: { data: TrendPoint[]; series: TrendSeries[] }) {
  if (!data.length) return <EmptyState label="No trend data in this date range" />;

  const width = 760;
  const height = 240;
  const left = 18;
  const right = 18;
  const top = 20;
  const bottom = 36;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.flatMap((point) => series.map((item) => Number(point[item.key]) || 0));
  const maximum = Math.max(1, ...values);
  const x = (index: number) => left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const y = (value: number) => top + plotHeight - (value / maximum) * plotHeight;
  const labelIndexes = Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  return (
    <div className={styles.trendWrap}>
      <div className={styles.trendLegend}>
        {series.map((item) => (
          <span key={item.key}><i style={{ background: item.color }} />{item.label}<strong>{data.reduce((sum, point) => sum + (Number(point[item.key]) || 0), 0).toLocaleString()}</strong></span>
        ))}
      </div>
      <svg
        className={styles.trendChart}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${series.map((item) => item.label).join(", ")} by day`}
      >
        {[0, .25, .5, .75, 1].map((step) => (
          <line
            x1={left}
            x2={width - right}
            y1={top + plotHeight * step}
            y2={top + plotHeight * step}
            className={styles.gridLine}
            key={step}
          />
        ))}
        {series.map((item) => {
          const points = data.map((point, index) => `${x(index)},${y(Number(point[item.key]) || 0)}`).join(" ");
          return <polyline points={points} fill="none" stroke={item.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" key={item.key} />;
        })}
        {labelIndexes.map((index) => (
          <text x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"} key={index}>
            {formatChartDate(data[index]?.date ?? "")}
          </text>
        ))}
      </svg>
      <table className={styles.visuallyHidden}>
        <caption>Daily values for {series.map((item) => item.label).join(", ")}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((item) => <th scope="col" key={item.key}>{item.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <th scope="row">{point.date}</th>
              {series.map((item) => <td key={item.key}>{Number(point[item.key]) || 0}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FunnelList({ items }: { items: Array<{ label: string; count: number }> }) {
  const maximum = Math.max(1, items[0]?.count ?? 0, ...items.map((item) => item.count));

  return (
    <ol className={styles.funnelList}>
      {items.map((item, index) => {
        const previous = index > 0 ? items[index - 1]?.count ?? 0 : 0;
        const conversion = index === 0 ? 100 : previous > 0 ? Math.round((item.count / previous) * 1_000) / 10 : 0;
        return (
          <li key={item.label}>
            <div><span>{item.label}</span><strong>{item.count.toLocaleString()}</strong></div>
            <span className={styles.funnelTrack} aria-hidden="true"><span style={{ width: `${Math.max(item.count > 0 ? 3 : 0, (item.count / maximum) * 100)}%` }} /></span>
            <small>{index === 0 ? "Starting cohort" : `${conversion}% from the prior step`}</small>
          </li>
        );
      })}
    </ol>
  );
}

export function DataRows({
  rows,
  emptyLabel = "No data in this date range",
}: {
  rows: Array<{ label: string; value: string; detail?: string; accent?: "good" | "warn" | "muted" }>;
  emptyLabel?: string;
}) {
  if (!rows.length) return <EmptyState label={emptyLabel} />;

  return (
    <div className={styles.dataRows}>
      {rows.map((row) => (
        <div key={`${row.label}-${row.detail ?? ""}`}>
          <div><strong>{row.label}</strong>{row.detail ? <span>{row.detail}</span> : null}</div>
          <b className={row.accent ? styles[row.accent] : undefined}>{row.value}</b>
        </div>
      ))}
    </div>
  );
}

export function AcquisitionRows({
  rows,
}: {
  rows: Array<{
    source: string;
    medium: string;
    campaign: string;
    visits: number;
    started: number;
    completed: number;
    reportUnlocks: number;
    confirmedWaitlist: number;
  }>;
}) {
  if (!rows.length) return <EmptyState label="No attributed traffic in this date range" />;

  return (
    <div className={styles.acquisitionRows}>
      {rows.map((row, index) => (
        <article key={`${row.source}-${row.medium}-${row.campaign}-${index}`}>
          <div className={styles.acquisitionIdentity}>
            <strong>{humanize(row.source)}</strong>
            <span>{humanize(row.medium)} · {humanize(row.campaign)}</span>
          </div>
          <dl>
            <div><dt>Visits</dt><dd>{row.visits}</dd></div>
            <div><dt>Started</dt><dd>{row.started}</dd></div>
            <div><dt>Finished</dt><dd>{row.completed}</dd></div>
            <div><dt>Reports</dt><dd>{row.reportUnlocks}</dd></div>
            <div><dt>Waitlist</dt><dd>{row.confirmedWaitlist}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function DashboardNote({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  return (
    <aside className={`${styles.note} ${tone === "warning" ? styles.noteWarning : ""}`}>
      {tone === "warning" ? <CircleAlert size={20} /> : <DatabaseZap size={20} />}
      <p>{children}</p>
    </aside>
  );
}

export function DashboardError({ title, body }: { title: string; body: string }) {
  return (
    <section className={styles.errorState}>
      <span><BarChart3 size={24} /></span>
      <h1>{title}</h1>
      <p>{body}</p>
      <Link href="/">Return to YOVA <ArrowRight size={17} /></Link>
    </section>
  );
}

export function EmptyState({ label }: { label: string }) {
  return <p className={styles.emptyState}>{label}</p>;
}

export function humanize(value: string) {
  if (value === "(none)") return "No campaign";
  if (value === "direct") return "Direct";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export function formatPercent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function formatChartDate(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

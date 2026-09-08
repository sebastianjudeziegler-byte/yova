"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Mail,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { AccessibleModalDialog } from "@/components/accessible-modal-dialog";
import { MetricCard, MetricGrid, humanize } from "@/components/founder-dashboard";
import styles from "@/components/founder-dashboard.module.css";
import type {
  FounderPeopleDirectoryResponse,
  FounderPeopleDirectoryRow,
  FounderPeopleKindFilter,
  FounderPeopleStatusFilter,
} from "@/lib/founder/people";

const KIND_FILTERS: ReadonlyArray<{ value: FounderPeopleKindFilter; label: string }> = [
  { value: "all", label: "All people" },
  { value: "accounts", label: "YOVA accounts" },
  { value: "leads", label: "Study Profile leads" },
  { value: "waitlist", label: "Waitlist" },
  { value: "testers", label: "Testers" },
];

const STATUS_FILTERS: ReadonlyArray<{ value: FounderPeopleStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "onboarding_incomplete", label: "Onboarding incomplete" },
  { value: "report_unlocked", label: "Report unlocked" },
  { value: "confirmation_pending", label: "Confirmation pending" },
  { value: "waitlist_confirmed", label: "Waitlist confirmed" },
  { value: "email_failed", label: "Email failed" },
];

type AppliedFilters = {
  search: string;
  kind: FounderPeopleKindFilter;
  status: FounderPeopleStatusFilter;
};

type RequestState = "filter" | "more" | "export" | null;

export function FounderPeopleDirectory({
  initialData,
}: {
  initialData: FounderPeopleDirectoryResponse;
}) {
  const [directory, setDirectory] = useState(initialData);
  const [searchInput, setSearchInput] = useState("");
  const [kindInput, setKindInput] = useState<FounderPeopleKindFilter>("all");
  const [statusInput, setStatusInput] = useState<FounderPeopleStatusFilter>("all");
  const [applied, setApplied] = useState<AppliedFilters>({ search: "", kind: "all", status: "all" });
  const [requestState, setRequestState] = useState<RequestState>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<FounderPeopleDirectoryRow | null>(null);
  const busy = requestState !== null;

  const submitFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextFilters = {
      search: searchInput.trim(),
      kind: kindInput,
      status: statusInput,
    } satisfies AppliedFilters;
    setApplied(nextFilters);
    setSelectedPerson(null);
    await queryDirectory(nextFilters, false);
  };

  const resetFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const nextFilters = { search: "", kind: "all", status: "all" } satisfies AppliedFilters;
    setSearchInput("");
    setKindInput("all");
    setStatusInput("all");
    setApplied(nextFilters);
    setSelectedPerson(null);
    await queryDirectory(nextFilters, false);
  };

  const queryDirectory = async (filters: AppliedFilters, append: boolean) => {
    setRequestState(append ? "more" : "filter");
    setIssue(null);

    try {
      const response = await fetch("/api/founder/people/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...filters,
          cursor: append ? directory.nextCursor : null,
          limit: 25,
        }),
      });
      const payload = await readJsonResponse(response);

      if (!response.ok || !isDirectoryResponse(payload)) {
        throw new Error(messageForResponse(response.status, payload));
      }

      setDirectory((current) => ({
        ...payload,
        rows: append ? mergeDirectoryRows(current.rows, payload.rows) : payload.rows,
      }));
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "YOVA could not load this directory. Try again.");
    } finally {
      setRequestState(null);
    }
  };

  const exportDirectory = async () => {
    if (busy) return;
    setRequestState("export");
    setIssue(null);

    try {
      const response = await fetch("/api/founder/people/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applied),
      });
      if (!response.ok) {
        const payload = await readJsonResponse(response);
        throw new Error(messageForResponse(response.status, payload));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `yova-users-and-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : "YOVA could not prepare the CSV. Try again.");
    } finally {
      setRequestState(null);
    }
  };

  const loadedCount = directory.rows.length;
  const hasFilters = applied.search !== "" || applied.kind !== "all" || applied.status !== "all";
  const hasDraftFilters = searchInput.trim() !== "" || kindInput !== "all" || statusInput !== "all";

  return (
    <div className={styles.peopleDirectory}>
      <MetricGrid>
        <MetricCard
          label="Unique people"
          value={directory.summary.uniquePeople.toLocaleString()}
          detail="Current emails are counted once across YOVA and Study Profile"
          tone="primary"
        />
        <MetricCard
          label="YOVA accounts"
          value={directory.summary.yovaAccounts.toLocaleString()}
          detail="Founder accounts are excluded"
        />
        <MetricCard
          label="Study Profile leads"
          value={directory.summary.studyProfileLeads.toLocaleString()}
          detail="Report and landing-page email records"
        />
        <MetricCard
          label="Confirmed waitlist"
          value={directory.summary.confirmedWaitlist.toLocaleString()}
          detail={`${directory.summary.pendingInvites.toLocaleString()} tester invitations still pending`}
        />
      </MetricGrid>

      <section className={styles.peoplePanel} aria-labelledby="people-directory-title">
        <header className={styles.peoplePanelHeader}>
          <div>
            <span className={styles.kicker}>Private directory</span>
            <h2 id="people-directory-title">Contact and account records</h2>
            <p>Search operational records without putting an email address in the page URL.</p>
          </div>
          <button
            className={`button secondary ${styles.peopleExport}`}
            type="button"
            onClick={() => void exportDirectory()}
            disabled={busy}
          >
            <ArrowDownToLine size={18} aria-hidden="true" />
            {requestState === "export" ? "Preparing CSV" : "Export current view"}
          </button>
        </header>

        <form
          className={styles.peopleFilters}
          onSubmit={(event) => void submitFilters(event)}
          onReset={(event) => void resetFilters(event)}
          aria-label="Filter users and leads"
        >
          <label className={styles.peopleSearch}>
            <span>Search email or name</span>
            <span className={styles.peopleInputWrap}>
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="student@example.com"
                autoComplete="off"
                spellCheck={false}
                maxLength={120}
                disabled={busy}
              />
            </span>
          </label>
          <label>
            <span>Record type</span>
            <select
              value={kindInput}
              onChange={(event) => setKindInput(event.target.value as FounderPeopleKindFilter)}
              disabled={busy}
            >
              {KIND_FILTERS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={statusInput}
              onChange={(event) => setStatusInput(event.target.value as FounderPeopleStatusFilter)}
              disabled={busy}
            >
              {STATUS_FILTERS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className={styles.peopleFilterActions}>
            <button className={`button primary ${styles.peopleFilterButton}`} type="submit" disabled={busy}>
              {requestState === "filter" ? "Loading" : "Apply filters"}
            </button>
            <button className={`button ghost ${styles.peopleFilterButton}`} type="reset" disabled={busy || (!hasFilters && !hasDraftFilters)}>
              Clear
            </button>
          </div>
        </form>

        <div className={styles.peopleResultBar} aria-live="polite">
          <p>
            <strong>{directory.total.toLocaleString()}</strong> {directory.total === 1 ? "person" : "people"} match
            {hasFilters ? " the current filters" : " this directory"}.
          </p>
          <span>{loadedCount.toLocaleString()} shown</span>
        </div>

        {issue ? (
          <div className={styles.peopleIssue} role="alert">
            <CircleAlert size={19} aria-hidden="true" />
            <p>{issue}</p>
          </div>
        ) : null}

        {directory.rows.length ? (
          <ul className={styles.peopleList} aria-busy={requestState === "filter" || requestState === "more"}>
            {directory.rows.map((person) => (
              <PersonRow person={person} onSelect={() => setSelectedPerson(person)} key={person.email} />
            ))}
          </ul>
        ) : (
          <div className={styles.peopleEmpty}>
            <UsersRound size={24} aria-hidden="true" />
            <p><strong>No people match these filters.</strong><span>Clear the filters or try a different email or name.</span></p>
          </div>
        )}

        {directory.hasMore && directory.nextCursor ? (
          <div className={styles.peoplePagination}>
            <button
              className={`button secondary ${styles.peopleLoadMore}`}
              type="button"
              onClick={() => void queryDirectory(applied, true)}
              disabled={busy}
            >
              {requestState === "more" ? "Loading more" : "Load more"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <p>{loadedCount.toLocaleString()} of {directory.total.toLocaleString()} shown</p>
          </div>
        ) : null}
      </section>

      <aside className={styles.peoplePermissionNote}>
        <Mail size={19} aria-hidden="true" />
        <p><strong>Email permission matters.</strong> A report email is transactional. Only people with a confirmed waitlist status have permission for YOVA launch marketing emails.</p>
      </aside>

      {selectedPerson ? (
        <PersonDetails person={selectedPerson} onDismiss={() => setSelectedPerson(null)} />
      ) : null}
    </div>
  );
}

function PersonRow({ person, onSelect }: { person: FounderPeopleDirectoryRow; onSelect: () => void }) {
  const headlineStatus = person.hasYovaAccount
    ? person.onboardingCompletedAt ? "Onboarding complete" : "Onboarding incomplete"
    : person.profileStatus === "report_unlocked" ? "Report unlocked"
      : person.kind === "tester" ? "Tester invite only" : "No report linked";

  return (
    <li className={styles.peopleRow}>
      <div className={styles.peopleIdentity}>
        <span className={styles.peopleAvatar} aria-hidden="true"><UserRound size={19} /></span>
        <div>
          {person.displayName ? <strong>{person.displayName}</strong> : null}
          <span>{person.email}</span>
          {person.matchBasis === "exact_normalized_email" ? <small>Matched by current email</small> : null}
        </div>
      </div>
      <div className={styles.peopleBadges} aria-label="Record types">
        {person.hasYovaAccount ? <StatusBadge label="YOVA account" tone="blue" /> : null}
        {person.hasStudyProfileLead ? <StatusBadge label="Study Profile" tone="violet" /> : null}
        {person.kind === "tester" ? <StatusBadge label="Tester invite" tone="neutral" /> : null}
        {person.waitlistConfirmationStatus === "pending" ? <StatusBadge label="Confirmation pending" tone="amber" /> : null}
        {person.waitlistStatus === "joined" ? <StatusBadge label="Waitlist confirmed" tone="green" /> : null}
      </div>
      <dl className={styles.peopleRowFacts}>
        <div><dt>Status</dt><dd>{headlineStatus}</dd></div>
        <div><dt>Latest activity</dt><dd><time dateTime={person.recentAt}>{formatDate(person.recentAt)}</time></dd></div>
        <div><dt>Campaign</dt><dd>{displayCampaign(person)}</dd></div>
      </dl>
      <button className={styles.peopleDetailsButton} type="button" onClick={onSelect} aria-label={`View details for ${person.email}`}>
        View details <ArrowRight size={17} aria-hidden="true" />
      </button>
    </li>
  );
}

function PersonDetails({ person, onDismiss }: { person: FounderPeopleDirectoryRow; onDismiss: () => void }) {
  const firstSeen = earliestTimestamp(person.accountCreatedAt, person.leadCreatedAt, person.invitedAt);
  const waitlistLabel = waitlistStatusLabel(person);

  return (
    <AccessibleModalDialog
      className={styles.peopleDialog}
      labelledBy="founder-person-title"
      describedBy="founder-person-description"
      onDismiss={onDismiss}
    >
      <section className={styles.peopleDialogCard}>
        <header className={styles.peopleDialogHeader}>
          <div>
            <span className={styles.kicker}>Private record</span>
            <h2 id="founder-person-title">{person.displayName || person.email}</h2>
            <p id="founder-person-description">Account, Study Profile, waitlist, and attribution details connected to this current email.</p>
          </div>
          <button data-modal-initial-focus type="button" onClick={onDismiss} aria-label="Close person details">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.peopleDetailBadges}>
          {person.hasYovaAccount ? <StatusBadge label="YOVA account" tone="blue" /> : null}
          {person.hasStudyProfileLead ? <StatusBadge label="Study Profile" tone="violet" /> : null}
          {person.inviteStatus === "pending" ? <StatusBadge label="Invite pending" tone="amber" /> : null}
          {person.waitlistStatus === "joined" ? <StatusBadge label="Waitlist confirmed" tone="green" /> : null}
        </div>

        <div className={styles.peopleDetailSections}>
          <DetailSection title="Identity">
            <DetailItem label="Email" value={person.email} />
            <DetailItem label="First recorded" value={formatDateTime(firstSeen)} dateTime={firstSeen} />
            <DetailItem label="Most recent activity" value={formatDateTime(person.recentAt)} dateTime={person.recentAt} />
            <DetailItem label="Record connection" value={person.matchBasis === "exact_normalized_email" ? "Matched by current email" : "Separate record"} />
          </DetailSection>

          <DetailSection title="YOVA account">
            <DetailItem label="Account" value={person.hasYovaAccount ? "Created" : "No account"} />
            <DetailItem label="Created" value={formatDateTime(person.accountCreatedAt)} dateTime={person.accountCreatedAt} />
            <DetailItem label="Email" value={person.emailConfirmedAt ? "Verified" : person.hasYovaAccount ? "Not verified" : "Not applicable"} />
            <DetailItem label="Onboarding" value={person.onboardingCompletedAt ? "Complete" : person.hasYovaAccount ? "Incomplete" : "Not applicable"} />
            <DetailItem label="Tester access" value={inviteStatusLabel(person.inviteStatus)} />
            <DetailItem label="Last sign-in" value={formatDateTime(person.lastSignInAt)} dateTime={person.lastSignInAt} />
            <DetailItem label="Last tracked product activity" value={formatDateTime(person.lastProductActivityAt)} dateTime={person.lastProductActivityAt} />
            <DetailItem label="Plans" value={person.plansCount.toLocaleString()} />
            <DetailItem label="Sessions completed" value={person.sessionsCompleted.toLocaleString()} />
            <DetailItem label="Measured study time" value={formatStudyTime(person.studyMinutes)} />
          </DetailSection>

          <DetailSection title="Study Profile">
            <DetailItem label="Profile status" value={person.profileStatus === "report_unlocked" ? "Report unlocked" : person.hasStudyProfileLead ? "No report linked" : "No Study Profile record"} />
            <DetailItem label="Reports unlocked" value={person.reportCount.toLocaleString()} />
            <DetailItem label="Latest report" value={formatDateTime(person.latestReportAt)} dateTime={person.latestReportAt} />
            <DetailItem label="Report viewed" value={formatDateTime(person.reportViewedAt)} dateTime={person.reportViewedAt} />
            <DetailItem label="Report email" value={emailStatusLabel(person.reportEmailStatus)} />
            <DetailItem label="Report email sent" value={formatDateTime(person.reportEmailSentAt)} dateTime={person.reportEmailSentAt} />
            <DetailItem label="School level" value={schoolLevelLabel(person.schoolLevel)} />
            <DetailItem label="Age group" value={ageBandLabel(person.ageBand)} />
            <DetailItem label="Primary pattern" value={person.primaryPattern ? humanize(person.primaryPattern) : "Not recorded"} />
            <DetailItem label="Energy window" value={person.energyWindow ? humanize(person.energyWindow) : "Not recorded"} />
          </DetailSection>

          <DetailSection title="Waitlist">
            <DetailItem label="Status" value={waitlistLabel} />
            <DetailItem label="Current launch email permission" value={person.waitlistStatus === "joined" ? "Confirmed" : "Not confirmed"} />
            <DetailItem label="Requested" value={formatDateTime(person.waitlistRequestedAt)} dateTime={person.waitlistRequestedAt} />
            <DetailItem label="Confirmed" value={formatDateTime(person.waitlistJoinedAt)} dateTime={person.waitlistJoinedAt} />
            <DetailItem label="Confirmation state" value={confirmationStatusLabel(person.waitlistConfirmationStatus)} />
            <DetailItem label="Confirmation email" value={emailStatusLabel(person.confirmationDeliveryStatus)} />
            <DetailItem label="Consent source" value={consentSourceLabel(person.waitlistConsentSource)} />
            <DetailItem label="Legacy marketing consent" value={formatDateTime(person.marketingConsentAt)} dateTime={person.marketingConsentAt} />
            <DetailItem label="Earlier beta interest" value={booleanLabel(person.betaInterest)} />
          </DetailSection>

          <DetailSection title="First-touch attribution">
            <DetailItem label="Source" value={fallbackText(person.source)} />
            <DetailItem label="Medium" value={fallbackText(person.medium)} />
            <DetailItem label="Campaign" value={fallbackText(person.campaign)} />
            <DetailItem label="Content" value={fallbackText(person.content)} />
            <DetailItem label="Term" value={fallbackText(person.term)} />
            <DetailItem label="Device" value={person.deviceType === "unknown" ? "Unknown" : humanize(person.deviceType)} />
            <DetailItem label="Meta click attached" value={person.hasMetaClick ? "Yes" : "No"} />
          </DetailSection>
        </div>

        <footer className={styles.peopleDialogFooter}>
          <p>Private operational data. Do not share or upload it without a clear business need.</p>
          <button className="button primary" type="button" onClick={onDismiss}>Close</button>
        </footer>
      </section>
    </AccessibleModalDialog>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.peopleDetailSection}>
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function DetailItem({ label, value, dateTime }: { label: string; value: string; dateTime?: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{dateTime ? <time dateTime={dateTime}>{value}</time> : value}</dd>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "blue" | "violet" | "green" | "amber" | "neutral" }) {
  const icon = tone === "green"
    ? <CheckCircle2 size={14} aria-hidden="true" />
    : tone === "amber" ? <Clock3 size={14} aria-hidden="true" /> : null;
  return <span className={`${styles.peopleBadge} ${styles[`peopleBadge${capitalize(tone)}`]}`}>{icon}{label}</span>;
}

function isDirectoryResponse(value: unknown): value is FounderPeopleDirectoryResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FounderPeopleDirectoryResponse>;
  return Array.isArray(candidate.rows)
    && typeof candidate.total === "number"
    && typeof candidate.hasMore === "boolean"
    && Boolean(candidate.summary);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageForResponse(status: number, payload: unknown) {
  if (status === 401 || status === 403) return "Your founder session could not be confirmed. Sign in again and retry.";
  if (status === 413) return "That directory request was too large.";
  if (status === 422) return "Check the search and filters, then try again.";
  if (payload && typeof payload === "object" && "error" in payload) {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.length <= 180) return message;
  }
  return "YOVA could not load this private directory. Try again.";
}

function mergeDirectoryRows(current: FounderPeopleDirectoryRow[], incoming: FounderPeopleDirectoryRow[]) {
  const byEmail = new Map(current.map((person) => [person.email, person]));
  for (const person of incoming) byEmail.set(person.email, person);
  return [...byEmail.values()];
}

function displayCampaign(person: FounderPeopleDirectoryRow) {
  if (person.campaign) return humanize(person.campaign);
  if (person.source) return humanize(person.source);
  return "No campaign";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatDateTime(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return `${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function earliestTimestamp(...values: Array<string | null>) {
  const valid = values.filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(value!)));
  return valid.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
}

function formatStudyTime(minutes: number) {
  if (minutes < 60) return `${minutes.toLocaleString()} min`;
  return `${(Math.round((minutes / 60) * 10) / 10).toLocaleString()} hr`;
}

function inviteStatusLabel(status: FounderPeopleDirectoryRow["inviteStatus"]) {
  if (status === "pending") return "Invitation pending";
  if (status === "joined") return "Joined testing cohort";
  return "No tester invitation";
}

function waitlistStatusLabel(person: FounderPeopleDirectoryRow) {
  if (person.waitlistStatus === "joined") return "Confirmed";
  if (person.waitlistConfirmationStatus === "pending") return "Confirmation pending";
  if (person.waitlistConfirmationStatus === "delivery_failed") return "Confirmation email failed";
  if (person.waitlistConfirmationStatus === "expired") return "Confirmation expired";
  if (person.waitlistConfirmationStatus === "superseded") return "Earlier request replaced";
  return "Not joined";
}

function confirmationStatusLabel(status: FounderPeopleDirectoryRow["waitlistConfirmationStatus"]) {
  if (!status) return "Not requested";
  if (status === "pending") return "Pending";
  if (status === "confirmed") return "Confirmed";
  if (status === "delivery_failed") return "Delivery failed";
  if (status === "expired") return "Expired";
  return "Replaced by a newer request";
}

function consentSourceLabel(source: FounderPeopleDirectoryRow["waitlistConsentSource"]) {
  if (source === "landing") return "Landing page";
  if (source === "email_gate") return "Report email form";
  if (source === "report_cta") return "Report page";
  return "Not recorded";
}

function emailStatusLabel(status: FounderPeopleDirectoryRow["reportEmailStatus"] | FounderPeopleDirectoryRow["confirmationDeliveryStatus"]) {
  if (!status) return "Not requested";
  if (status === "sent") return "Sent";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Pending";
}

function schoolLevelLabel(level: FounderPeopleDirectoryRow["schoolLevel"]) {
  if (level === "high_school") return "High school";
  if (level === "college") return "College";
  if (level === "other") return "Other";
  return "Not recorded";
}

function ageBandLabel(ageBand: FounderPeopleDirectoryRow["ageBand"]) {
  if (ageBand === "13_17") return "13 to 17";
  if (ageBand === "18_plus") return "18 or older";
  return "Unknown";
}

function booleanLabel(value: boolean | null) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not recorded";
}

function fallbackText(value: string | null) {
  return value ? humanize(value) : "Not recorded";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

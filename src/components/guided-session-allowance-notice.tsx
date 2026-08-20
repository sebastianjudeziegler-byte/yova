import { Clock3 } from "lucide-react";
import {
  formatGuidedSessionAllowanceReset,
  type GuidedSessionAllowanceState,
  type GuidedSessionAllowanceUnavailableState,
} from "@/lib/session-generation/allowance-status";

export type GuidedSessionAllowanceDisplayState =
  | GuidedSessionAllowanceState
  | GuidedSessionAllowanceUnavailableState;

export function guidedSessionAllowanceBlocksNewStart(
  allowance: GuidedSessionAllowanceDisplayState,
  hasSavedSession = false,
  checking = false,
) {
  if (hasSavedSession) return false;
  if (checking) return true;
  return allowance.kind === "exhausted" || allowance.kind === "temporarily_limited";
}

export function guidedSessionStartLabel(
  allowance: GuidedSessionAllowanceDisplayState,
  defaultLabel: string,
  hasSavedSession = false,
  checking = false,
) {
  if (hasSavedSession) return defaultLabel;
  if (checking) return "Checking allowance…";
  if (allowance.kind === "exhausted") return "Allowance used today";
  if (allowance.kind === "temporarily_limited") return "Available after the short pause";
  return defaultLabel;
}

export function GuidedSessionAllowanceNotice({
  allowance,
  surface,
  checking = false,
}: {
  allowance: GuidedSessionAllowanceDisplayState;
  surface: "home" | "agenda";
  checking?: boolean;
}) {
  if (allowance.kind === "unavailable" && !checking) return null;

  if (checking && allowance.kind === "unavailable") {
    return <section
      className={`guided-session-allowance-notice checking ${surface}`}
      aria-label="Guided-session allowance"
      role="status"
    >
      <span className="guided-session-allowance-icon" aria-hidden="true"><Clock3 size={18} /></span>
      <div>
        <span>GUIDED SESSION ALLOWANCE</span>
        <strong>Checking today&apos;s guided-session allowance</strong>
        <p>New session starts will be available as soon as this private server check finishes.</p>
      </div>
    </section>;
  }

  const resetLabel = formatGuidedSessionAllowanceReset(allowance.resetAt);
  const heading = allowance.kind === "available"
    ? `${allowance.remainingToday} guided ${allowance.remainingToday === 1 ? "session" : "sessions"} available today`
    : allowance.kind === "temporarily_limited"
      ? "Guided-session preparation is briefly paused"
      : "Daily guided-session allowance used";
  const detail = allowance.kind === "available"
    ? "YOVA checks this server count again after preparing a guided session."
    : allowance.kind === "temporarily_limited"
      ? `${allowance.remainingToday} guided ${allowance.remainingToday === 1 ? "session remains" : "sessions remain"} today.`
      : "You can still continue a session that was already saved.";

  return <section
    className={`guided-session-allowance-notice ${allowance.kind} ${surface}`}
    aria-label="Guided-session allowance"
    role="status"
  >
    <span className="guided-session-allowance-icon" aria-hidden="true"><Clock3 size={18} /></span>
    <div>
      <span>GUIDED SESSION ALLOWANCE</span>
      <strong>{heading}</strong>
      <p>{detail}{resetLabel && <> New guided sessions are available after <time dateTime={allowance.resetAt ?? undefined}>{resetLabel}</time>.</>}</p>
    </div>
  </section>;
}

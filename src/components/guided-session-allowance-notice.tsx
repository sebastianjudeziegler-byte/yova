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
}: {
  allowance: GuidedSessionAllowanceDisplayState;
  surface: "home" | "agenda";
  checking?: boolean;
}) {
  if (allowance.kind !== "exhausted") return null;

  const resetLabel = formatGuidedSessionAllowanceReset(allowance.resetAt);

  return <section
    className={`guided-session-allowance-notice exhausted ${surface}`}
    aria-label="Guided-session allowance"
    role="status"
  >
    <span className="guided-session-allowance-icon" aria-hidden="true"><Clock3 size={18} /></span>
    <div>
      <span>GUIDED SESSION ALLOWANCE</span>
      <strong>Daily guided-session allowance used</strong>
      <p>You can still continue a session that was already saved.{resetLabel && <> New guided sessions are available after <time dateTime={allowance.resetAt}>{resetLabel}</time>.</>}</p>
    </div>
  </section>;
}

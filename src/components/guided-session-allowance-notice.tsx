import { Clock3 } from "lucide-react";
import {
  formatGuidedSessionAllowanceReset,
  type GuidedSessionAllowanceState,
  type GuidedSessionAllowanceUnavailableState,
} from "@/lib/session-generation/allowance-status";

export type GuidedSessionAllowanceDisplayState =
  | GuidedSessionAllowanceState
  | GuidedSessionAllowanceUnavailableState;

/** True when a new session may not start: at the limit, paused, or not yet checked. A saved session always may. */
export function guidedSessionAllowanceBlocksNewStart(
  allowance: GuidedSessionAllowanceDisplayState,
  hasSavedSession = false,
  checking = false,
) {
  if (hasSavedSession) return false;
  if (checking) return true;
  return allowance.kind === "exhausted" || allowance.kind === "temporarily_limited";
}

/**
 * The pre-session card's limit message, shown instead of Start (founder
 * decision, 16 Sept 2026). Nothing is shown below the limit, and never a count.
 */
export function AllowanceLimitMessage({ allowance }: { allowance: GuidedSessionAllowanceDisplayState }) {
  if (allowance.kind !== "exhausted" && allowance.kind !== "temporarily_limited") return null;
  const resetLabel = allowance.kind === "exhausted" ? formatGuidedSessionAllowanceReset(allowance.resetAt) : null;
  return <div className="guided-session-allowance-notice exhausted pre-session" role="status" data-testid="allowance-limit">
    <span className="guided-session-allowance-icon" aria-hidden="true"><Clock3 size={18} /></span>
    <div>
      {allowance.kind === "exhausted"
        ? <>
          <strong>You have used today&apos;s guided sessions.</strong>
          <p>A session you already started can still continue.{resetLabel && <> New sessions open again after <time dateTime={allowance.resetAt}>{resetLabel}</time>.</>}</p>
        </>
        : <>
          <strong>Too many sessions started in a short time.</strong>
          <p>Wait a moment, then open this block again.</p>
        </>}
    </div>
  </div>;
}

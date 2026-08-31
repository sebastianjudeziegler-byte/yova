import type { LearningPlanSession, SessionCompletion } from "@/lib/domain";
import type { PostSessionDecision } from "@/lib/personalization/post-session-decision";
import type { StudyRouteAgencyMode } from "@/lib/study-route/agency-mode-controller";
import {
  buildPostSessionPersonalizationReceipt,
  type PersonalizationReceiptEntry,
} from "@/lib/personalization/post-session-personalization-receipt";
import styles from "./post-session-personalization-receipt.module.css";

export function PostSessionPersonalizationReceipt({
  session,
  completion,
  decision,
  adaptationAgencyMode = null,
}: {
  session: LearningPlanSession | null;
  completion: SessionCompletion;
  decision: PostSessionDecision | null;
  adaptationAgencyMode?: StudyRouteAgencyMode | null;
}) {
  const receipt = buildPostSessionPersonalizationReceipt({
    session,
    completion,
    decision,
    adaptationAgencyMode,
  });

  return (
    <section className={styles.receipt} aria-labelledby="personalization-receipt-title">
      <header>
        <div>
          <span>PERSONALIZATION RECEIPT</span>
          <h2 id="personalization-receipt-title">What this session can change</h2>
        </div>
        <small>{routeBasisLabel(receipt.routeBasis, receipt.routeRevisionId)}</small>
      </header>
      <div className={styles.grid}>
        <ReceiptSection label="You said" entries={receipt.youSaid} />
        <ReceiptSection label="YOVA saw" entries={receipt.yovaSaw} />
        <ReceiptSection label="Next change" entries={receipt.nextChange} />
        <ReceiptSection label="Not sure yet" entries={receipt.notSureYet} />
      </div>
    </section>
  );
}

function ReceiptSection({
  label,
  entries,
}: {
  label: string;
  entries: readonly PersonalizationReceiptEntry[];
}) {
  return (
    <section className={styles.section}>
      <h3>{label}</h3>
      <ul>
        {entries.map((entry) => (
          <li key={entry.evidenceRef}>{entry.text}</li>
        ))}
      </ul>
    </section>
  );
}

function routeBasisLabel(
  basis: "matched" | "legacy" | "mismatch",
  routeRevisionId: string | null,
) {
  if (basis === "matched" && routeRevisionId) {
    return `Saved route · ${routeRevisionId.slice(0, 8)}`;
  }
  if (basis === "mismatch") return "Route match needs review";
  return "Legacy session · no saved route revision";
}

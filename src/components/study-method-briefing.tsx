import { useId } from "react";
import type {
  LearningPlanSession,
  SessionMethodBriefing,
} from "@/lib/domain";
import {
  getCoreLearningMethod,
  type CoreMethodId,
} from "@/lib/learning/method-catalog";
import type { SessionCoverage } from "@/lib/session-generation/schema";

import styles from "./study-method-briefing.module.css";

type BriefingSession = Pick<
  LearningPlanSession,
  "objective" | "contentTargets"
>;

type BriefingCoverage = Pick<
  SessionCoverage,
  "focus" | "essentialIdeas"
>;

export type StudyMethodBriefingProps = {
  briefing: SessionMethodBriefing;
  session: BriefingSession;
  coverage?: BriefingCoverage | null;
  /**
   * Use false only when another nearby control already explains the evidence
   * boundary. Unguided completion is practice, not verified topic evidence.
   */
  showPracticeBoundary?: boolean;
  className?: string;
};

function nonEmpty(items: string[] | undefined) {
  return items?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function unique(items: string[]) {
  return [...new Set(items)];
}

const METHODS_REQUIRING_AN_INITIAL_MODEL = new Set<CoreMethodId>([
  "retrieval_practice",
  "spaced_retrieval",
  "interleaved_practice",
  "practice_test_error_repair",
]);

export function StudyMethodBriefing({
  briefing,
  session,
  coverage = null,
  showPracticeBoundary = true,
  className,
}: StudyMethodBriefingProps) {
  const targetHeadingId = useId();
  const reasonHeadingId = useId();
  const personalizationHeadingId = useId();
  const focus = coverage?.focus.trim() || session.objective.trim();
  const coverageIdeas = nonEmpty(coverage?.essentialIdeas);
  const coveredIdeas = unique(coverageIdeas.length > 0
    ? coverageIdeas
    : nonEmpty(session.contentTargets));
  const modeLabel = briefing.learningMode === "learn"
    ? "Teaching first"
    : "Practice first";
  const learningFirstGuardrail = briefing.learningMode === "learn"
    && METHODS_REQUIRING_AN_INITIAL_MODEL.has(briefing.methodId)
    ? getCoreLearningMethod(briefing.methodId).avoidWhen
    : null;

  return (
    <section
      aria-label="How to study this"
      className={[styles.briefing, className].filter(Boolean).join(" ")}
      data-learning-mode={briefing.learningMode}
    >
      <header className={styles.header}>
        <p className={styles.eyebrow}>HOW TO STUDY THIS</p>
        <div className={styles.titleRow}>
          <h2>{briefing.name}</h2>
          <span>{modeLabel}</span>
        </div>
        <p className={styles.methodSummary}>{briefing.what}</p>
        {learningFirstGuardrail && (
          <aside className={styles.learningGuardrail}>
            <strong>Before unsupported practice</strong>
            <p>{learningFirstGuardrail}</p>
          </aside>
        )}
      </header>

      <div className={styles.grid}>
        <section className={styles.target} aria-labelledby={targetHeadingId}>
          <p className={styles.sectionLabel}>TODAY&apos;S TARGET</p>
          <h3 id={targetHeadingId}>{focus}</h3>

          {coveredIdeas.length > 0 && (
            <div className={styles.detail}>
              <h4>What this covers</h4>
              <ul>
                {coveredIdeas.map((idea) => <li key={idea}>{idea}</li>)}
              </ul>
            </div>
          )}

          <div className={styles.completion}>
            <h4>Finished means</h4>
            <p>{briefing.completion}</p>
          </div>
        </section>

        <section className={styles.method} aria-labelledby={reasonHeadingId}>
          <p className={styles.sectionLabel}>WHY THIS METHOD</p>
          <h3 id={reasonHeadingId}>Why it works</h3>
          <p>{briefing.why}</p>
          <h4>Use it like this</h4>
          <ol>
            {briefing.how.map((instruction) => (
              <li key={instruction}><span>{instruction}</span></li>
            ))}
          </ol>
        </section>
      </div>

      {briefing.personalization.length > 0 && (
        <section className={styles.personalization} aria-labelledby={personalizationHeadingId}>
          <h3 id={personalizationHeadingId}>Why this fits today</h3>
          <ul>
            {briefing.personalization.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </section>
      )}

      {showPracticeBoundary && (
        <p className={styles.practiceBoundary}>
          Completing this work counts as practice, not proof of topic mastery. YOVA will keep these topics open until a later evidence check.
        </p>
      )}
    </section>
  );
}

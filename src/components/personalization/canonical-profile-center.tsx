"use client";

import {
  CANONICAL_PROFILE_QUESTIONS,
  canonicalProfileWithQuestionAnswer,
  type CanonicalProfileQuestion,
} from "@/lib/personalization/canonical-profile-questionnaire";
import {
  canonicalProfileSignal,
  type CanonicalLearnerProfile,
  type CanonicalProfileSignal,
} from "@/lib/personalization/canonical-profile-schema";
import { buildCanonicalLearnerFacingSummary } from "@/lib/personalization/canonical-profile-summary";
import styles from "./canonical-profile-center.module.css";

type CanonicalProfileCenterProps = {
  profile: CanonicalLearnerProfile;
  enabled: boolean;
  onProfileChange: (profile: CanonicalLearnerProfile) => void;
  onEnabledChange: (enabled: boolean) => void;
};

export function CanonicalProfileCenter({
  profile,
  enabled,
  onProfileChange,
  onEnabledChange,
}: CanonicalProfileCenterProps) {
  const summary = buildCanonicalLearnerFacingSummary(profile);
  const answeredCount = CANONICAL_PROFILE_QUESTIONS.length
    - summary.unansweredQuestionCount;

  return (
    <section className={styles.center} aria-labelledby="canonical-profile-heading">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>YOUR CANONICAL STUDY PROFILE</span>
          <h2 id="canonical-profile-heading">{summary.heading}</h2>
          <p>
            One optional profile now controls preference hints across plans,
            sessions, and the study workspace.
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.progress}>{answeredCount}/11 answered</span>
          <label className={styles.profileControl}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            <span>{enabled ? "Use profile answers" : "Profile use paused"}</span>
          </label>
        </div>
      </header>

      <div className={styles.summary} aria-label="Current profile summary">
        {enabled ? (
          <>
            {summary.statements.map((statement) => (
              <p key={statement}>{statement}</p>
            ))}
            <small>{summary.evidenceBoundary}</small>
          </>
        ) : (
          <>
            <p>
              Profile use is paused. Your saved answers remain editable here,
              but they do not influence method, duration, or workspace decisions.
            </p>
            <small>Turn profile use back on whenever you want YOVA to consider these declarations again.</small>
          </>
        )}
      </div>

      <details className={styles.questionnaire} open={summary.unansweredQuestionCount > 0}>
        <summary>
          <span>Review or change the 11 optional questions</span>
          <small>
            {enabled
              ? "Every answer includes Depends or Not sure where relevant."
              : "Edits stay saved but paused until profile use is turned on."}
          </small>
        </summary>
        <div className={styles.questions}>
          {CANONICAL_PROFILE_QUESTIONS.map((question) => {
            const signal = canonicalProfileSignal(profile, question.signalId);
            const helpId = `${question.id}-help`;
            return (
              <article className={styles.question} key={question.id}>
                <div className={styles.questionHeader}>
                  <span>Question {question.number}</span>
                  {signal ? (
                    <span className={styles.source}>
                      {profileSignalSourceLabel(signal)}
                    </span>
                  ) : (
                    <span className={styles.unanswered}>Optional</span>
                  )}
                </div>
                <label htmlFor={question.id}>{question.prompt}</label>
                <select
                  id={question.id}
                  aria-describedby={helpId}
                  value={signal?.value ?? ""}
                  onChange={(event) => onProfileChange(
                    profileWithCanonicalAnswer(profile, question, event.target.value),
                  )}
                >
                  <option value="">Not answered</option>
                  {question.options.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <p id={helpId}>{question.decision}</p>
                <small>{question.authorityLimit}</small>
              </article>
            );
          })}
        </div>
      </details>
    </section>
  );
}

export function profileWithCanonicalAnswer(
  profile: CanonicalLearnerProfile,
  question: CanonicalProfileQuestion,
  value: string,
): CanonicalLearnerProfile {
  return canonicalProfileWithQuestionAnswer(profile, question.id, value);
}

function profileSignalSourceLabel(signal: CanonicalProfileSignal) {
  if (signal.source === "learner_correction") return "Updated by you";
  if (signal.provenance === "direct_answer") return "Answered by you";
  return "Migrated from existing answers";
}

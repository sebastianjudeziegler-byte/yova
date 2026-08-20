"use client";

import { useId, useState } from "react";
import { ArrowRight, Check, FileText } from "lucide-react";
import { StudyMethodBriefing } from "@/components/study-method-briefing";
import type {
  LearningPlanSession,
  SessionMethodBriefing,
} from "@/lib/domain";
import {
  boundedMethodWorkProgress,
  emptyMethodWorkProgress,
  type MethodWorkProgress,
} from "@/lib/learning/method-work-progress";
import type { SessionCoverage } from "@/lib/session-generation/schema";

import styles from "./study-method-practice.module.css";

type PracticeSession = Pick<
  LearningPlanSession,
  "objective" | "contentTargets"
>;

type PracticeCoverage = Pick<
  SessionCoverage,
  "focus" | "essentialIdeas"
>;

export type StudyMethodPracticeProps = {
  briefing: SessionMethodBriefing;
  session: PracticeSession;
  coverage?: PracticeCoverage | null;
  sourceFirstRequired?: boolean;
  allowUnguidedCompletion?: boolean;
  progress?: MethodWorkProgress;
  onProgressChange?: (progress: MethodWorkProgress) => void;
  onComplete: () => void;
};

function compact(items: string[] | undefined) {
  return items?.map((item) => item.trim()).filter(Boolean) ?? [];
}

export function methodPracticeTopics(
  session: PracticeSession,
  coverage?: PracticeCoverage | null,
) {
  const currentSlice = compact(coverage?.essentialIdeas);
  const candidates = currentSlice.length > 0
    ? currentSlice
    : compact(session.contentTargets);
  return [...new Set(candidates.length > 0 ? candidates : [session.objective.trim()])]
    .filter(Boolean);
}

export function StudyMethodPractice({
  briefing,
  session,
  coverage = null,
  sourceFirstRequired = false,
  allowUnguidedCompletion = true,
  progress,
  onProgressChange,
  onComplete,
}: StudyMethodPracticeProps) {
  const topicGroupId = useId();
  const [workpad, setWorkpad] = useState("");
  const [localProgress, setLocalProgress] = useState<MethodWorkProgress>(emptyMethodWorkProgress);
  const topics = methodPracticeTopics(session, coverage);
  const currentProgress = boundedMethodWorkProgress(progress ?? localProgress, topics);
  const checkedTopics = currentProgress.checkedTopics;
  const sourceReviewed = currentProgress.sourceReviewed;
  const allTopicsChecked = topics.every((topic) => checkedTopics.includes(topic));
  const canComplete = workpad.trim().length > 0
    && allTopicsChecked
    && (!sourceFirstRequired || sourceReviewed);

  const updateProgress = (next: MethodWorkProgress) => {
    const bounded = boundedMethodWorkProgress(next, topics);
    if (progress === undefined) setLocalProgress(bounded);
    onProgressChange?.(bounded);
  };

  const toggleTopic = (topic: string) => {
    updateProgress({
      ...currentProgress,
      checkedTopics: checkedTopics.includes(topic)
        ? checkedTopics.filter((item) => item !== topic)
        : [...checkedTopics, topic],
    });
  };

  return <section className={styles.practice} aria-label="Study-method workpad">
    <StudyMethodBriefing
      briefing={briefing}
      session={session}
      coverage={coverage}
      showPracticeBoundary={false}
    />

    <section className={styles.workpad}>
      <header>
        <span><FileText size={18} /></span>
        <div>
          <p>METHOD WORKPAD</p>
          <h2>Do the work, then check it against the saved target.</h2>
          <small>Your notes stay in this screen and are not saved or graded.</small>
        </div>
      </header>

      {sourceFirstRequired && <label className={styles.sourceCheck}>
        <input
          type="checkbox"
          checked={sourceReviewed}
          onChange={(event) => updateProgress({
            ...currentProgress,
            sourceReviewed: event.target.checked,
          })}
        />
        <span>
          <strong>I studied an explanation or complete example in my own source first.</strong>
          <small>A teaching-first session needs an initial subject model before unsupported practice.</small>
        </span>
      </label>}

      <label className={styles.notes}>
        <span>Your workpad</span>
        <textarea
          rows={8}
          maxLength={5_000}
          value={workpad}
          placeholder="Work through the method here. Capture your recall, explanation, outline, calculation, or application before checking it."
          onChange={(event) => setWorkpad(event.target.value)}
        />
      </label>

      <fieldset className={styles.checklist} aria-labelledby={topicGroupId}>
        <legend id={topicGroupId}>Check each covered topic</legend>
        <p>Compare your work with this completion criterion: <strong>{briefing.completion}</strong></p>
        <div>
          {topics.map((topic) => <label key={topic}>
            <input
              type="checkbox"
              checked={checkedTopics.includes(topic)}
              onChange={() => toggleTopic(topic)}
            />
            <span>{topic}</span>
          </label>)}
        </div>
      </fieldset>

      <div className={styles.boundary}>
        <Check size={17} />
        {allowUnguidedCompletion
          ? <p><strong>This completes practice, not a knowledge check.</strong> The session will count as done, but no topic will become taught, evidenced, or secure until YOVA verifies it later.</p>
          : <p><strong>This session is the required knowledge check.</strong> You can still use the method guide and workpad, but finish the guided questions below so YOVA can record real evidence.</p>}
      </div>

      {allowUnguidedCompletion && <button className="button primary large" type="button" disabled={!canComplete} onClick={onComplete}>
          Finish as ungraded practice <ArrowRight size={18} />
        </button>}
    </section>
  </section>;
}

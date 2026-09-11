"use client";

import { Sparkles } from "lucide-react";
import {
  onboardingAnswerId,
  onboardingSupportNeeds,
  toggleOnboardingSupportNeed,
  withOnboardingAnswer,
  type OnboardingAnswers,
} from "@/lib/onboarding/answers";
import { ONBOARDING_QUESTIONS, type OnboardingQuestionId } from "@/lib/onboarding/questions";
import { personalizationNote } from "@/lib/routing/personalization-note";
import { routeSession } from "@/lib/routing/session-route";

/**
 * "A learner who answered wrongly edits their answer in the learner profile.
 * No re-onboarding." Dropdowns and checkboxes only; no free text.
 */
export function BaselineProfileEditor({ answers, onChange }: { answers: OnboardingAnswers; onChange: (answers: OnboardingAnswers) => void }) {
  const preview = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers });
  const note = personalizationNote(preview);
  return <section className="baseline-profile-editor" aria-labelledby="baseline-profile-title">
    <header>
      <div>
        <span className="step-label">YOUR STUDY PROFILE</span>
        <h2 id="baseline-profile-title">Ten answers that change how sessions run</h2>
        <p>Change any answer here; the next session you open uses it. Nothing is re-asked.</p>
      </div>
    </header>
    <div className="baseline-profile-grid">
      {ONBOARDING_QUESTIONS.map((question) => {
        const controlId = `baseline-profile-${question.id}`;
        if (question.multi) {
          const selected = onboardingSupportNeeds(answers);
          return <fieldset key={question.id} className="baseline-profile-field">
            <legend>{question.prompt}</legend>
            <div className="baseline-profile-checks">
              {question.options.map((option) => <label key={option.id}><input type="checkbox" checked={selected.includes(option.id)} onChange={() => onChange(toggleOnboardingSupportNeed(answers, option.id))} /> <span>{option.label}</span></label>)}
            </div>
            <small>{question.routesTo}</small>
          </fieldset>;
        }
        const value = onboardingAnswerId(answers, question.id as Exclude<OnboardingQuestionId, "support_needs">) ?? "";
        return <label key={question.id} className="baseline-profile-field" htmlFor={controlId}>
          <span>{question.prompt}</span>
          <select id={controlId} value={value} onChange={(event) => onChange(withOnboardingAnswer(answers, question.id, event.target.value || null))}>
            <option value="">Not answered</option>
            {question.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <small>{question.routesTo}</small>
        </label>;
      })}
    </div>
    <p className="baseline-profile-note"><Sparkles size={16} /> <span>{note.sentence}</span></p>
  </section>;
}

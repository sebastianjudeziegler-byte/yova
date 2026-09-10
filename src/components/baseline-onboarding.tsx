"use client";

import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  onboardingAnswerId,
  onboardingAnsweredCount,
  onboardingSupportNeeds,
  toggleOnboardingSupportNeed,
  withOnboardingAnswer,
  type OnboardingAnswers,
} from "@/lib/onboarding/answers";
import { ONBOARDING_QUESTIONS, type OnboardingQuestionId } from "@/lib/onboarding/questions";
import { routeSession } from "@/lib/routing/session-route";
import { personalizationNote } from "@/lib/routing/personalization-note";

/**
 * Baseline onboarding: the ten reordered questions from
 * docs/redesign/03-ONBOARDING.md, keyed by stable question ID. Every answer is
 * a button; nothing is free text.
 */
export function BaselineOnboardingIntro({ onStart }: { onStart: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card"><span className="step-label">SET UP YOUR YOVA</span><h1>Make YOVA fit how you actually study.</h1><p>Ten short questions, easy to hard. Eight of them change what your sessions look like. About two minutes.</p><div className="info-strip"><Sparkles size={20} /><span>This records changeable preferences, not a brain type. The topic still decides the shape of a session; your answers change how it runs.</span></div><button className="button primary large full" onClick={onStart}>Personalize YOVA <ArrowRight size={18} /></button></section></main>;
}

export function BaselineOnboardingQuestion({ index, answers, onChange, onNext, onBack }: {
  index: number;
  answers: OnboardingAnswers;
  onChange: (answers: OnboardingAnswers) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const question = ONBOARDING_QUESTIONS[index];
  if (!question) return null;
  const total = ONBOARDING_QUESTIONS.length;
  const selected = question.multi ? onboardingSupportNeeds(answers) : [onboardingAnswerId(answers, question.id as Exclude<OnboardingQuestionId, "support_needs">)].filter((value): value is string => Boolean(value));
  const headingId = `baseline-onboarding-${question.id}`;
  const canContinue = question.optional || selected.length > 0;
  const last = index === total - 1;
  return <main className="onboarding-shell">
    <header><BrandMark /><span>{index + 1} of {total}</span></header>
    <div className="progress-track"><div style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
    <section className="question-wrap">
      <span className="step-label">YOUR STUDY PREFERENCES</span>
      <h2 id={headingId}>{question.prompt}</h2>
      <p className="muted">{question.multi ? "Optional. Choose any that apply, or continue without one." : question.optional ? "Optional. Skip if nothing fits." : "Pick the one closest to you. You can change it later in You."}</p>
      <div className="option-list" role="group" aria-labelledby={headingId}>
        {question.options.map((option) => {
          const pressed = selected.includes(option.id);
          return <button type="button" key={option.id} aria-pressed={pressed} className={`option ${pressed ? "selected" : ""}`} onClick={() => {
            onChange(question.multi
              ? toggleOnboardingSupportNeed(answers, option.id)
              : withOnboardingAnswer(answers, question.id, pressed ? null : option.id));
          }}>{option.label}</button>;
        })}
      </div>
      <div className="onboarding-actions">
        <button type="button" className="button ghost" onClick={onBack} disabled={index === 0}><ArrowLeft size={16} /> Back</button>
        <button type="button" className="button primary" onClick={onNext} disabled={!canContinue}>{last ? "Build my setup" : "Continue"} <ArrowRight size={16} /></button>
      </div>
    </section>
  </main>;
}

/**
 * After onboarding: what the answers change, shown as the routing table's own
 * output for a plain conceptual topic, so the promise on the intro screen is
 * checked against the code that keeps it.
 */
export function BaselineProfileSummary({ answers, onContinue }: { answers: OnboardingAnswers; onContinue: () => void }) {
  const learn = routeSession({ taskType: "conceptual_learning", blockKind: "learn", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers });
  const practice = routeSession({ taskType: "conceptual_learning", blockKind: "practice", evidence: "not_assessed", hasSource: true, topicHasProblems: false, answers });
  const note = personalizationNote(learn);
  const items = [
    { title: "Learn blocks", value: `${learn.methodName}: ${learn.entry === "study_full" ? "study, then produce" : "brief review, then produce"}${learn.produceBeforeStudy ? " (you try first)" : ""}${learn.workedStructureBeforeProduce ? " with the structure shown first" : ""}` },
    { title: "Practice blocks", value: `Closed-book questions, up to ${practice.questionCap} per round, ${practice.weighting === "terms_first" ? "definitions first" : "relationships first"}` },
    { title: "Timer", value: `${learn.timerMinutes} minutes as a nudge, not a boundary${learn.stoppingPoints === "after_each_step" ? ", with a stopping point after each step" : ""}` },
    { title: "Method choice", value: learn.visibility === "silent" ? "Applied for you, with detailed steps" : learn.visibility === "chooser" ? "Offered at the start with YOVA's pick pre-selected" : "Applied, with a Change method link and the reason" },
  ];
  return <main className="centered-shell"><BrandMark /><section className="setup-card wide"><span className="eyebrow"><Sparkles size={15} /> Your starting setup</span><h1>YOVA will begin like this.</h1><p>{onboardingAnsweredCount(answers)} of {ONBOARDING_QUESTIONS.length} answered. {note.sentence}</p><div className="profile-grid">{items.map((item) => <div className="profile-item" key={item.title}><span>{item.title}</span><strong>{item.value}</strong><small>You can change this anytime in You</small></div>)}</div><button className="button primary large full" onClick={onContinue}>Open YOVA <ArrowRight size={18} /></button></section></main>;
}

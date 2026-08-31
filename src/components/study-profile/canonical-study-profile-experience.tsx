"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  CANONICAL_PROFILE_QUESTIONS,
  canonicalProfileWithQuestionAnswer,
} from "@/lib/personalization/canonical-profile-questionnaire";
import {
  canonicalProfileSignal,
  createCanonicalLearnerProfile,
  type CanonicalLearnerProfile,
} from "@/lib/personalization/canonical-profile-schema";
import {
  readPublicCanonicalProfileDraft,
  writePublicCanonicalProfileDraft,
} from "@/lib/personalization/canonical-profile-storage";
import { buildCanonicalLearnerFacingSummary } from "@/lib/personalization/canonical-profile-summary";
import styles from "./canonical-study-profile.module.css";

type View = "landing" | "question" | "summary";

export function CanonicalStudyProfileExperience() {
  const [view, setView] = useState<View>("landing");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [profile, setProfile] = useState<CanonicalLearnerProfile>(() => (
    typeof window === "undefined"
      ? createCanonicalLearnerProfile([])
      : readPublicCanonicalProfileDraft(window.localStorage)
        ?? createCanonicalLearnerProfile([])
  ));
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const activeHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (view !== "landing") activeHeadingRef.current?.focus();
  }, [questionIndex, view]);

  const question = CANONICAL_PROFILE_QUESTIONS[questionIndex];
  const selected = question
    ? canonicalProfileSignal(profile, question.signalId)?.value ?? null
    : null;

  const finish = () => {
    const saved = writePublicCanonicalProfileDraft(window.localStorage, profile);
    setStorageIssue(saved
      ? null
      : "This browser blocked local storage. You can still create an account, but these answers will need to be selected again in YOVA.");
    setView("summary");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  if (view === "landing") {
    return <main className={styles.shell}>
      <header className={styles.brand}><BrandMark /></header>
      <section className={styles.hero}>
        <span className={styles.eyebrow}><Sparkles size={15} /> ONE CANONICAL STUDY PROFILE</span>
        <h1>Tell YOVA how you want to work together.</h1>
        <p>Answer 11 short, optional questions. They create the same changeable profile used in YOVA—not a personality type, learning style, or second assessment.</p>
        <div className={styles.boundary}><ShieldCheck size={20} /><span>Your answers may shape valid choices, timing, support, and presentation. The task and checked work still set the learning boundary.</span></div>
        <button className={styles.primary} onClick={() => setView("question")}>Build my study profile <ArrowRight size={18} /></button>
        <small>Already have a saved report from the earlier Study Profile? Its private link remains available.</small>
      </section>
    </main>;
  }

  if (view === "question" && question) {
    return <main className={styles.shell}>
      <header className={styles.questionHeader}><BrandMark compact /><span>{questionIndex + 1} of {CANONICAL_PROFILE_QUESTIONS.length}</span></header>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Study Profile progress"
        aria-valuemin={1}
        aria-valuemax={CANONICAL_PROFILE_QUESTIONS.length}
        aria-valuenow={questionIndex + 1}
        aria-valuetext={`Question ${questionIndex + 1} of ${CANONICAL_PROFILE_QUESTIONS.length}`}
      ><span style={{ width: `${((questionIndex + 1) / CANONICAL_PROFILE_QUESTIONS.length) * 100}%` }} /></div>
      <section className={styles.question} aria-labelledby="canonical-public-question">
        <span className={styles.eyebrow}>YOUR CANONICAL STUDY PROFILE</span>
        <h1 ref={activeHeadingRef} tabIndex={-1} id="canonical-public-question">{question.prompt}</h1>
        <p>{question.decision}</p>
        <div className={styles.options} role="group" aria-labelledby="canonical-public-question">
          {question.options.map((option) => <button
            type="button"
            key={option.id}
            className={selected === option.id ? styles.selected : undefined}
            aria-pressed={selected === option.id}
            onClick={() => setProfile(canonicalProfileWithQuestionAnswer(profile, question.id, option.id))}
          ><span>{option.label}</span>{selected === option.id && <Check size={18} />}</button>)}
        </div>
        <div className={styles.authority}><strong>What this can change</strong><span>{question.authorityLimit}</span></div>
        <footer>
          <button className={styles.secondary} disabled={questionIndex === 0} onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={17} /> Back</button>
          <button className={styles.primary} onClick={() => {
            if (questionIndex === CANONICAL_PROFILE_QUESTIONS.length - 1) finish();
            else setQuestionIndex((current) => current + 1);
          }}>{questionIndex === CANONICAL_PROFILE_QUESTIONS.length - 1 ? "Review my setup" : selected ? "Continue" : "Skip for now"} <ArrowRight size={17} /></button>
        </footer>
      </section>
    </main>;
  }

  const summary = buildCanonicalLearnerFacingSummary(profile);
  return <main className={styles.shell}>
    <header className={styles.brand}><BrandMark /></header>
    <section className={styles.summary}>
      <span className={styles.eyebrow}><Sparkles size={15} /> YOUR STARTING SETUP</span>
      <h1 ref={activeHeadingRef} tabIndex={-1}>{summary.heading}</h1>
      <p>These are transparent, changeable preferences. You can review every answer later in You.</p>
      <div className={styles.summaryList}>{summary.statements.map((statement) => <article key={statement}><Check size={17} /><span>{statement}</span></article>)}</div>
      <div className={styles.boundary}><ShieldCheck size={20} /><span>{summary.evidenceBoundary}</span></div>
      {storageIssue && <p className={styles.issue} role="alert">{storageIssue}</p>}
      <Link className={styles.primary} href="/">Use this profile in YOVA <ArrowRight size={18} /></Link>
      <button className={styles.secondary} onClick={() => { setQuestionIndex(0); setView("question"); }}>Review my answers</button>
    </section>
  </main>;
}

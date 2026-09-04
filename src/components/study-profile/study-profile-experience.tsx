"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LockKeyhole,
  Mail,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Target,
  TimerReset,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  captureStudyProfileAttribution,
  getStudyProfileVisitorId,
  trackStudyProfileEvent,
} from "@/lib/study-profile/analytics-client";
import {
  STUDY_PROFILE_QUESTIONS,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileAttribution,
  type StudyProfileEnergyWindow,
  type StudyProfileMetadata,
  type StudyProfilePublicStoredResponse,
  type StudyProfileReport,
  type StudyProfileSchoolLevel,
  type StudyProfileStudyGoal,
} from "@/lib/study-profile";
import { STUDY_PROFILE_SUPPORT_MAILTO } from "@/lib/public-contact";
import { StudyProfileReportView } from "./study-profile-report-view";
import styles from "./study-profile.module.css";

type AssessmentView = "landing" | "question" | "goal" | "context" | "teaser" | "report";

type Draft = {
  version: typeof STUDY_PROFILE_DRAFT_VERSION;
  view: Exclude<AssessmentView, "landing" | "report">;
  currentQuestion: number;
  answers: Partial<StudyProfileAnswers>;
  metadata: Partial<StudyProfileMetadata>;
};

type StoredDraft = Draft & {
  savedAt: number;
};

type SubmissionResult = {
  reportToken: string;
  reportUrl?: string;
  storedResponse: StudyProfilePublicStoredResponse;
  report: StudyProfileReport;
  emailDelivery?: "sent" | "skipped" | "failed" | "cooldown" | "daily_cap" | { status?: "sent" | "skipped" | "failed" | "cooldown" | "daily_cap" };
  emailSent?: boolean;
  emailDeliveryQueued?: boolean;
  waitlistJoined?: boolean;
  confirmationPending?: boolean;
  waitlistError?: string | null;
};

const STUDY_PROFILE_DRAFT_VERSION = "study_profile_draft_v2" as const;
const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v2";
const LEGACY_DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";
const STUDY_PROFILE_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOTAL_STUDY_PROFILE_STEPS = 14;

const ENERGY_OPTIONS: readonly { value: StudyProfileEnergyWindow; label: string }[] = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
  { value: "late_night", label: "Late night" },
  { value: "varies", label: "It varies" },
];

const SCHOOL_OPTIONS: readonly { value: StudyProfileSchoolLevel; label: string }[] = [
  { value: "high_school", label: "High school" },
  { value: "college", label: "College" },
  { value: "other", label: "Another learning path" },
];

const GOAL_OPTIONS: readonly { value: StudyProfileStudyGoal; label: string; detail: string }[] = [
  { value: "upcoming_exams", label: "Exams coming up", detail: "I need a plan for revision and exam practice." },
  { value: "keeping_up", label: "Keeping up with coursework", detail: "I want weekly studying to feel more under control." },
  { value: "catching_up", label: "Catching up after falling behind", detail: "I need to rebuild momentum without getting overwhelmed." },
  { value: "specific_qualification", label: "A specific test or qualification", detail: "I am working toward one clear result." },
  { value: "better_habits", label: "Building better study habits", detail: "I want a system that works beyond one deadline." },
];

export function StudyProfileExperience() {
  const [view, setView] = useState<AssessmentView>("landing");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Partial<StudyProfileAnswers>>({});
  const [metadata, setMetadata] = useState<Partial<StudyProfileMetadata>>({});
  const [email, setEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [waitlistConsent, setWaitlistConsent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const attributionRef = useRef<StudyProfileAttribution>({});
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pageViewedRef = useRef(false);
  const completionTrackedRef = useRef(false);

  useEffect(() => {
    attributionRef.current = captureStudyProfileAttribution();
    const retakeRequested = hasRetakeRequest();
    const restoredDraft = retakeRequested ? null : readStudyProfileDraft();
    const hydrationFrame = window.requestAnimationFrame(() => {
      if (retakeRequested) {
        consumeRetakeRequest();
        resetLocalAssessment();
        setView("question");
        void trackStudyProfileEvent("study_profile_started");
      } else if (restoredDraft && isDraftView(restoredDraft.view)) {
        setAnswers(isAnswerDraft(restoredDraft.answers) ? restoredDraft.answers : {});
        setMetadata(isMetadataDraft(restoredDraft.metadata) ? restoredDraft.metadata : {});
        setCurrentQuestion(clampQuestionIndex(restoredDraft.currentQuestion));
        setView(
          (restoredDraft.view === "context" || restoredDraft.view === "teaser")
            && !hasStudyGoal(restoredDraft.metadata)
            ? "goal"
            : restoredDraft.view,
        );
      }
      setHydrated(true);
    });
    if (!pageViewedRef.current) {
      pageViewedRef.current = true;
      void trackStudyProfileEvent("study_profile_page_viewed");
    }
    return () => window.cancelAnimationFrame(hydrationFrame);
  }, []);

  useEffect(() => {
    if (!hydrated || view === "landing" || view === "report") return;
    persistStudyProfileDraft({ version: STUDY_PROFILE_DRAFT_VERSION, view, currentQuestion, answers, metadata });
  }, [answers, currentQuestion, hydrated, metadata, view]);

  useEffect(() => {
    if (view === "landing" || view === "report") return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentQuestion, view]);

  useEffect(() => {
    if (view !== "question") return;
    function handleShortcut(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const question = STUDY_PROFILE_QUESTIONS[currentQuestion];
      if (!question) return;
      const key = event.key.toLowerCase();
      const numericIndex = ["1", "2", "3", "4"].indexOf(key);
      const letterIndex = ["a", "b", "c", "d"].indexOf(key);
      let optionIndex = numericIndex >= 0 ? numericIndex : letterIndex;
      if (optionIndex < 0 && ["arrowright", "arrowdown", "arrowleft", "arrowup"].includes(key)) {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active.getAttribute("role") !== "radio") return;
        const activeIndex = Number(active.dataset.optionIndex);
        if (!Number.isInteger(activeIndex)) return;
        const direction = key === "arrowright" || key === "arrowdown" ? 1 : -1;
        optionIndex = (activeIndex + direction + question.options.length) % question.options.length;
      }
      const option = question.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      answerQuestion(option.id);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const completedAnswers = useMemo(() => toCompletedAnswers(answers), [answers]);
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  function resetLocalAssessment() {
    clearStudyProfileDraft();
    setAnswers({});
    setMetadata({});
    setCurrentQuestion(0);
    setEmail("");
    setAgeConfirmed(false);
    setWaitlistConsent(false);
    setSubmissionError(null);
    setSubmissionResult(null);
    completionTrackedRef.current = false;
  }

  function startQuiz() {
    setView("question");
    void trackStudyProfileEvent("study_profile_started");
  }

  function answerQuestion(answerId: StudyProfileAnswerId) {
    const question = STUDY_PROFILE_QUESTIONS[currentQuestion];
    if (!question) return;
    setAnswers((current) => ({ ...current, [question.id]: answerId }));
    void trackStudyProfileEvent("study_profile_question_answered", { questionNumber: question.number });
    if (currentQuestion < STUDY_PROFILE_QUESTIONS.length - 1) setCurrentQuestion((index) => index + 1);
    else setView("goal");
  }

  function selectGoal(value: StudyProfileStudyGoal) {
    setMetadata((current) => ({ ...current, studyGoal: value }));
    void trackStudyProfileEvent("study_profile_question_answered", { questionNumber: 13 });
    setView("context");
  }

  function completeContext() {
    if (!metadata.energyWindow || !metadata.schoolLevel || !metadata.studyGoal || !completedAnswers) return;
    void trackStudyProfileEvent("study_profile_question_answered", { questionNumber: 14 });
    setView("teaser");
    if (!completionTrackedRef.current) {
      completionTrackedRef.current = true;
      void trackStudyProfileEvent("study_profile_completed");
    }
  }

  function goBack() {
    if (view === "question") {
      if (currentQuestion === 0) setView("landing");
      else setCurrentQuestion((index) => Math.max(0, index - 1));
    } else if (view === "goal") {
      setCurrentQuestion(STUDY_PROFILE_QUESTIONS.length - 1);
      setView("question");
    } else if (view === "context") setView("goal");
    else if (view === "teaser") setView("context");
  }

  function restartAssessment() {
    const hasProgress = Object.keys(answers).length > 0 || view !== "landing";
    if (hasProgress && !window.confirm("Restart your Study Profile and clear your saved answers?")) return;
    resetLocalAssessment();
    setView("landing");
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError(null);
    if (!completedAnswers || !metadata.energyWindow || !metadata.schoolLevel || !metadata.studyGoal) {
      setSubmissionError("Your saved assessment is incomplete. Go back and finish it first.");
      return;
    }
    if (!ageConfirmed) {
      setSubmissionError("Confirm that you are 13 or older to receive your report.");
      return;
    }
    setIsSubmitting(true);
    try {
      const visitorId = getStudyProfileVisitorId();
      if (!visitorId) throw new Error("Your browser could not create a private report session. Refresh and try again.");
      const response = await fetch("/api/study-profile/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId,
          ageConfirmed: true,
          email,
          answers: completedAnswers,
          metadata: {
            energyWindow: metadata.energyWindow,
            schoolLevel: metadata.schoolLevel,
            studyGoal: metadata.studyGoal,
            hardestPart: null,
          },
          marketingConsent: false,
          waitlistConsent,
          attribution: attributionRef.current,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        if ((payload.code === "saved_response_unavailable" || payload.code === "save_outcome_unknown") && typeof payload.reportUrl === "string") {
          const reportPath = new URL(payload.reportUrl, window.location.href);
          window.history.replaceState({}, "", `${reportPath.pathname}${reportPath.search}${reportPath.hash}`);
        }
        throw new Error(typeof payload.error === "string" ? payload.error : "We could not save your report. Check your email and try again.");
      }
      const result = ((payload.data && typeof payload.data === "object") ? payload.data : payload) as unknown as SubmissionResult;
      if (!result.reportToken || !result.storedResponse || !result.report) throw new Error("Your report was created, but the response was incomplete. Try again.");
      setSubmissionResult(result);
      clearStudyProfileDraft();
      const reportPath = result.reportUrl
        ? new URL(result.reportUrl, window.location.href)
        : new URL(`/study-profile/report/${encodeURIComponent(result.reportToken)}`, window.location.href);
      window.history.replaceState({}, "", `${reportPath.pathname}${reportPath.search}${reportPath.hash}`);
      setView("report");
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "We could not save your report. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (view === "report" && submissionResult) {
    return <StudyProfileReportView
      storedResponse={submissionResult.storedResponse}
      report={submissionResult.report}
      reportToken={submissionResult.reportToken}
      emailDelivery={resolveEmailDelivery(submissionResult)}
      initialWaitlistJoined={submissionResult.waitlistJoined}
      initialWaitlistConfirmationPending={submissionResult.confirmationPending}
      initialWaitlistError={submissionResult.waitlistError}
      autoFocusHeading
    />;
  }
  if (view === "landing") return <StudyProfileLanding onStart={startQuiz} />;

  const assessmentStep = resolveAssessmentStep(view, currentQuestion);
  return (
    <div className={styles.assessmentPage}>
      <a className={styles.skipLink} href="#assessment-content">Skip to question</a>
      <header className={styles.assessmentHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}><BrandMark /></Link>
        <div className={styles.assessmentHeaderActions}>
          <span><LockKeyhole size={13} aria-hidden="true" /> Draft saved for 7 days</span>
          <button type="button" onClick={restartAssessment}><RefreshCw size={14} aria-hidden="true" /> Restart</button>
        </div>
      </header>
      <div className={styles.progressShell} role="progressbar" aria-label="Study Profile progress" aria-valuemin={0} aria-valuemax={TOTAL_STUDY_PROFILE_STEPS} aria-valuenow={assessmentStep.number} aria-valuetext={assessmentStep.label}>
        <div className={styles.progressMeta}>
          <span>{assessmentStep.label}</span>
          {assessmentStep.momentum && <small>{assessmentStep.momentum}</small>}
        </div>
        <div className={styles.progressTrack}><span style={{ width: `${assessmentStep.percent}%` }} /></div>
      </div>
      <main id="assessment-content" className={styles.assessmentMain} tabIndex={-1}>
        <button type="button" className={styles.backButton} onClick={goBack}><ArrowLeft size={17} aria-hidden="true" /> Back</button>
        <div className={styles.questionTransition} key={`${view}-${currentQuestion}`}>
          {view === "question" && <QuestionScreen index={currentQuestion} selected={answers[STUDY_PROFILE_QUESTIONS[currentQuestion].id]} onSelect={answerQuestion} headingRef={headingRef} />}
          {view === "goal" && (
            <MetadataScreen headingRef={headingRef} title="What are you mainly studying for right now?" supporting="This changes the method order, examples, and first task in your report.">
              <div className={styles.metadataOptions}>
                {GOAL_OPTIONS.map((option) => <button type="button" key={option.value} className={metadata.studyGoal === option.value ? styles.optionSelected : undefined} aria-pressed={metadata.studyGoal === option.value} onClick={() => selectGoal(option.value)}>
                  <span>{option.label}</span><small>{option.detail}</small><ChevronRight size={18} aria-hidden="true" />
                </button>)}
              </div>
            </MetadataScreen>
          )}
          {view === "context" && (
            <MetadataScreen headingRef={headingRef} title="One last bit of context." supporting="Choose your strongest study time and where you are learning.">
              <div className={styles.contextGroups}>
                <fieldset><legend>When is your focus usually strongest?</legend><div className={styles.contextChoices}>
                  {ENERGY_OPTIONS.map((option) => <button type="button" key={option.value} className={metadata.energyWindow === option.value ? styles.optionSelected : undefined} aria-pressed={metadata.energyWindow === option.value} onClick={() => setMetadata((current) => ({ ...current, energyWindow: option.value }))}>{option.label}</button>)}
                </div></fieldset>
                <fieldset><legend>What best describes your setting?</legend><div className={styles.contextChoices}>
                  {SCHOOL_OPTIONS.map((option) => <button type="button" key={option.value} className={metadata.schoolLevel === option.value ? styles.optionSelected : undefined} aria-pressed={metadata.schoolLevel === option.value} onClick={() => setMetadata((current) => ({ ...current, schoolLevel: option.value }))}>{option.label}</button>)}
                </div></fieldset>
              </div>
              <button type="button" className={styles.primaryButton} disabled={!metadata.energyWindow || !metadata.schoolLevel} onClick={completeContext}>Finish and unlock my results <ArrowRight size={17} aria-hidden="true" /></button>
            </MetadataScreen>
          )}
          {view === "teaser" && completedAnswers && (
            <section className={styles.teaserScreen} aria-labelledby="pattern-reveal-heading">
              <form className={styles.emailGate} onSubmit={submitEmail} aria-busy={isSubmitting}>
                <span className={styles.lockedResultStatus}><LockKeyhole size={15} aria-hidden="true" /> Results ready</span>
                <h1 id="pattern-reveal-heading" ref={headingRef} tabIndex={-1}>Your answers point to a study pattern.</h1>
                <p>Enter your email to open your private report. We will send a private link so you can return to it. Joining the waitlist is optional.</p>
                <label htmlFor="study-profile-email">Email for your private report link</label>
                <div className={styles.emailInputWrap}><Mail size={18} aria-hidden="true" /><input id="study-profile-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="email-consent-note" /></div>
                <div className={styles.unlockList} aria-label="Full report includes">
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Your named study pattern</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> The study habit to focus on first</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Three suggested methods to try</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> A plan for tonight</span>
                </div>
                <label className={styles.consentRow}><input type="checkbox" required checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><strong>I confirm I am 13 or older.</strong></span></label>
                <label className={styles.consentRow}><input type="checkbox" checked={waitlistConsent} onChange={(event) => setWaitlistConsent(event.target.checked)} /><span><strong>Also add me to the YOVA waitlist.</strong> I agree to receive YOVA launch emails. I can unsubscribe at any time. Optional.</span></label>
                {submissionError && <p className={styles.formError} role="alert">{submissionError}</p>}
                <button type="submit" className={styles.primaryButton} disabled={isSubmitting || !emailIsValid || !ageConfirmed}>{isSubmitting ? "Building your report..." : "Email my report and see results"}{!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}</button>
                <span className={styles.srOnly} role="status" aria-live="polite">{isSubmitting ? "Building and saving your Study Profile report." : ""}</span>
                <p id="email-consent-note" className={styles.emailNote}>We use this email to send your private report link. No account is created.</p>
                <p className={styles.legalNote}>By continuing, you agree to our <Link href="/terms">Terms</Link> and acknowledge our <Link href="/privacy">Privacy Notice</Link>.</p>
              </form>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function StudyProfileLanding({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.landingPage}>
      <a className={styles.skipLink} href="#study-profile-landing">Skip to main content</a>
      <header className={styles.publicHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}><BrandMark /></Link>
        <nav className={styles.landingNav} aria-label="Study Profile"><a href="#what-is-yova">What is YOVA?</a><span>Free</span><button type="button" onClick={onStart}>Start the profile</button></nav>
      </header>
      <main id="study-profile-landing" tabIndex={-1}>
        <section className={styles.landingHero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroEyebrow}>Free Study Profile · about 3 minutes</span>
            <h1>Find out how you actually study.</h1>
            <p>14 quick questions. No account. You get a study pattern, a clearer view of what may be getting in the way, and practical methods selected from your answers. Free.</p>
            <div className={styles.heroActions}><button type="button" className={styles.primaryButton} onClick={onStart}>Get my free study profile <ArrowRight size={18} aria-hidden="true" /></button><span><Clock3 size={16} aria-hidden="true" /> 14 questions · about 3 minutes · no account needed</span></div>
            <div className={styles.heroTrust}><span><Check size={14} aria-hidden="true" /> Free full report</span><span><Check size={14} aria-hidden="true" /> Practical steps for tonight</span><span><ShieldCheck size={14} aria-hidden="true" /> Private report link</span></div>
          </div>
          <SamplePatternCard />
        </section>
        <section className={styles.valueSection} aria-labelledby="value-heading">
          <header className={styles.landingSectionHeading}><span className={styles.sectionEyebrow}>What you get</span><h2 id="value-heading">A report that gives you something to do next.</h2></header>
          <div className={styles.proofGrid}>
            <article><span><SearchCheck size={20} aria-hidden="true" /></span><h3>See what may be getting in the way.</h3><p>Your answers are scored across six study habits and highlight the area most worth trying first.</p></article>
            <article><span><BookOpenCheck size={20} aria-hidden="true" /></span><h3>Get practical methods with clear steps.</h3><p>The report turns broad advice, such as retrieval practice, into a concrete way to try it.</p></article>
            <article><span><TimerReset size={20} aria-hidden="true" /></span><h3>Walk away with tonight&apos;s session.</h3><p>A suggested block length, break timing, first step, and stopping point.</p></article>
          </div>
        </section>
        <section className={styles.howItWorks} aria-labelledby="how-heading">
          <header className={styles.landingSectionHeading}><span className={styles.sectionEyebrow}>How it works</span><h2 id="how-heading">About three minutes. A plan you can use tonight.</h2></header>
          <ol><li><span>01</span><div><strong>Answer honestly.</strong><p>14 quick questions about how you actually study, not how you wish you studied.</p></div></li><li><span>02</span><div><strong>Finish your profile.</strong><p>Your answers form a named pattern across six study habits.</p></div></li><li><span>03</span><div><strong>Unlock your results.</strong><p>Enter your email to open your private report. Joining the waitlist is optional.</p></div></li></ol>
        </section>
        <section className={styles.sampleResultSection} aria-labelledby="sample-heading">
          <div className={styles.sampleResultCopy}><span className={styles.lightEyebrow}>An example result</span><h2 id="sample-heading">Example: The Familiarity Trap.</h2><p>This learner rereads until the material feels easy, then rarely checks without notes. The first suggested step takes ten minutes to set up.</p><button type="button" className={styles.secondaryCta} onClick={onStart}>Find my pattern <ArrowRight size={17} aria-hidden="true" /></button></div>
          <div className={styles.sampleReportCard} aria-label="Example Familiarity Trap report"><span>YOVA Study Profile</span><h3>The Familiarity Trap</h3><p>Feels easy is not the same as known.</p><div><strong>Best first method</strong><span>Brain dump, then check the gaps</span></div></div>
        </section>
        <section id="what-is-yova" className={styles.yovaIntroSection} aria-labelledby="yova-heading">
          <div><span className={styles.sectionEyebrow}>What is YOVA?</span><h2 id="yova-heading">This profile is chapter one.</h2><p>YOVA builds your plan and runs your study sessions around your goal, materials, schedule, and this profile. The quiz asks how you work. The app finds out from what you actually do and keeps the plan current.</p><p>YOVA is coming soon. The profile is free, and so is the waitlist.</p></div>
          <LandingWaitlistForm idPrefix="yova-intro" />
        </section>
        <section className={styles.researchStrip} aria-label="Study Profile methodology summary"><Target size={23} aria-hidden="true" /><div><strong>Draws on established study techniques.</strong><p>Retrieval practice, spaced practice, and interleaving inform the suggestions. The match is a starting point based on your answers, not a diagnosis or personality test.</p></div></section>
        <section className={styles.finalCtaSection} aria-labelledby="final-cta-heading">
          <div><span className={styles.heroEyebrow}>Free · about 3 minutes · no account</span><h2 id="final-cta-heading">Ready to see what your answers suggest?</h2><button type="button" className={styles.primaryButton} onClick={onStart}>Get my free study profile <ArrowRight size={18} aria-hidden="true" /></button></div>
          <div><p>Not ready for the quiz? Join the YOVA waitlist instead.</p><LandingWaitlistForm idPrefix="final-waitlist" compact /></div>
        </section>
      </main>
      <footer className={styles.publicFooter}><BrandMark compact /><p>© {new Date().getFullYear()} YOVA. Your study system should adapt to you.</p><nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href={STUDY_PROFILE_SUPPORT_MAILTO}>Email support</a></nav></footer>
    </div>
  );
}

function SamplePatternCard() {
  const rows = [["Starting", 1], ["Planning", 1], ["Focus", 2], ["Self-testing", 3], ["Mistakes", 1], ["Energy", 2]] as const;
  return <div className={styles.reportPreview} aria-label="Example YOVA Study Profile result"><span className={styles.previewLabel}>Example result</span><h2>The Familiarity Trap</h2><p>Feels easy is not the same as known.</p><div className={styles.previewChart}>{rows.map(([label, active]) => <div key={label}><span>{label}</span><i>{[1, 2, 3].map((value) => <b key={value} data-active={value <= active} />)}</i></div>)}</div><div className={styles.previewFooter}><Zap size={17} aria-hidden="true" /><span><strong>Tonight</strong> Start with a 10-minute brain dump.</span></div></div>;
}

function LandingWaitlistForm({ idPrefix, compact = false }: { idPrefix: string; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "pending" | "joined" | "limited">("idle");
  const [error, setError] = useState<string | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const visitorId = getStudyProfileVisitorId();
    if (!visitorId) { setError("Your browser could not create a private waitlist session. Refresh and try again."); return; }
    setStatus("submitting");
    try {
      const response = await fetch("/api/study-profile/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, visitorId, consent, ageConfirmed, attribution: captureStudyProfileAttribution() }) });
      const payload = await response.json().catch(() => ({})) as { error?: unknown; waitlistJoined?: unknown; confirmationPending?: unknown; dailyCapReached?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "YOVA could not send the confirmation email. Try again.");
      if (payload.dailyCapReached === true) setStatus("limited");
      else if (payload.waitlistJoined === true) setStatus("joined");
      else if (payload.confirmationPending === true) setStatus("pending");
      else throw new Error("YOVA could not confirm the email request. Try again.");
    } catch (submitError) { setStatus("idle"); setError(submitError instanceof Error ? submitError.message : "YOVA could not send the confirmation email. Try again."); }
  }
  if (status === "joined") return <div className={styles.waitlistInlineSuccess} role="status"><CheckCircle2 size={20} aria-hidden="true" /><span><strong>You are on the list.</strong> We will email you when YOVA is ready. You can unsubscribe at any time.</span></div>;
  if (status === "limited") return <div className={styles.waitlistInlinePending} role="status"><Clock3 size={20} aria-hidden="true" /><span><strong>Try again later.</strong> To protect this inbox, YOVA cannot send another email today.</span></div>;
  if (status === "pending") return <div className={styles.waitlistInlinePending} role="status"><Mail size={20} aria-hidden="true" /><span><strong>Request received.</strong> If this address still needs confirmation, check the inbox for an email about YOVA launch updates. Already confirmed addresses stay on the list.</span></div>;
  return <form className={`${styles.landingWaitlistForm} ${compact ? styles.landingWaitlistCompact : ""}`} onSubmit={submit}>
    <label htmlFor={`${idPrefix}-email`}>Email address</label><div><input id={`${idPrefix}-email`} type="email" inputMode="email" autoComplete="email" maxLength={254} required value={email} placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} /><button type="submit" disabled={!valid || !consent || !ageConfirmed || status === "submitting"}>{status === "submitting" ? "Sending..." : "Join the waitlist"}</button></div>
    <label className={styles.waitlistConsent}><input type="checkbox" required checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span>I confirm I am 13 or older.</span></label>
    <label className={styles.waitlistConsent}><input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Email me when YOVA launches. I can unsubscribe at any time.</span></label>
    <p className={styles.legalNote}>See how YOVA uses your email in the <Link href="/privacy">Privacy Notice</Link>.</p>{error && <p className={styles.formError} role="alert">{error}</p>}
  </form>;
}

function QuestionScreen({ index, selected, onSelect, headingRef }: { index: number; selected?: StudyProfileAnswerId; onSelect: (answerId: StudyProfileAnswerId) => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const question = STUDY_PROFILE_QUESTIONS[index];
  const lastKey = String.fromCharCode(64 + question.options.length);
  return <section className={styles.questionScreen} aria-labelledby="current-question"><h1 id="current-question" ref={headingRef} tabIndex={-1}>{question.prompt}</h1><p className={styles.questionHint}>Choose what is usually true for you, even if it is not ideal.</p><div className={styles.answerList} role="radiogroup" aria-label={`Answers for question ${question.number}`}>{question.options.map((option, optionIndex) => <button type="button" key={option.id} role="radio" data-option-index={optionIndex} className={selected === option.id ? styles.answerSelected : undefined} aria-checked={selected === option.id} tabIndex={selected === option.id || (!selected && optionIndex === 0) ? 0 : -1} onClick={() => onSelect(option.id)}><span className={styles.answerKey}>{String.fromCharCode(65 + optionIndex)}</span><span>{option.label}</span><span className={styles.answerCheck} aria-hidden="true"><Check size={14} /></span></button>)}</div><p className={styles.keyboardHint}>Keyboard: press 1 to {question.options.length}, A to {lastKey}, or use arrow keys</p></section>;
}

function MetadataScreen({ headingRef, title, supporting, children }: { headingRef: RefObject<HTMLHeadingElement | null>; title: string; supporting: string; children: ReactNode }) {
  return <section className={styles.metadataScreen}><h1 ref={headingRef} tabIndex={-1}>{title}</h1><p className={styles.questionHint}>{supporting}</p>{children}</section>;
}

function resolveAssessmentStep(view: AssessmentView, currentQuestion: number) {
  const number = view === "question" ? Math.min(currentQuestion + 1, 12) : view === "goal" ? 13 : 14;
  if (view === "teaser") {
    return { number, label: "Profile complete", percent: 100, momentum: null };
  }
  const momentum = number === 7 ? "Halfway. Your pattern is starting to show." : number === 12 ? "Last one on habits." : null;
  return { number, label: `Question ${number} of ${TOTAL_STUDY_PROFILE_STEPS}`, percent: Math.round(((number - 1) / TOTAL_STUDY_PROFILE_STEPS) * 100), momentum };
}

function toCompletedAnswers(answers: Partial<StudyProfileAnswers>): StudyProfileAnswers | null {
  const answerIds = new Set(["a", "b", "c", "d"]);
  for (const question of STUDY_PROFILE_QUESTIONS) if (!answerIds.has(answers[question.id] ?? "")) return null;
  return answers as StudyProfileAnswers;
}

function isDraftView(value: unknown): value is Draft["view"] { return value === "question" || value === "goal" || value === "context" || value === "teaser"; }
function isAnswerDraft(value: unknown): value is Partial<StudyProfileAnswers> { return Boolean(value && typeof value === "object"); }
function isMetadataDraft(value: unknown): value is Partial<StudyProfileMetadata> { return Boolean(value && typeof value === "object"); }
function clampQuestionIndex(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(STUDY_PROFILE_QUESTIONS.length - 1, Math.floor(value))) : 0; }
function resolveEmailDelivery(result: SubmissionResult): "sent" | "skipped" | "failed" | "cooldown" | "daily_cap" | undefined { if (typeof result.emailDelivery === "string") return result.emailDelivery; if (result.emailDelivery && typeof result.emailDelivery === "object") return result.emailDelivery.status; if (result.emailSent === false) return "failed"; if (result.emailSent === true) return "sent"; if (result.emailDeliveryQueued === false) return "skipped"; return undefined; }

function readStudyProfileDraft(): Partial<Draft> | null {
  try {
    const saved = window.localStorage.getItem(DRAFT_STORAGE_KEY); if (!saved) return null;
    const raw = JSON.parse(saved) as Record<string, unknown>;
    const savedAt = raw.savedAt;
    const now = Date.now();
    if (
      typeof savedAt !== "number"
      || !Number.isFinite(savedAt)
      || savedAt > now
      || now - savedAt > STUDY_PROFILE_DRAFT_TTL_MS
    ) {
      clearStudyProfileDraft();
      return null;
    }
    const view = raw.view === "hardest" || raw.view === "energy" || raw.view === "school" ? "context" : raw.view;
    if (raw.version === STUDY_PROFILE_DRAFT_VERSION && isDraftView(view)) return { ...raw, view } as Partial<Draft>;
    clearStudyProfileDraft();
  } catch { clearStudyProfileDraft(); }
  return null;
}

function persistStudyProfileDraft(draft: Draft) {
  try {
    const stored: StoredDraft = { ...draft, savedAt: Date.now() };
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage is best effort.
  }
}
function clearStudyProfileDraft() { try { window.localStorage.removeItem(DRAFT_STORAGE_KEY); window.localStorage.removeItem(LEGACY_DRAFT_STORAGE_KEY); } catch { /* Clearing must never interrupt the flow. */ } }
function consumeRetakeRequest() { const url = new URL(window.location.href); clearStudyProfileDraft(); url.searchParams.delete("retake"); window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`); }
function hasRetakeRequest() { return new URL(window.location.href).searchParams.get("retake") === "1"; }
function hasStudyGoal(metadata: unknown): metadata is Partial<StudyProfileMetadata> & { studyGoal: StudyProfileStudyGoal } {
  if (!metadata || typeof metadata !== "object") return false;
  return GOAL_OPTIONS.some(({ value }) => value === (metadata as Partial<StudyProfileMetadata>).studyGoal);
}

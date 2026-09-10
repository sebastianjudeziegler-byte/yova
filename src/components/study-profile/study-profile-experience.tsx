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
  Layers3,
  ListChecks,
  Mail,
  MailCheck,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Target,
  TimerReset,
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
  type StudyProfileSchoolLevel,
  type StudyProfileStudyGoal,
} from "@/lib/study-profile";
import { STUDY_PROFILE_SUPPORT_MAILTO } from "@/lib/public-contact";
import styles from "./study-profile.module.css";

type AssessmentView = "landing" | "question" | "goal" | "context" | "teaser";

type Draft = {
  version: typeof STUDY_PROFILE_DRAFT_VERSION;
  view: Exclude<AssessmentView, "landing">;
  currentQuestion: number;
  answers: Partial<StudyProfileAnswers>;
  metadata: Partial<StudyProfileMetadata>;
};

type StoredDraft = Draft & {
  savedAt: number;
};

type SubmissionResult = { confirmationPending?: boolean };

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
  const [confirmationPending, setConfirmationPending] = useState(false);
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
    if (!hydrated || view === "landing") return;
    persistStudyProfileDraft({ version: STUDY_PROFILE_DRAFT_VERSION, view, currentQuestion, answers, metadata });
  }, [answers, currentQuestion, hydrated, metadata, view]);

  useEffect(() => {
    if (view === "landing") return;
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
    setConfirmationPending(false);
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
    if (!waitlistConsent) {
      setSubmissionError("Confirm that you want to join the YOVA waitlist to unlock your report.");
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
          under18: false,
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
        throw new Error(typeof payload.error === "string" ? payload.error : "We could not send your confirmation link. Check your email and try again.");
      }
      const result = ((payload.data && typeof payload.data === "object") ? payload.data : payload) as unknown as SubmissionResult;
      if (result.confirmationPending !== true) throw new Error("We could not confirm that your email is on its way. Try again.");
      clearStudyProfileDraft();
      setConfirmationPending(true);
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
        headingRef.current?.focus({ preventScroll: true });
      });
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "We could not send your confirmation link. Try again.");
    } finally {
      setIsSubmitting(false);
    }
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
        {!confirmationPending && <button type="button" className={styles.backButton} onClick={goBack}><ArrowLeft size={17} aria-hidden="true" /> Back</button>}
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
              <button type="button" className={styles.primaryButton} disabled={!metadata.energyWindow || !metadata.schoolLevel} onClick={completeContext}>Finish my profile <ArrowRight size={17} aria-hidden="true" /></button>
            </MetadataScreen>
          )}
          {view === "teaser" && completedAnswers && confirmationPending && (
            <section className={styles.teaserScreen} aria-labelledby="pattern-reveal-heading">
              <div className={styles.emailGate} role="status">
                <span className={styles.lockedResultStatus}><MailCheck size={15} aria-hidden="true" /> Confirmation sent</span>
                <h1 id="pattern-reveal-heading" ref={headingRef} tabIndex={-1}>Check your email to unlock your report.</h1>
                <p>Open the message from YOVA and select <strong>Confirm and view my results</strong>. Your report stays locked until you confirm.</p>
                <div className={styles.unlockList} aria-label="Your locked report includes">
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Your named study pattern and supporting signals</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Your highest-leverage change</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Three suggested methods to try</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> A plan for tonight</span>
                </div>
                <p className={styles.emailNote}>Check your spam folder if the message does not arrive within a few minutes.</p>
                <p className={styles.legalNote}>The confirmation link expires in 24 hours. See our <a href="/privacy">Privacy Notice</a>.</p>
              </div>
            </section>
          )}
          {view === "teaser" && completedAnswers && !confirmationPending && (
            <section className={styles.teaserScreen} aria-labelledby="pattern-reveal-heading">
              <form className={styles.emailGate} onSubmit={submitEmail} aria-busy={isSubmitting}>
                <span className={styles.lockedResultStatus}><LockKeyhole size={15} aria-hidden="true" /> Your results are ready</span>
                <h1 id="pattern-reveal-heading" ref={headingRef} tabIndex={-1}>Your study pattern is ready.</h1>
                <p>Join the YOVA waitlist to unlock your private report. We will email a secure confirmation link so you can confirm your place and view your results.</p>
                <label htmlFor="study-profile-email">Email for your confirmation link</label>
                <div className={styles.emailInputWrap}><Mail size={18} aria-hidden="true" /><input id="study-profile-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} aria-describedby="email-consent-note" /></div>
                <div className={styles.unlockList} aria-label="Full report includes">
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Your named study pattern and supporting signals</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Your highest-leverage change</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> Three suggested methods to try</span>
                  <span><CheckCircle2 size={17} aria-hidden="true" /> A plan for tonight</span>
                </div>
                <label className={styles.consentRow}><input type="checkbox" required checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} /><span><strong>I confirm I am 13 or older.</strong></span></label>
                <label className={styles.consentRow}><input type="checkbox" required checked={waitlistConsent} onChange={(event) => setWaitlistConsent(event.target.checked)} /><span><strong>Confirm my place on the YOVA waitlist and email me about YOVA&apos;s launch.</strong> I can unsubscribe at any time.</span></label>
                {submissionError && <p className={styles.formError} role="alert">{submissionError}</p>}
                <button type="submit" className={styles.primaryButton} disabled={isSubmitting || !emailIsValid || !ageConfirmed || !waitlistConsent}>{isSubmitting ? "Sending your confirmation link..." : "Send my confirmation link"}{!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}</button>
                <span className={styles.srOnly} role="status" aria-live="polite">{isSubmitting ? "Saving your Study Profile and sending your confirmation link." : ""}</span>
                <p id="email-consent-note" className={styles.emailNote}>We use this email to send your confirmation link and YOVA launch emails after you confirm. No account is created.</p>
                <p className={styles.legalNote}>By continuing, you agree to our <a href="/terms">Terms</a> and acknowledge our <a href="/privacy">Privacy Notice</a>.</p>
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
            <span className={styles.heroEyebrow}>Free Study Profile · 14 questions · about 3 minutes</span>
            <h1>Find out how you actually study.</h1>
            <p>Answer 14 questions. See the habit costing you the most time, three study methods matched to your answers, and a plan you can use tonight. Join the YOVA waitlist and confirm your email to open the report.</p>
            <div className={styles.heroActions}><button type="button" className={styles.primaryButton} onClick={onStart}>Get my free study profile <ArrowRight size={18} aria-hidden="true" /></button><span><Clock3 size={16} aria-hidden="true" /> Free · about 3 minutes · email confirmation required</span></div>
            <div className={styles.heroTrust}><span><Check size={14} aria-hidden="true" /> Six study habits scored</span><span><Check size={14} aria-hidden="true" /> Practical steps for tonight</span><span><ShieldCheck size={14} aria-hidden="true" /> Private report link</span></div>
          </div>
          <QuizQuestionPreview />
        </section>
        <section className={styles.landingFacts} aria-label="Study Profile details">
          <div><strong>14</strong><span>quick questions</span></div>
          <div><strong>6</strong><span>study habits scored</span></div>
          <div><strong>3</strong><span>methods matched</span></div>
          <div><strong>1</strong><span>plan for tonight</span></div>
        </section>
        <section className={styles.reportProofSection} aria-labelledby="report-proof-heading">
          <header className={styles.reportProofHeading}>
            <div><span className={styles.lightEyebrow}>Inside your report</span><h2 id="report-proof-heading">See what your answers turn into.</h2></div>
            <p>Your final matches depend on your answers. Every report gives you a clear place to start, methods to try, and a ready-to-use study block.</p>
          </header>
          <div className={styles.reportProofGrid}>
            <article className={styles.reportProofCard}>
              <div className={styles.reportProofCardHeader}><span><Layers3 size={19} aria-hidden="true" /></span><small>Your pattern and supporting signals</small></div>
              <h3>Your clearest habit, with context from the rest of your answers.</h3>
              <p>When a second habit is strong enough, the report explains how the two work together and gives that combination a practical focus.</p>
              <div className={styles.reportProofDetail}><strong>What this changes</strong><span>The first action in your plan</span></div>
            </article>
            <article className={styles.reportProofCard}>
              <div className={styles.reportProofCardHeader}><span><Target size={19} aria-hidden="true" /></span><small>Highest-leverage change</small></div>
              <h3>Work on the point where useful study time is leaking.</h3>
              <p>Your strongest signal sets the first habit to improve, so the report stays focused and usable.</p>
              <div className={styles.reportProofDetail}><strong>First move</strong><span>One change you can try in your next session</span></div>
            </article>
            <article className={`${styles.reportProofCard} ${styles.methodProofCard}`}>
              <div className={styles.reportProofCardHeader}><span><BookOpenCheck size={19} aria-hidden="true" /></span><small>Top methods matched</small></div>
              <ol><li><b>01</b><span>Active recall</span></li><li><b>02</b><span>Spaced practice</span></li><li><b>03</b><span>Five-minute start</span></li></ol>
              <p>The order and explanation change with your profile and current study goal.</p>
            </article>
            <article className={`${styles.reportProofCard} ${styles.sessionProofCard}`}>
              <div className={styles.reportProofCardHeader}><span><TimerReset size={19} aria-hidden="true" /></span><small>A plan for tonight</small></div>
              <div className={styles.sessionProofStats}><span><strong>20</strong> min work</span><span><strong>5</strong> min break</span><span><strong>2</strong> rounds</span></div>
              <p>You also get a first step, focus rule, learning check, and a clear stopping point.</p>
            </article>
          </div>
          <button type="button" className={styles.secondaryCta} onClick={onStart}>Build my profile <ArrowRight size={17} aria-hidden="true" /></button>
        </section>
        <section className={styles.howItWorks} aria-labelledby="how-heading">
          <header className={styles.landingSectionHeading}><span className={styles.sectionEyebrow}>How it works</span><h2 id="how-heading">About three minutes. A plan you can use tonight.</h2></header>
          <ol><li><span>01</span><div><strong>Answer 14 questions.</strong><p>Choose the answer that matches what happens most often.</p></div></li><li><span>02</span><div><strong>Join and confirm.</strong><p>Use your email to join the YOVA waitlist and open your private report.</p></div></li><li><span>03</span><div><strong>Try the plan.</strong><p>Start with the highest-leverage change and one matched method.</p></div></li></ol>
        </section>
        <section id="what-is-yova" className={styles.yovaIntroSection} aria-labelledby="yova-heading">
          <div className={styles.yovaIntroCopy}>
            <span className={styles.sectionEyebrow}>What is YOVA?</span>
            <h2 id="yova-heading">Your profile becomes the starting point for YOVA.</h2>
            <p>YOVA builds a study plan around your goal, deadlines, materials, schedule, and study habits. It guides each session and updates what comes next from the work you finish.</p>
            <div className={styles.yovaProductSteps}>
              <div><span><Target size={18} aria-hidden="true" /></span><p><strong>Plan the week</strong>Put the right work into the time you have.</p></div>
              <div><span><ListChecks size={18} aria-hidden="true" /></span><p><strong>Run the session</strong>Open a clear task, method, and stopping point.</p></div>
              <div><span><SearchCheck size={18} aria-hidden="true" /></span><p><strong>Keep it current</strong>Use completed work to shape the next plan.</p></div>
            </div>
          </div>
          <aside className={styles.waitlistPitch} aria-label="YOVA waitlist">
            <span className={styles.heroEyebrow}>YOVA is coming soon</span>
            <h3>Get your report now and reserve your place.</h3>
            <p>Complete the profile and confirm your email. You will open the full report and join the list for YOVA launch updates.</p>
            <ul><li><CheckCircle2 size={16} aria-hidden="true" /> Free Study Profile</li><li><CheckCircle2 size={16} aria-hidden="true" /> Private report link</li><li><CheckCircle2 size={16} aria-hidden="true" /> Launch updates by email</li></ul>
            <button type="button" className={styles.primaryButton} onClick={onStart}>Start the free profile <ArrowRight size={17} aria-hidden="true" /></button>
            <small>No account is created. You can unsubscribe at any time.</small>
          </aside>
        </section>
        <section className={styles.researchStrip} aria-label="Study Profile methodology summary"><Target size={23} aria-hidden="true" /><div><strong>Draws on established study techniques.</strong><p>Retrieval practice, spaced practice, and interleaving inform the suggestions. The report is educational and does not provide a medical, psychological, or learning-disability diagnosis.</p></div></section>
        <section className={styles.faqSection} aria-labelledby="faq-heading">
          <header className={styles.landingSectionHeading}><span className={styles.sectionEyebrow}>Before you start</span><h2 id="faq-heading">A few useful details.</h2></header>
          <div className={styles.faqGrid}><article><h3>Is the Study Profile free?</h3><p>Yes. The quiz, report, and YOVA waitlist are free.</p></article><article><h3>Why do I need to confirm my email?</h3><p>The confirmation unlocks your private report link and confirms your place on the waitlist.</p></article><article><h3>What happens after I join?</h3><p>You can use the report straight away. We will email you when YOVA is ready to try.</p></article></div>
        </section>
        <section className={styles.finalCtaSection} aria-labelledby="final-cta-heading">
          <div><span className={styles.heroEyebrow}>Free · about 3 minutes</span><h2 id="final-cta-heading">Ready to see what your answers suggest?</h2><p>Complete the profile, join the waitlist, and open a practical report built from your answers.</p></div>
          <div className={styles.finalCtaAction}><button type="button" className={styles.primaryButton} onClick={onStart}>Get my free study profile <ArrowRight size={18} aria-hidden="true" /></button><span><Clock3 size={15} aria-hidden="true" /> Email confirmation required</span></div>
        </section>
      </main>
      <footer className={styles.publicFooter}><BrandMark compact /><p>© {new Date().getFullYear()} YOVA. Your study system should adapt to you.</p><nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href={STUDY_PROFILE_SUPPORT_MAILTO}>Email support</a></nav></footer>
    </div>
  );
}

function QuizQuestionPreview() {
  const question = STUDY_PROFILE_QUESTIONS[2];
  return <aside className={styles.questionPreview} aria-label="A question from the YOVA Study Profile">
    <div className={styles.questionPreviewMeta}><span>A question from the profile</span><small>Question {question.number} of 14</small></div>
    <div className={styles.questionPreviewProgress} aria-hidden="true"><span /></div>
    <h2>{question.prompt}</h2>
    <ol>{question.options.map((option, index) => <li key={option.id}><span>{String.fromCharCode(65 + index)}</span><p>{option.label}</p><i aria-hidden="true" /></li>)}</ol>
    <p className={styles.questionPreviewNote}>Choose the answer that happens most often.</p>
  </aside>;
}

function QuestionScreen({ index, selected, onSelect, headingRef }: { index: number; selected?: StudyProfileAnswerId; onSelect: (answerId: StudyProfileAnswerId) => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const question = STUDY_PROFILE_QUESTIONS[index];
  const lastKey = String.fromCharCode(64 + question.options.length);
  return <section className={styles.questionScreen} aria-labelledby="current-question"><h1 id="current-question" ref={headingRef} tabIndex={-1}>{question.prompt}</h1><p className={styles.questionHint}>Choose what happens most often.</p><div className={styles.answerList} role="radiogroup" aria-label={`Answers for question ${question.number}`}>{question.options.map((option, optionIndex) => <button type="button" key={option.id} role="radio" data-option-index={optionIndex} className={selected === option.id ? styles.answerSelected : undefined} aria-checked={selected === option.id} tabIndex={selected === option.id || (!selected && optionIndex === 0) ? 0 : -1} onClick={() => onSelect(option.id)}><span className={styles.answerKey}>{String.fromCharCode(65 + optionIndex)}</span><span>{option.label}</span><span className={styles.answerCheck} aria-hidden="true"><Check size={14} /></span></button>)}</div><p className={styles.keyboardHint}>Keyboard: press 1 to {question.options.length}, A to {lastKey}, or use arrow keys</p></section>;
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

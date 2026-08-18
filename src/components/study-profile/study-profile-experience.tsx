"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  Focus,
  LockKeyhole,
  Mail,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  captureStudyProfileAttribution,
  getStudyProfileVisitorId,
  trackStudyProfileEvent,
} from "@/lib/study-profile/analytics-client";
import {
  STUDY_PROFILE_MODEL_VERSION,
  STUDY_PROFILE_QUESTIONS,
  buildStudyProfileReport,
  scoreStudyProfile,
  type StudyProfileAnswerId,
  type StudyProfileAnswers,
  type StudyProfileAttribution,
  type StudyProfileEnergyWindow,
  type StudyProfileMetadata,
  type StudyProfilePublicStoredResponse,
  type StudyProfileReport,
  type StudyProfileSchoolLevel,
} from "@/lib/study-profile";
import { STUDY_PROFILE_SUPPORT_MAILTO } from "@/lib/public-contact";
import { StudyProfileReportView } from "./study-profile-report-view";
import styles from "./study-profile.module.css";

type AssessmentView = "landing" | "question" | "energy" | "school" | "teaser" | "report";

type Draft = {
  version: typeof STUDY_PROFILE_MODEL_VERSION;
  view: Exclude<AssessmentView, "landing" | "report">;
  currentQuestion: number;
  answers: Partial<StudyProfileAnswers>;
  metadata: Partial<StudyProfileMetadata>;
};

type SubmissionResult = {
  reportToken: string;
  reportUrl?: string;
  storedResponse: StudyProfilePublicStoredResponse;
  report: StudyProfileReport;
  emailDelivery?: "sent" | "skipped" | "failed" | { status?: "sent" | "skipped" | "failed" };
  emailSent?: boolean;
  emailDeliveryQueued?: boolean;
  waitlistJoined?: boolean;
};

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";

const ENERGY_OPTIONS: readonly { value: StudyProfileEnergyWindow; label: string; detail: string }[] = [
  { value: "morning", label: "Morning", detail: "Before noon" },
  { value: "afternoon", label: "Afternoon", detail: "Roughly noon to 5 PM" },
  { value: "evening", label: "Evening", detail: "Roughly 5 to 10 PM" },
  { value: "late_night", label: "Late night", detail: "After 10pm" },
  { value: "varies", label: "It varies", detail: "No consistent window" },
] as const;

const SCHOOL_OPTIONS: readonly { value: StudyProfileSchoolLevel; label: string; detail: string }[] = [
  { value: "high_school", label: "High school", detail: "Grades 9 to 12 or equivalent" },
  { value: "college", label: "College", detail: "Undergraduate or graduate" },
  { value: "other", label: "Other", detail: "Another learning path" },
] as const;

const PREVIEW_DIMENSIONS = [
  ["Getting started", "Hard to begin", 3],
  ["Planning and structure", "Clear steps help", 3],
  ["Staying focused", "Changes sometimes", 2],
  ["Checking what you know", "Mixed", 2],
  ["Handling mistakes", "Some concern", 2],
  ["Mental energy", "Longer blocks can work", 1],
] as const;

export function StudyProfileExperience() {
  const [view, setView] = useState<AssessmentView>("landing");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Partial<StudyProfileAnswers>>({});
  const [metadata, setMetadata] = useState<Partial<StudyProfileMetadata>>({});
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const attributionRef = useRef<StudyProfileAttribution>({});
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pageViewedRef = useRef(false);
  const completionTrackedRef = useRef(false);

  useEffect(() => {
    const nextAttribution = captureStudyProfileAttribution();
    attributionRef.current = nextAttribution;
    const restoredDraft = readStudyProfileDraft();

    const hydrationFrame = window.requestAnimationFrame(() => {
      if (restoredDraft && isDraftView(restoredDraft.view)) {
        setAnswers(isAnswerDraft(restoredDraft.answers) ? restoredDraft.answers : {});
        setMetadata(isMetadataDraft(restoredDraft.metadata) ? restoredDraft.metadata : {});
        setCurrentQuestion(clampQuestionIndex(restoredDraft.currentQuestion));
        setView(restoredDraft.view);
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
    const draft: Draft = {
      version: STUDY_PROFILE_MODEL_VERSION,
      view,
      currentQuestion,
      answers,
      metadata,
    };
    persistStudyProfileDraft(draft);
  }, [answers, currentQuestion, hydrated, metadata, view]);

  useEffect(() => {
    if (view === "landing" || view === "report") return;
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus();
      window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentQuestion, view]);

  useEffect(() => {
    if (view !== "question") return;
    function handleShortcut(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const index = ["1", "2", "3", "4"].indexOf(key);
      const letterIndex = ["a", "b", "c", "d"].indexOf(key);
      let optionIndex = index >= 0 ? index : letterIndex;
      if (optionIndex < 0 && (key === "arrowright" || key === "arrowdown" || key === "arrowleft" || key === "arrowup")) {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement) || activeElement.getAttribute("role") !== "radio") return;
        const activeIndex = Number(activeElement.dataset.optionIndex);
        if (!Number.isInteger(activeIndex)) return;
        const direction = key === "arrowright" || key === "arrowdown" ? 1 : -1;
        optionIndex = (activeIndex + direction + 4) % 4;
      }
      if (optionIndex < 0) return;
      event.preventDefault();
      const option = STUDY_PROFILE_QUESTIONS[currentQuestion]?.options[optionIndex];
      if (option) answerQuestion(option.id);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const completedAnswers = useMemo(
    () => toCompletedAnswers(answers),
    [answers],
  );

  const teaserReport = useMemo(() => {
    if (!completedAnswers) return null;
    return buildStudyProfileReport(scoreStudyProfile(completedAnswers), metadata, completedAnswers);
  }, [completedAnswers, metadata]);

  function startQuiz() {
    setView("question");
    void trackStudyProfileEvent("study_profile_started");
  }

  function answerQuestion(answerId: StudyProfileAnswerId) {
    const question = STUDY_PROFILE_QUESTIONS[currentQuestion];
    if (!question) return;

    setAnswers((current) => ({ ...current, [question.id]: answerId }));
    void trackStudyProfileEvent("study_profile_question_answered", {
      questionNumber: question.number,
    });

    if (currentQuestion < STUDY_PROFILE_QUESTIONS.length - 1) {
      setCurrentQuestion((index) => index + 1);
    } else {
      setView("energy");
    }
  }

  function selectEnergy(value: StudyProfileEnergyWindow) {
    setMetadata((current) => ({ ...current, energyWindow: value }));
    setView("school");
  }

  function selectSchool(value: StudyProfileSchoolLevel) {
    setMetadata((current) => ({ ...current, schoolLevel: value }));
    if (!completedAnswers || !metadata.energyWindow) return;
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
      return;
    }
    if (view === "energy") {
      setCurrentQuestion(STUDY_PROFILE_QUESTIONS.length - 1);
      setView("question");
    } else if (view === "school") {
      setView("energy");
    } else if (view === "teaser") {
      setView("school");
    }
  }

  function restartAssessment() {
    const hasProgress = Object.keys(answers).length > 0 || view !== "landing";
    if (hasProgress && !window.confirm("Restart your Study Profile and clear your saved answers?")) return;
    clearStudyProfileDraft();
    setAnswers({});
    setMetadata({});
    setCurrentQuestion(0);
    setEmail("");
    setSubmissionError(null);
    setSubmissionResult(null);
    completionTrackedRef.current = false;
    setView("landing");
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmissionError(null);
    if (!completedAnswers || !metadata.energyWindow || !metadata.schoolLevel) {
      setSubmissionError("Your saved assessment is incomplete. Please go back and finish it.");
      return;
    }

    setIsSubmitting(true);

    try {
      const visitorId = getStudyProfileVisitorId();
      if (!visitorId) {
        throw new Error("Your browser could not create a private report session. Please refresh and try again.");
      }
      const response = await fetch("/api/study-profile/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitorId,
          email,
          answers: completedAnswers,
          metadata: {
            energyWindow: metadata.energyWindow,
            schoolLevel: metadata.schoolLevel,
            hardestPart: null,
          },
          marketingConsent: false,
          attribution: attributionRef.current,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : "We couldn’t save your report. Please check your email and try again.";
        throw new Error(message);
      }

      const result = ((payload.data && typeof payload.data === "object") ? payload.data : payload) as unknown as SubmissionResult;
      if (!result.reportToken || !result.storedResponse || !result.report) {
        throw new Error("Your report was created, but the response was incomplete. Please try again.");
      }

      setSubmissionResult(result);
      clearStudyProfileDraft();
      const reportPath = result.reportUrl
        ? new URL(result.reportUrl, window.location.href)
        : new URL(`/study-profile/report/${encodeURIComponent(result.reportToken)}`, window.location.href);
      window.history.replaceState({}, "", `${reportPath.pathname}${reportPath.search}${reportPath.hash}`);
      setView("report");
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      void trackStudyProfileEvent("study_profile_report_viewed");
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : "We couldn’t save your report. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (view === "report" && submissionResult) {
    return (
      <StudyProfileReportView
        storedResponse={submissionResult.storedResponse}
        report={submissionResult.report}
        reportToken={submissionResult.reportToken}
        emailDelivery={resolveEmailDelivery(submissionResult)}
        initialWaitlistJoined={submissionResult.waitlistJoined}
        autoFocusHeading
      />
    );
  }

  if (view === "landing") {
    return <StudyProfileLanding onStart={startQuiz} />;
  }

  const assessmentStep = resolveAssessmentStep(view, currentQuestion);

  return (
    <div className={styles.assessmentPage}>
      <a className={styles.skipLink} href="#assessment-content">Skip to question</a>
      <header className={styles.assessmentHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}><BrandMark /></Link>
        <div className={styles.assessmentHeaderActions}>
          <span><LockKeyhole size={13} aria-hidden="true" /> Saved on this device</span>
          <button type="button" onClick={restartAssessment}>
            <RefreshCw size={14} aria-hidden="true" /> Restart
          </button>
        </div>
      </header>

      <div
        className={styles.progressShell}
        role="progressbar"
        aria-label="Study Profile progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={assessmentStep.percent}
        aria-valuetext={assessmentStep.label}
      >
        <div className={styles.progressMeta}>
          <span>{assessmentStep.label}</span>
          <span>{assessmentStep.percent}%</span>
        </div>
        <div className={styles.progressTrack}>
          <span style={{ width: `${assessmentStep.percent}%` }} />
        </div>
      </div>

      <main id="assessment-content" className={styles.assessmentMain} tabIndex={-1}>
        <button type="button" className={styles.backButton} onClick={goBack}>
          <ArrowLeft size={17} aria-hidden="true" /> Back
        </button>

        <div className={styles.questionTransition} key={`${view}-${currentQuestion}`}>
          {view === "question" && (
            <QuestionScreen
              index={currentQuestion}
              selected={answers[STUDY_PROFILE_QUESTIONS[currentQuestion].id]}
              onSelect={answerQuestion}
              headingRef={headingRef}
            />
          )}

          {view === "energy" && (
            <MetadataScreen
              headingRef={headingRef}
              eyebrow="Profile context · 1 of 2"
              title="When are you usually strongest for demanding schoolwork?"
              supporting="Choose the time when you can focus best on hard work."
            >
              <div className={styles.metadataOptions}>
                {ENERGY_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={metadata.energyWindow === option.value ? styles.optionSelected : undefined}
                    aria-pressed={metadata.energyWindow === option.value}
                    onClick={() => selectEnergy(option.value)}
                  >
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </MetadataScreen>
          )}

          {view === "school" && (
            <MetadataScreen
              headingRef={headingRef}
              eyebrow="Profile context · 2 of 2"
              title="What best describes you?"
              supporting="This lets us use examples that fit your setting. It does not change your quiz results."
            >
              <div className={styles.metadataOptions}>
                {SCHOOL_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={metadata.schoolLevel === option.value ? styles.optionSelected : undefined}
                    aria-pressed={metadata.schoolLevel === option.value}
                    onClick={() => selectSchool(option.value)}
                  >
                    <span>{option.label}</span>
                    <small>{option.detail}</small>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </MetadataScreen>
          )}

          {view === "teaser" && teaserReport && (
            <section className={styles.teaserScreen}>
              <div className={styles.readyMark} aria-hidden="true"><Check size={26} /></div>
              <span className={styles.sectionEyebrow}>Assessment complete</span>
              <h1 ref={headingRef} tabIndex={-1}>Your YOVA Study Profile is ready.</h1>
              <p className={styles.teaserIntro}>
                Here is your top result. Enter your email to see the full report and methods to try.
              </p>

              <div className={styles.teaserPattern}>
                <div>
                  <span>Your top result</span>
                  <h2>{teaserReport.primaryPattern.name}</h2>
                </div>
                <strong>{teaserReport.primaryPattern.label}</strong>
              </div>

              <div className={styles.unlockList} aria-label="Full report includes">
                <span><CheckCircle2 size={17} aria-hidden="true" /> What is helping and getting in your way</span>
                <span><CheckCircle2 size={17} aria-hidden="true" /> Study methods matched to your answers</span>
                <span><CheckCircle2 size={17} aria-hidden="true" /> A routine for your next study session</span>
              </div>

              <form className={styles.emailGate} onSubmit={submitEmail} aria-busy={isSubmitting}>
                <label htmlFor="study-profile-email">Where should we send your private report link?</label>
                <div className={styles.emailInputWrap}>
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id="study-profile-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-describedby="email-consent-note"
                  />
                </div>
                <p id="email-consent-note" className={styles.emailNote}>
                  We’ll use this to save and send your report. No account or password required.
                </p>

                {submissionError && <p className={styles.formError} role="alert">{submissionError}</p>}

                <button type="submit" className={styles.primaryButton} disabled={isSubmitting || !email.trim()}>
                  {isSubmitting ? "Building your report..." : "Get my full report"}
                  {!isSubmitting && <ArrowRight size={17} aria-hidden="true" />}
                </button>
                <span className={styles.srOnly} role="status" aria-live="polite">
                  {isSubmitting ? "Building and saving your Study Profile report." : ""}
                </span>
                <p className={styles.legalNote}>
                  By continuing, you agree to our <Link href="/terms">Terms</Link> and acknowledge our <Link href="/privacy">Privacy Policy</Link>.
                </p>
              </form>
            </section>
          )}
        </div>
      </main>

      <div className={styles.assessmentAside} aria-hidden="true">
        <div><SlidersHorizontal size={18} /><span>Person-first</span></div>
        <div><ShieldCheck size={18} /><span>Non-clinical</span></div>
        <div><Clock3 size={18} /><span>About 3 min</span></div>
      </div>
    </div>
  );
}

function StudyProfileLanding({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.landingPage}>
      <a className={styles.skipLink} href="#study-profile-landing">Skip to main content</a>
      <header className={styles.publicHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}><BrandMark /></Link>
        <span className={styles.comingSoon}><span /> YOVA is coming soon</span>
      </header>

      <main id="study-profile-landing" tabIndex={-1}>
        <section className={styles.landingHero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroEyebrow}><BarChart3 size={15} aria-hidden="true" /> YOVA Study Profile</span>
            <h1>Find study methods that fit how you actually work.</h1>
            <p>
              Answer 12 questions and get clear ways to start sooner, stay focused, remember more,
              and use your study time better.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.primaryButton} onClick={onStart}>
                Get my recommendations <ArrowRight size={18} aria-hidden="true" />
              </button>
              <span><Clock3 size={16} aria-hidden="true" /> 12 questions · about 3 minutes</span>
            </div>
            <div className={styles.heroTrust}>
              <span><Check size={14} aria-hidden="true" /> Practical study recommendations</span>
              <span><Check size={14} aria-hidden="true" /> No account required</span>
              <span><ShieldCheck size={14} aria-hidden="true" /> Based on learning research</span>
            </div>
          </div>

          <div className={styles.reportPreview} aria-label="Illustrative Study Profile report preview">
            <div className={styles.previewTopbar}>
              <div><span /><span /><span /></div>
              <span>Illustrative preview</span>
            </div>
            <div className={styles.previewHeader}>
              <span>Your YOVA Study Profile</span>
              <h2>A study plan you can use today.</h2>
              <p>See what to change and why.</p>
            </div>
            <div className={styles.previewPrimary}>
              <div><Target size={18} aria-hidden="true" /></div>
              <span>Main opportunity</span>
              <strong>Getting Started: Hard to begin</strong>
              <p>Use a five minute start and choose the first action before the session.</p>
            </div>
            <div className={styles.previewDimensions}>
              {PREVIEW_DIMENSIONS.map(([name, label, range]) => (
                <div key={name}>
                  <span>{name}</span>
                  <div aria-hidden="true">
                    {[1, 2, 3].map((segment) => (
                      <i key={segment} className={segment <= range ? styles.previewRangeActive : undefined} />
                    ))}
                  </div>
                  <strong>{label}</strong>
                </div>
              ))}
            </div>
            <div className={styles.previewFooter}>
              <Zap size={17} aria-hidden="true" />
              <span><strong>Try this today</strong> Start with one planned 10 minute block.</span>
            </div>
          </div>
        </section>

        <section className={styles.personFirstSection} aria-labelledby="person-first-heading">
          <div className={styles.personFirstIntro}>
            <span className={styles.sectionEyebrow}>Your habits should shape your plan</span>
            <h2 id="person-first-heading">The right study plan depends on how you work.</h2>
            <p>
              YOVA looks at how you begin, plan, focus, check your knowledge, handle mistakes,
              and use your mental energy.
            </p>
          </div>
          <div className={styles.proofGrid}>
            <article>
              <span><Focus size={20} aria-hidden="true" /></span>
              <h3>See what is helping or slowing you down</h3>
              <p>Your results describe current study habits. This is not a personality test.</p>
            </article>
            <article>
              <span><SlidersHorizontal size={20} aria-hidden="true" /></span>
              <h3>Get methods you can try today</h3>
              <p>Follow exact steps for active recall, spaced practice, planning, focus, mistakes, and timing.</p>
            </article>
            <article>
              <span><Eye size={20} aria-hidden="true" /></span>
              <h3>Start with a real session plan</h3>
              <p>See a suggested block length, break, start routine, checking rule, and stopping point.</p>
            </article>
          </div>
          <button type="button" className={styles.secondaryCta} onClick={onStart}>
            Get my recommendations <ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>

        <section className={styles.researchStrip} aria-label="Study Profile methodology summary">
          <SearchCheck size={23} aria-hidden="true" />
          <div>
            <strong>Based on learning research.</strong>
            <p>
              Recommendations draw on research about learning, practice, attention, planning, and
              study habits. This is not a medical, neurological, or psychological diagnosis.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.publicFooter}>
        <BrandMark compact />
        <p>© {new Date().getFullYear()} YOVA. Your study system should adapt to you.</p>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href={STUDY_PROFILE_SUPPORT_MAILTO}>Email support</a>
        </nav>
      </footer>
    </div>
  );
}

function QuestionScreen({
  index,
  selected,
  onSelect,
  headingRef,
}: {
  index: number;
  selected?: StudyProfileAnswerId;
  onSelect: (answerId: StudyProfileAnswerId) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const question = STUDY_PROFILE_QUESTIONS[index];
  return (
    <section className={styles.questionScreen} aria-labelledby="current-question">
      <span className={styles.questionKicker}>Question {question.number} of {STUDY_PROFILE_QUESTIONS.length}</span>
      <h1 id="current-question" ref={headingRef} tabIndex={-1}>{question.prompt}</h1>
      <p className={styles.questionHint}>Choose what is usually true for you, even if it is not ideal.</p>
      <div className={styles.answerList} role="radiogroup" aria-label={`Answers for question ${question.number}`}>
        {question.options.map((option, optionIndex) => (
          <button
            type="button"
            key={option.id}
            role="radio"
            data-option-index={optionIndex}
            className={selected === option.id ? styles.answerSelected : undefined}
            aria-checked={selected === option.id}
            tabIndex={selected === option.id || (!selected && optionIndex === 0) ? 0 : -1}
            onClick={() => onSelect(option.id)}
          >
            <span className={styles.answerKey}>{String.fromCharCode(65 + optionIndex)}</span>
            <span>{option.label}</span>
            <span className={styles.answerCheck} aria-hidden="true"><Check size={14} /></span>
          </button>
        ))}
      </div>
      <p className={styles.keyboardHint}>Keyboard: press 1 to 4, A to D, or use arrow keys to choose</p>
    </section>
  );
}

function MetadataScreen({
  headingRef,
  eyebrow,
  title,
  supporting,
  children,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  eyebrow: string;
  title: string;
  supporting: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.metadataScreen}>
      <span className={styles.questionKicker}>{eyebrow}</span>
      <h1 ref={headingRef} tabIndex={-1}>{title}</h1>
      <p className={styles.questionHint}>{supporting}</p>
      {children}
    </section>
  );
}

function resolveAssessmentStep(view: AssessmentView, currentQuestion: number) {
  if (view === "question") {
    const question = Math.min(currentQuestion + 1, STUDY_PROFILE_QUESTIONS.length);
    return { label: `Question ${question} of ${STUDY_PROFILE_QUESTIONS.length}`, percent: Math.round((question / 14) * 100) };
  }
  if (view === "energy") return { label: "Profile context · 1 of 2", percent: 93 };
  if (view === "school") return { label: "Profile context · 2 of 2", percent: 97 };
  return { label: "Assessment complete", percent: 100 };
}

function toCompletedAnswers(answers: Partial<StudyProfileAnswers>): StudyProfileAnswers | null {
  const answerIds = new Set(["a", "b", "c", "d"]);
  for (const question of STUDY_PROFILE_QUESTIONS) {
    if (!answerIds.has(answers[question.id] ?? "")) return null;
  }
  return answers as StudyProfileAnswers;
}

function isDraftView(value: unknown): value is Draft["view"] {
  return value === "question" || value === "energy" || value === "school" || value === "teaser";
}

function isAnswerDraft(value: unknown): value is Partial<StudyProfileAnswers> {
  return Boolean(value && typeof value === "object");
}

function isMetadataDraft(value: unknown): value is Partial<StudyProfileMetadata> {
  return Boolean(value && typeof value === "object");
}

function clampQuestionIndex(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(STUDY_PROFILE_QUESTIONS.length - 1, Math.floor(value)))
    : 0;
}

function resolveEmailDelivery(result: SubmissionResult): "sent" | "skipped" | "failed" | undefined {
  if (typeof result.emailDelivery === "string") return result.emailDelivery;
  if (result.emailDelivery && typeof result.emailDelivery === "object") return result.emailDelivery.status;
  if (result.emailSent === false) return "failed";
  if (result.emailSent === true) return "sent";
  if (result.emailDeliveryQueued === false) return "skipped";
  return undefined;
}

function readStudyProfileDraft(): Partial<Draft> | null {
  try {
    const saved = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!saved) return null;
    const raw = JSON.parse(saved) as Record<string, unknown>;
    const view = raw.view === "hardest" ? "teaser" : raw.view;
    if (raw.version === STUDY_PROFILE_MODEL_VERSION && isDraftView(view)) {
      return { ...raw, view } as Partial<Draft>;
    }
    clearStudyProfileDraft();
  } catch {
    clearStudyProfileDraft();
  }
  return null;
}

function persistStudyProfileDraft(draft: Draft) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage is best-effort; privacy-restricted browsers can still complete the assessment.
  }
}

function clearStudyProfileDraft() {
  try {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Storage is best-effort; clearing a draft must never interrupt the flow.
  }
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

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
import { StudyProfileReportView } from "./study-profile-report-view";
import styles from "./study-profile.module.css";

type AssessmentView = "landing" | "question" | "energy" | "school" | "hardest" | "teaser" | "report";

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
  betaInterest?: boolean | null;
};

const DRAFT_STORAGE_KEY = "yova.study-profile.draft.v1";

const ENERGY_OPTIONS: readonly { value: StudyProfileEnergyWindow; label: string; detail: string }[] = [
  { value: "morning", label: "Morning", detail: "Before noon" },
  { value: "afternoon", label: "Afternoon", detail: "Roughly noon–5pm" },
  { value: "evening", label: "Evening", detail: "Roughly 5–10pm" },
  { value: "late_night", label: "Late night", detail: "After 10pm" },
  { value: "varies", label: "It varies", detail: "No consistent window" },
] as const;

const SCHOOL_OPTIONS: readonly { value: StudyProfileSchoolLevel; label: string; detail: string }[] = [
  { value: "high_school", label: "High school", detail: "Grades 9–12 or equivalent" },
  { value: "college", label: "College", detail: "Undergraduate or graduate" },
  { value: "other", label: "Other", detail: "Another learning path" },
] as const;

const PREVIEW_DIMENSIONS = [
  ["Starting friction", "High", 3],
  ["Structure need", "High-structure", 3],
  ["Attention variability", "Variable", 2],
  ["Confidence calibration", "Mixed", 2],
  ["Mistake sensitivity", "Moderate", 2],
  ["Cognitive stamina", "Stable", 1],
] as const;

export function StudyProfileExperience() {
  const [view, setView] = useState<AssessmentView>("landing");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Partial<StudyProfileAnswers>>({});
  const [metadata, setMetadata] = useState<Partial<StudyProfileMetadata>>({});
  const [email, setEmail] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
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
    return buildStudyProfileReport(scoreStudyProfile(completedAnswers), metadata);
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
    setView("hardest");
  }

  function completeAssessment() {
    if (!completedAnswers || !metadata.energyWindow || !metadata.schoolLevel) return;
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
    } else if (view === "hardest") {
      setView("school");
    } else if (view === "teaser") {
      setView("hardest");
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
    setMarketingConsent(false);
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
            hardestPart: metadata.hardestPart?.trim() || null,
          },
          marketingConsent,
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
        initialBetaInterest={submissionResult.betaInterest}
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
              eyebrow="Profile context · 1 of 3"
              title="When are you usually strongest for demanding schoolwork?"
              supporting="Choose the window when difficult thinking tends to feel most usable."
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
              eyebrow="Profile context · 2 of 3"
              title="What best describes you?"
              supporting="This gives us context for the report. It does not change your core scores."
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

          {view === "hardest" && (
            <MetadataScreen
              headingRef={headingRef}
              eyebrow="Profile context · 3 of 3 · Optional"
              title="What is the hardest part of studying for you right now?"
              supporting="A sentence is plenty. You can also skip this without changing your profile."
            >
              <label className={styles.textareaField}>
                <span className={styles.srOnly}>Hardest part of studying</span>
                <textarea
                  maxLength={600}
                  rows={5}
                  value={metadata.hardestPart ?? ""}
                  onChange={(event) => setMetadata((current) => ({
                    ...current,
                    hardestPart: event.target.value,
                  }))}
                  placeholder="For example: I know what I should do, but I keep putting off the first step."
                />
                <small>{metadata.hardestPart?.length ?? 0}/600</small>
              </label>
              <button type="button" className={styles.primaryButton} onClick={completeAssessment}>
                See my initial result <ArrowRight size={17} aria-hidden="true" />
              </button>
            </MetadataScreen>
          )}

          {view === "teaser" && teaserReport && (
            <section className={styles.teaserScreen}>
              <div className={styles.readyMark} aria-hidden="true"><Check size={26} /></div>
              <span className={styles.sectionEyebrow}>Assessment complete</span>
              <h1 ref={headingRef} tabIndex={-1}>Your YOVA Study Profile is ready.</h1>
              <p className={styles.teaserIntro}>
                Your answers produced a real profile. Here is the clearest signal before you unlock the full report.
              </p>

              <div className={styles.teaserPattern}>
                <div>
                  <span>Your clearest pattern</span>
                  <h2>{teaserReport.primaryPattern.name}</h2>
                </div>
                <strong>{teaserReport.primaryPattern.label}</strong>
              </div>

              <div className={styles.unlockList} aria-label="Full report includes">
                <span><CheckCircle2 size={17} aria-hidden="true" /> How your six tendencies connect</span>
                <span><CheckCircle2 size={17} aria-hidden="true" /> A personalized study protocol</span>
                <span><CheckCircle2 size={17} aria-hidden="true" /> How YOVA would adapt around you</span>
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

                <label className={styles.consentCheckbox}>
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(event) => setMarketingConsent(event.target.checked)}
                  />
                  <span>
                    Also email me occasional YOVA launch and early-access updates. Optional; unsubscribe any time.
                  </span>
                </label>

                {submissionError && <p className={styles.formError} role="alert">{submissionError}</p>}

                <button type="submit" className={styles.primaryButton} disabled={isSubmitting || !email.trim()}>
                  {isSubmitting ? "Building your report…" : "Get my full report"}
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
            <h1>Why doesn’t studying work the same way for everyone?</h1>
            <p>
              Take YOVA’s 3-minute Study Profile to uncover the tendencies shaping how you start,
              focus, and follow through—then see how your study system should adapt to you.
            </p>
            <div className={styles.heroActions}>
              <button type="button" className={styles.primaryButton} onClick={onStart}>
                Find my study profile <ArrowRight size={18} aria-hidden="true" />
              </button>
              <span><Clock3 size={16} aria-hidden="true" /> 12 questions · about 3 minutes</span>
            </div>
            <div className={styles.heroTrust}>
              <span><Check size={14} aria-hidden="true" /> Personalized web report</span>
              <span><Check size={14} aria-hidden="true" /> No account required</span>
              <span><ShieldCheck size={14} aria-hidden="true" /> Research-informed, non-clinical</span>
            </div>
          </div>

          <div className={styles.reportPreview} aria-label="Illustrative Study Profile report preview">
            <div className={styles.previewTopbar}>
              <div><span /><span /><span /></div>
              <span>Illustrative preview</span>
            </div>
            <div className={styles.previewHeader}>
              <span>Your initial YOVA Study Profile</span>
              <h2>A study system built around the learner.</h2>
              <p>Six signals shape the first set of adaptations.</p>
            </div>
            <div className={styles.previewPrimary}>
              <div><Target size={18} aria-hidden="true" /></div>
              <span>Primary pattern</span>
              <strong>Starting Friction · High</strong>
              <p>Make the first action smaller, more concrete, and easier to begin.</p>
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
              <span><strong>Try this today</strong> Start with one pre-decided 10-minute block.</span>
            </div>
          </div>
        </section>

        <section className={styles.personFirstSection} aria-labelledby="person-first-heading">
          <div className={styles.personFirstIntro}>
            <span className={styles.sectionEyebrow}>The person changes the plan</span>
            <h2 id="person-first-heading">The same exam shouldn’t create the same study experience.</h2>
            <p>
              YOVA starts with the learner: their starting patterns, need for structure, attention,
              response to mistakes, confidence, and usable energy.
            </p>
          </div>
          <div className={styles.proofGrid}>
            <article>
              <span><Focus size={20} aria-hidden="true" /></span>
              <h3>See your current patterns</h3>
              <p>A useful, cautious read of six study-behavior signals—not a fixed personality type.</p>
            </article>
            <article>
              <span><SlidersHorizontal size={20} aria-hidden="true" /></span>
              <h3>Get specific adaptations</h3>
              <p>See what to change about starting, structure, focus, retrieval, mistakes, and timing.</p>
            </article>
            <article>
              <span><Eye size={20} aria-hidden="true" /></span>
              <h3>Preview the YOVA difference</h3>
              <p>The quiz learns from what you tell us. YOVA is being built to learn from what you do.</p>
            </article>
          </div>
          <button type="button" className={styles.secondaryCta} onClick={onStart}>
            Find my study profile <ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>

        <section className={styles.researchStrip} aria-label="Study Profile methodology summary">
          <SearchCheck size={23} aria-hidden="true" />
          <div>
            <strong>Built with scientific restraint.</strong>
            <p>
              Recommendations are informed by learning, self-regulation, metacognition, attention,
              avoidance, and study-behavior research. This is an initial profile—not a medical,
              neurological, or psychological diagnosis.
            </p>
          </div>
        </section>
      </main>

      <footer className={styles.publicFooter}>
        <BrandMark compact />
        <p>© {new Date().getFullYear()} YOVA · Your study system should adapt to you.</p>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/support">Support</Link>
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
      <p className={styles.questionHint}>Choose the answer that is most often true—not the one that feels ideal.</p>
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
      <p className={styles.keyboardHint}>Keyboard: press 1–4, A–D, or use arrow keys to choose</p>
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
    return { label: `Question ${question} of ${STUDY_PROFILE_QUESTIONS.length}`, percent: Math.round((question / 15) * 100) };
  }
  if (view === "energy") return { label: "Profile context · 1 of 3", percent: 87 };
  if (view === "school") return { label: "Profile context · 2 of 3", percent: 93 };
  if (view === "hardest") return { label: "Profile context · 3 of 3", percent: 97 };
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
  return value === "question" || value === "energy" || value === "school" || value === "hardest" || value === "teaser";
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
    const draft = JSON.parse(saved) as Partial<Draft>;
    if (draft.version === STUDY_PROFILE_MODEL_VERSION && isDraftView(draft.view)) return draft;
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

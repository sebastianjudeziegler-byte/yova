"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  Layers3,
  ListChecks,
  LockKeyhole,
  MailCheck,
  RefreshCw,
  Share2,
  ShieldCheck,
  Target,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  STUDY_PROFILE_STUDY_GOAL_LABELS,
  type StudyProfileMethodFit,
  type StudyProfilePublicStoredResponse,
  type StudyProfileReport,
} from "@/lib/study-profile";
import { trackStudyProfileEvent } from "@/lib/study-profile/analytics-client";
import { STUDY_PROFILE_SUPPORT_MAILTO } from "@/lib/public-contact";
import { StudyProfileHabitChart } from "./study-profile-habit-chart";
import {
  createStudyProfileShareImage,
  type StudyProfileShareFormat,
} from "./study-profile-share";
import styles from "./study-profile.module.css";

type ReportViewProps = {
  storedResponse: StudyProfilePublicStoredResponse;
  report: StudyProfileReport;
  reportToken: string;
  emailDelivery?: "sent" | "skipped" | "failed" | "cooldown" | "daily_cap";
  initialWaitlistJoined?: boolean;
  initialWaitlistConfirmationPending?: boolean;
  initialWaitlistDailyCapReached?: boolean;
  initialWaitlistError?: string | null;
  autoFocusHeading?: boolean;
};

type InterestState = "idle" | "pending" | "joined" | "limited";
type InterestLocation = "banner" | "closing";
type ShareState = "idle" | "working";

const ENERGY_LABELS: Record<StudyProfilePublicStoredResponse["metadata"]["energyWindow"], string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  late_night: "Late night",
  varies: "Varies",
};

const LEVEL_LABELS: Record<StudyProfilePublicStoredResponse["metadata"]["schoolLevel"], string> = {
  high_school: "High school",
  college: "College",
  other: "Another learning path",
};

export function StudyProfileReportView({
  storedResponse,
  report,
  reportToken,
  emailDelivery,
  initialWaitlistJoined = false,
  initialWaitlistConfirmationPending = false,
  initialWaitlistDailyCapReached = false,
  initialWaitlistError = null,
  autoFocusHeading = false,
}: ReportViewProps) {
  const [interestState, setInterestState] = useState<InterestState>(
    initialWaitlistJoined
      ? "joined"
      : initialWaitlistDailyCapReached
        ? "limited"
      : initialWaitlistConfirmationPending
        ? "pending"
        : "idle",
  );
  const [interestError, setInterestError] = useState<string | null>(null);
  const [isInterestRequesting, setIsInterestRequesting] = useState(false);
  const [waitlistAgeConfirmed, setWaitlistAgeConfirmed] = useState(false);
  const [interestLocation, setInterestLocation] = useState<InterestLocation>("banner");
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const hasJoinedWaitlist = interestState === "joined" || initialWaitlistJoined;
  const hasPendingConfirmation = !hasJoinedWaitlist && (
    interestState === "pending" || initialWaitlistConfirmationPending
  );
  const hasReachedDailyCap = !hasJoinedWaitlist && (
    interestState === "limited" || initialWaitlistDailyCapReached
  );
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);
  const bannerWaitlistStatusRef = useRef<HTMLDivElement>(null);
  const closingWaitlistStatusRef = useRef<HTMLDivElement>(null);
  const shouldManageInterestFocusRef = useRef(false);
  const hasTrackedReportViewRef = useRef(false);

  useEffect(() => {
    if (hasTrackedReportViewRef.current) return;
    hasTrackedReportViewRef.current = true;
    void trackStudyProfileEvent("study_profile_report_viewed");
  }, []);

  useEffect(() => {
    if (!autoFocusHeading) return;
    const frame = window.requestAnimationFrame(() => reportHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusHeading]);

  useEffect(() => {
    if (
      !shouldManageInterestFocusRef.current
      || (interestState !== "joined" && interestState !== "pending" && interestState !== "limited")
    ) return;
    const frame = window.requestAnimationFrame(() => {
      const target = interestLocation === "banner"
        ? bannerWaitlistStatusRef.current
        : closingWaitlistStatusRef.current;
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interestLocation, interestState]);

  async function joinWaitlist(location: InterestLocation) {
    setInterestLocation(location);
    shouldManageInterestFocusRef.current = true;
    setInterestError(null);
    if (!waitlistAgeConfirmed) {
      setInterestError("Confirm that you are 13 or older before requesting the email.");
      return;
    }
    setIsInterestRequesting(true);
    try {
      const response = await fetch(`/api/study-profile/interest/${encodeURIComponent(reportToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          waitlist: true,
          ageConfirmed: true,
          source: "report_cta",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: unknown; waitlistJoined?: unknown; confirmationPending?: unknown; dailyCapReached?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We could not send the confirmation email. Try again.");
      if (payload.dailyCapReached === true) setInterestState("limited");
      else if (payload.waitlistJoined === true) setInterestState("joined");
      else if (payload.confirmationPending === true) setInterestState("pending");
      else throw new Error("We could not confirm the email request. Try again.");
    } catch (error) {
      setInterestError(error instanceof Error ? error.message : "We could not send the confirmation email. Try again.");
    } finally {
      setIsInterestRequesting(false);
    }
  }

  async function sharePattern(format: StudyProfileShareFormat, nativeShare: boolean) {
    void trackStudyProfileEvent("study_profile_share_tapped", { shareFormat: format });
    setShareMessage(null);
    setShareState("working");
    try {
      const blob = await createStudyProfileShareImage(report, format);
      const filename = `yova-${report.pattern.id}-${format}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (nativeShare && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: `My YOVA Study Profile: ${report.pattern.name}`,
          text: "Find your study pattern at yovaapp.com/study-profile",
          files: [file],
        });
        setShareMessage("Share sheet opened.");
      } else {
        downloadBlob(blob, filename);
        setShareMessage(format === "story" ? "Story image downloaded." : "Share image downloaded.");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setShareMessage("Your browser could not create the image. Try again.");
      }
    } finally {
      setShareState("idle");
    }
  }

  const goal = storedResponse.metadata.studyGoal
    ? STUDY_PROFILE_STUDY_GOAL_LABELS[storedResponse.metadata.studyGoal]
    : null;

  return (
    <div className={styles.reportPage}>
      <a className={styles.skipLink} href="#study-profile-report">Skip to report</a>
      <header className={styles.publicHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}><BrandMark /></Link>
        <div className={styles.reportHeaderMeta}>
          <span><LockKeyhole size={14} aria-hidden="true" /> Private report</span>
          <a href="/study-profile?retake=1" className={styles.headerLink}>Retake <RefreshCw size={14} aria-hidden="true" /></a>
        </div>
      </header>

      <main id="study-profile-report" className={styles.reportMain} tabIndex={-1}>
        {emailDelivery === "cooldown" && (
          <div className={`${styles.deliveryNotice} ${styles.deliveryInfo}`} role="status">
            <Clock3 size={18} aria-hidden="true" />
            <div><strong>Your report is ready here.</strong><span>YOVA sent a recent report to this email, so we skipped another copy to protect your inbox. Save this private link if you want to return.</span></div>
          </div>
        )}
        {emailDelivery === "daily_cap" && (
          <div className={`${styles.deliveryNotice} ${styles.deliveryInfo}`} role="status">
            <Clock3 size={18} aria-hidden="true" />
            <div><strong>Your report is ready here.</strong><span>To protect this inbox, YOVA did not send another email today. Save this private link and try again later if you need another copy.</span></div>
          </div>
        )}
        {(emailDelivery === "failed" || emailDelivery === "skipped") && (
          <div className={styles.deliveryNotice} role="status">
            <TriangleAlert size={18} aria-hidden="true" />
            <div><strong>Your report is ready here.</strong><span>We could not send the email copy, so save this private link if you want to return.</span></div>
          </div>
        )}
        {initialWaitlistError && !hasJoinedWaitlist && (
          <div className={styles.deliveryNotice} role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <div><strong>Your report is ready.</strong><span>{initialWaitlistError}</span></div>
          </div>
        )}

        <section className={styles.reportHero} aria-labelledby="report-title">
          <div className={styles.reportHeroCopy}>
            <span className={styles.darkEyebrow}>Your YOVA Study Profile</span>
            <h1 id="report-title" ref={reportHeadingRef} tabIndex={-1}>{report.pattern.name}.</h1>
            <p className={styles.patternTell}>{report.pattern.tell}</p>
            <strong className={styles.patternTwist}>{report.pattern.twist}</strong>
            {report.pattern.modifier && <span className={styles.patternModifier}>{report.pattern.modifier}</span>}
            <div className={styles.contextPills} aria-label="Profile context">
              <span><Zap size={14} aria-hidden="true" /> Best focus time: {ENERGY_LABELS[storedResponse.metadata.energyWindow]}</span>
              {goal && <span><Target size={14} aria-hidden="true" /> {goal}</span>}
              <span><Layers3 size={14} aria-hidden="true" /> {LEVEL_LABELS[storedResponse.metadata.schoolLevel]}</span>
            </div>
            <p className={styles.productThread}>This report starts with your answers. YOVA keeps learning from your real study sessions so the plan can stay useful.</p>
          </div>
          <div className={styles.heroChartCard}>
            <span className={styles.lightEyebrow}>Your six habits</span>
            <StudyProfileHabitChart overview={report.overview} compact />
          </div>
        </section>

        <div className={styles.reportBody}>
          <section className={styles.waitlistBanner} aria-label="YOVA waitlist status">
            <div><strong>Want YOVA to build around this profile?</strong><span>Join the waitlist with the email connected to this report. Free to join.</span>{!hasJoinedWaitlist && !hasReachedDailyCap && <WaitlistAgeAffirmation checked={waitlistAgeConfirmed} onChange={setWaitlistAgeConfirmed} />}</div>
            {!hasJoinedWaitlist && !hasPendingConfirmation && !hasReachedDailyCap ? (
              <button type="button" className={styles.primaryButton} onClick={() => void joinWaitlist("banner")} disabled={isInterestRequesting || !waitlistAgeConfirmed} aria-busy={isInterestRequesting}>{isInterestRequesting ? "Sending..." : "Send confirmation email"}</button>
            ) : hasJoinedWaitlist ? (
              <div className={styles.interestSuccess} role={interestLocation === "banner" ? "status" : undefined} ref={bannerWaitlistStatusRef} tabIndex={interestLocation === "banner" ? -1 : undefined}><CheckCircle2 size={20} aria-hidden="true" /><span><strong>You are on the waitlist.</strong> We will email you when YOVA is ready.</span></div>
            ) : hasReachedDailyCap ? (
              <LimitedWaitlistStatus location="banner" activeLocation={interestLocation} statusRef={bannerWaitlistStatusRef} />
            ) : (
              <PendingWaitlistStatus location="banner" activeLocation={interestLocation} statusRef={bannerWaitlistStatusRef} requesting={isInterestRequesting} canRequest={waitlistAgeConfirmed} onRetry={() => void joinWaitlist("banner")} />
            )}
            {interestError && interestLocation === "banner" && <p className={styles.formError} role="alert">{interestError}</p>}
          </section>

          <section className={styles.whySection} aria-labelledby="why-heading">
            <div className={styles.sectionNumber}>01</div>
            <div><span className={styles.sectionEyebrow}>Matched from your answers</span><h2 id="why-heading">{report.whyThisIsHappening.heading}</h2><p>{report.whyThisIsHappening.body}</p></div>
          </section>

          <section className={styles.reportSection} aria-labelledby="top-methods-heading">
            <SectionHeading number="02" eyebrow="Your strongest matches" title="Your top three methods" body={report.playbook.intro} id="top-methods-heading" />
            <div className={styles.topMethodGrid}>
              {report.playbook.methods.map((method, index) => (
                <article className={styles.topMethodCard} data-testid="study-method-card" key={method.id}>
                  <div className={styles.methodCardHeader}><span>{String(index + 1).padStart(2, "0")}</span><div><small>Strong match</small><h3>{method.name}</h3></div></div>
                  <div className={styles.methodMeta}><span><Clock3 size={14} aria-hidden="true" /> {method.timeCost}</span></div>
                  <p className={styles.methodFit}><strong>Why this fits</strong>{method.whyItFits}</p>
                  <ol>{method.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                  <p className={styles.tonightVersion}><strong>Tonight version</strong>{method.tonightVersion}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.reportSection} aria-labelledby="catalog-heading">
            <SectionHeading number="03" eyebrow="Save this for later" title="Your 15-method catalog" body="The badge changes with your pattern. Start with strong fits, use situational methods when the task calls for them, and leave skip-for-now methods until the bigger friction is handled." id="catalog-heading" />
            <div className={styles.methodCatalogGrid}>
              {report.methodCatalog.map((method) => (
                <details className={styles.catalogCard} key={method.id}>
                  <summary>
                    <div><span className={`${styles.fitBadge} ${fitClass(method.fit)}`}>{method.fitLabel}</span><h3>{method.name}</h3><p>{method.whatItIs}</p></div>
                    <span><Clock3 size={14} aria-hidden="true" /> {method.timeCost}</span>
                  </summary>
                  <div className={styles.catalogDetail}>
                    <p><strong>Why it works</strong>{method.whyItWorks}</p>
                    <ol>{method.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                    <p className={styles.tonightVersion}><strong>Try it tonight</strong>{method.tonightVersion}</p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          <section className={styles.sessionPlan} aria-labelledby="tonight-heading">
            <div className={styles.sessionPlanHeader}><span><TimerReset size={22} aria-hidden="true" /></span><div><span className={styles.lightEyebrow}>Tonight&apos;s session</span><h2 id="tonight-heading">One block. A clear start. A clear stop.</h2></div></div>
            <div className={styles.sessionStats} aria-label="Suggested study timing">
              <span><strong>{report.playbook.nextSession.workMinutes}</strong> minutes working</span>
              <span><strong>{report.playbook.nextSession.breakMinutes}</strong> minute break</span>
              <span><strong>{report.playbook.nextSession.rounds}</strong> {report.playbook.nextSession.rounds === 1 ? "round" : "rounds"}</span>
            </div>
            <div className={styles.sessionPlanGrid}>
              <div><h3>Set it up</h3><ol>{report.playbook.nextSession.setupSteps.map((step) => <li key={step}>{step}</li>)}</ol></div>
              <div className={styles.sessionRules}><p><strong>Best time</strong>{report.playbook.nextSession.bestTime}</p><p><strong>Focus rule</strong>{report.playbook.nextSession.focusRule}</p><p><strong>Check your learning</strong>{report.playbook.nextSession.checkingRule}</p><p><strong>Stop rule</strong>{report.playbook.nextSession.stopRule}</p></div>
            </div>
            <p className={styles.sessionProductLine}>This plan is static. It cannot see how tonight goes. YOVA runs sessions like this and adjusts the next one from what happened.</p>
          </section>

          <section className={styles.reportSection} aria-labelledby="habits-heading">
            <SectionHeading number="04" eyebrow="The full picture" title="Your six study habits" body="These are current habits, not fixed traits. Each one can change with practice and context." id="habits-heading" />
            <div className={styles.dimensionGrid}>
              {report.overview.map((habit) => <article className={styles.dimensionCard} key={habit.dimension}><span className={styles.levelTag}>{habit.label}</span><h3>{habit.name}</h3><p>{habit.detail}</p></article>)}
            </div>
          </section>

          <section className={styles.reportSection} aria-labelledby="traps-heading">
            <SectionHeading number="05" eyebrow="Keep an eye on these" title="Common traps to avoid" id="traps-heading" />
            <div className={styles.warningGrid}>{report.warnings.map((warning, index) => <article key={warning.id}><span>{String(index + 1).padStart(2, "0")}</span><h3>{warning.title}</h3><p>{warning.detail}</p></article>)}</div>
          </section>

          <section className={styles.shareSection} aria-labelledby="share-heading">
            <div className={styles.sharePreview}>
              <span>YOVA Study Profile</span><h3>{report.pattern.name}</h3><p>{report.pattern.tell}</p><strong>yovaapp.com/study-profile</strong>
            </div>
            <div className={styles.shareCopy}>
              <span className={styles.sectionEyebrow}>Made to share</span>
              <h2 id="share-heading">Share your pattern, not your private report.</h2>
              <p>The image includes your pattern and chart. It never includes your email, answers, or private report link.</p>
              <div><button type="button" className={styles.primaryButton} disabled={shareState === "working"} onClick={() => void sharePattern("square", true)}><Share2 size={17} aria-hidden="true" /> Share my pattern</button><button type="button" className={styles.secondaryCta} disabled={shareState === "working"} onClick={() => void sharePattern("story", false)}><Download size={17} aria-hidden="true" /> Download story</button></div>
              {shareMessage && <p className={styles.shareStatus} role="status">{shareMessage}</p>}
            </div>
          </section>

          <section className={styles.waitlistSection} aria-labelledby="waitlist-heading">
            <div className={styles.waitlistIcon}><ListChecks size={25} aria-hidden="true" /></div>
            <div className={styles.waitlistCopy}>
              <span className={styles.sectionEyebrow}>YOVA waitlist</span>
              <h2 id="waitlist-heading">Your profile is a snapshot. It is already aging.</h2>
              <p>Habits shift and deadlines move. YOVA builds your plan around your goal, materials, and schedule, then updates it from what you actually do.</p>
              <p>Free to join. Launch news only. Unsubscribe anytime.</p>
              {!hasJoinedWaitlist && !hasReachedDailyCap && <WaitlistAgeAffirmation checked={waitlistAgeConfirmed} onChange={setWaitlistAgeConfirmed} />}
            </div>
            {!hasJoinedWaitlist && !hasPendingConfirmation && !hasReachedDailyCap ? <button type="button" className={styles.primaryButton} onClick={() => void joinWaitlist("closing")} disabled={isInterestRequesting || !waitlistAgeConfirmed} aria-busy={isInterestRequesting}>{isInterestRequesting ? "Sending..." : "Send confirmation email"}<ArrowRight size={17} aria-hidden="true" /></button> : hasJoinedWaitlist ? <div className={styles.interestSuccess} role={interestLocation === "closing" ? "status" : undefined} ref={closingWaitlistStatusRef} tabIndex={interestLocation === "closing" ? -1 : undefined}><CheckCircle2 size={20} aria-hidden="true" /><span><strong>You are on the waitlist.</strong> We will email you when YOVA is ready.</span></div> : hasReachedDailyCap ? <LimitedWaitlistStatus location="closing" activeLocation={interestLocation} statusRef={closingWaitlistStatusRef} /> : <PendingWaitlistStatus location="closing" activeLocation={interestLocation} statusRef={closingWaitlistStatusRef} requesting={isInterestRequesting} canRequest={waitlistAgeConfirmed} onRetry={() => void joinWaitlist("closing")} />}
            {interestError && interestLocation === "closing" && <p className={styles.formError} role="alert">{interestError}</p>}
          </section>

          <aside className={styles.methodology} aria-labelledby="methodology-heading">
            <div><ShieldCheck size={20} aria-hidden="true" /></div>
            <div><h2 id="methodology-heading">About your Study Profile</h2><p>Your report uses fixed scoring rules and your own answers to match practical study methods. It is not a medical, neurological, psychological, or learning-disability diagnosis.</p><p className={styles.researchAreas}>Informed by retrieval practice, spaced practice, metacognition, planning, attention, and study behavior.</p></div>
          </aside>
        </div>
      </main>

      <footer className={styles.publicFooter}><BrandMark compact /><p>© {new Date().getFullYear()} YOVA. Your study system should adapt to you.</p><nav aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href={STUDY_PROFILE_SUPPORT_MAILTO}>Email support</a></nav></footer>
    </div>
  );
}

function PendingWaitlistStatus({
  location,
  activeLocation,
  statusRef,
  requesting,
  canRequest,
  onRetry,
}: {
  location: InterestLocation;
  activeLocation: InterestLocation;
  statusRef: RefObject<HTMLDivElement | null>;
  requesting: boolean;
  canRequest: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={styles.interestPending}
      role={activeLocation === location ? "status" : undefined}
      ref={statusRef}
      tabIndex={activeLocation === location ? -1 : undefined}
    >
      <MailCheck size={20} aria-hidden="true" />
      <div>
        <strong>Request received.</strong>
        <span>If this address still needs confirmation, check the inbox for an email. Already confirmed addresses stay on the list.</span>
        <button type="button" onClick={onRetry} disabled={requesting || !canRequest} aria-busy={requesting}>
          {requesting ? "Checking..." : "Send confirmation email again"}
        </button>
        <small>YOVA sends at most one confirmation email every 15 minutes.</small>
      </div>
    </div>
  );
}

function WaitlistAgeAffirmation({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.waitlistAgeConsent}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>I confirm I am 13 or older.</span>
    </label>
  );
}

function LimitedWaitlistStatus({
  location,
  activeLocation,
  statusRef,
}: {
  location: InterestLocation;
  activeLocation: InterestLocation;
  statusRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      className={styles.interestPending}
      role={activeLocation === location ? "status" : undefined}
      ref={statusRef}
      tabIndex={activeLocation === location ? -1 : undefined}
    >
      <Clock3 size={20} aria-hidden="true" />
      <div>
        <strong>Try again later.</strong>
        <span>To protect this inbox, YOVA cannot send another confirmation email today. Save this private report link and try again later.</span>
      </div>
    </div>
  );
}

function SectionHeading({ number, eyebrow, title, body, id }: { number: string; eyebrow: string; title: string; body?: string; id: string }) {
  return <header className={styles.sectionHeading}><span className={styles.sectionNumber}>{number}</span><div><span className={styles.sectionEyebrow}>{eyebrow}</span><h2 id={id}>{title}</h2>{body && <p>{body}</p>}</div></header>;
}

function fitClass(fit: StudyProfileMethodFit) {
  if (fit === "strong_fit") return styles.fitStrong;
  if (fit === "skip_for_now") return styles.fitSkip;
  return styles.fitSituational;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

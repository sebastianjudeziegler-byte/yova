"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  CircleGauge,
  Clock3,
  Eye,
  Focus,
  Layers3,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  type StudyProfileDimension,
  type StudyProfilePublicStoredResponse,
  type StudyProfileReport,
  STUDY_PROFILE_WAITLIST_CONTENT,
} from "@/lib/study-profile";
import { STUDY_PROFILE_SUPPORT_MAILTO } from "@/lib/public-contact";
import styles from "./study-profile.module.css";

type ReportViewProps = {
  storedResponse: StudyProfilePublicStoredResponse;
  report: StudyProfileReport;
  reportToken: string;
  emailDelivery?: "sent" | "skipped" | "failed";
  initialWaitlistJoined?: boolean;
  autoFocusHeading?: boolean;
};

type InterestState = "idle" | "joining" | "joined";

const DIMENSION_ICONS: Record<StudyProfileDimension, ComponentType<{ size?: number }>> = {
  starting_friction: Play,
  structure_need: Layers3,
  attention_variability: Focus,
  calibration_risk: SearchCheck,
  mistake_sensitivity: ShieldCheck,
  cognitive_stamina: CircleGauge,
};

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
  other: "Other",
};

export function StudyProfileReportView({
  storedResponse,
  report,
  reportToken,
  emailDelivery,
  initialWaitlistJoined = false,
  autoFocusHeading = false,
}: ReportViewProps) {
  const [interestState, setInterestState] = useState<InterestState>(
    initialWaitlistJoined ? "joined" : "idle",
  );
  const [interestError, setInterestError] = useState<string | null>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);
  const waitlistStatusRef = useRef<HTMLDivElement>(null);
  const shouldManageInterestFocusRef = useRef(false);

  useEffect(() => {
    if (!autoFocusHeading) return;
    const frame = window.requestAnimationFrame(() => reportHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusHeading]);

  useEffect(() => {
    if (!shouldManageInterestFocusRef.current) return;
    if (interestState !== "joined") return;
    const frame = window.requestAnimationFrame(() => {
      waitlistStatusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interestState]);

  async function joinWaitlist() {
    shouldManageInterestFocusRef.current = true;
    setInterestError(null);
    setInterestState("joining");

    try {
      const response = await fetch(
        `/api/study-profile/interest/${encodeURIComponent(reportToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ waitlist: true }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: unknown;
        waitlistJoined?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "We couldn’t add you to the waitlist. Please try again.",
        );
      }
      if (payload.waitlistJoined !== true) {
        throw new Error("We couldn’t confirm your waitlist signup. Please try again.");
      }
      setInterestState("joined");
    } catch (error) {
      setInterestState("idle");
      setInterestError(
        error instanceof Error
          ? error.message
          : "We couldn’t add you to the waitlist. Please try again.",
      );
    }
  }

  return (
    <div className={styles.reportPage}>
      <a className={styles.skipLink} href="#study-profile-report">
        Skip to report
      </a>

      <header className={styles.publicHeader}>
        <Link href="/" aria-label="YOVA home" className={styles.brandLink}>
          <BrandMark />
        </Link>
        <div className={styles.reportHeaderMeta}>
          <span><LockKeyhole size={14} aria-hidden="true" /> Private report</span>
          <Link href="/study-profile" className={styles.headerLink}>
            Retake <RefreshCw size={14} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main id="study-profile-report" className={styles.reportMain} tabIndex={-1}>
        {(emailDelivery === "failed" || emailDelivery === "skipped") && (
          <div className={styles.deliveryNotice} role="status">
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Your report is ready here.</strong>
              <span>
                {emailDelivery === "skipped"
                  ? "We could not send an email copy, so save this private link if you want to return."
                  : "The email could not be sent, so save this private link if you want to return."}
              </span>
            </div>
          </div>
        )}

        <section className={styles.reportHero} aria-labelledby="report-title">
          <div className={styles.reportHeroGlow} aria-hidden="true" />
          <div className={styles.reportHeroCopy}>
            <span className={styles.darkEyebrow}>Your YOVA Study Profile</span>
            <h1 id="report-title" ref={reportHeadingRef} tabIndex={-1}>{report.profileNarrative.heading}</h1>
            <div className={styles.heroPattern}>
              <span>{report.primaryPattern.name}</span>
              <strong>{report.primaryPattern.label}</strong>
            </div>
            <p>
              {report.profileNarrative.body} {report.primaryPattern.summary}
            </p>
            <div className={styles.contextPills} aria-label="Profile context">
              <span><Zap size={14} aria-hidden="true" /> Best focus time: {ENERGY_LABELS[storedResponse.metadata.energyWindow]}</span>
              <span><Layers3 size={14} aria-hidden="true" /> {LEVEL_LABELS[storedResponse.metadata.schoolLevel]}</span>
            </div>
          </div>
          <div className={styles.heroSignalCard} aria-label="Primary and secondary patterns">
            <span className={styles.signalIndex}>01</span>
            <div>
              <small>Main opportunity</small>
              <strong>{report.primaryPattern.name}</strong>
              <span>{report.primaryPattern.label}</span>
            </div>
            <div className={styles.signalDivider} />
            <span className={styles.signalIndex}>02</span>
            <div>
              <small>Another area</small>
              <strong>{report.secondaryPattern.name}</strong>
              <span>{report.secondaryPattern.label}</span>
            </div>
          </div>
        </section>

        <div className={styles.reportBody}>
          <section className={styles.reportSection} aria-labelledby="playbook-heading">
            <SectionHeading
              number="01"
              eyebrow={report.sectionHeadings.methods}
              title={report.playbook.heading}
              body={report.playbook.intro}
              id="playbook-heading"
            />

            <article className={styles.sessionPlan} aria-labelledby="next-session-heading">
              <div className={styles.sessionPlanHeader}>
                <span className={styles.recommendationIcon}><Clock3 size={20} aria-hidden="true" /></span>
                <div>
                  <span className={styles.recommendationLabel}>Your next study session</span>
                  <h3 id="next-session-heading">{report.playbook.nextSession.title}</h3>
                </div>
              </div>
              <div className={styles.sessionStats} aria-label="Suggested study timing">
                <span><strong>{report.playbook.nextSession.workMinutes}</strong> minutes working</span>
                <span><strong>{report.playbook.nextSession.breakMinutes}</strong> minute break</span>
                <span><strong>{report.playbook.nextSession.rounds}</strong> {report.playbook.nextSession.rounds === 1 ? "round" : "rounds"}</span>
              </div>
              <div className={styles.sessionPlanGrid}>
                <div>
                  <h4>Before you start</h4>
                  <ol>
                    {report.playbook.nextSession.setupSteps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </div>
                <div className={styles.sessionRules}>
                  <p><strong>Best time</strong>{report.playbook.nextSession.bestTime}</p>
                  <p><strong>Focus rule</strong>{report.playbook.nextSession.focusRule}</p>
                  <p><strong>Check your learning</strong>{report.playbook.nextSession.checkingRule}</p>
                  <p><strong>When to stop</strong>{report.playbook.nextSession.stopRule}</p>
                </div>
              </div>
            </article>

            <div className={styles.methodIntro}>
              <h3>Three methods to try</h3>
              <p>Choose the method that fits the kind of work in front of you. You do not need to use all three at once.</p>
            </div>
            <div className={styles.methodGrid}>
              {report.playbook.methods.map((method, index) => (
                <article className={styles.methodCard} data-testid="study-method-card" key={method.id}>
                  <div className={styles.methodCardHeader}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <small>Study method</small>
                      <h3>{method.name}</h3>
                    </div>
                  </div>
                  <p className={styles.methodFit}><strong>Why it fits your answers</strong>{method.whyItFits}</p>
                  <p><strong>When to use it</strong>{method.useWhen}</p>
                  <ol>
                    {method.steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  <p className={styles.methodExample}>{method.example}</p>
                  <p className={styles.methodCaution}><strong>Keep in mind</strong>{method.caution}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.reportSection} aria-labelledby="overview-heading">
            <SectionHeading
              number="02"
              eyebrow={report.sectionHeadings.overview}
              title="What your answers show"
              body="These results come from your answers. They are not diagnoses or fixed traits."
              id="overview-heading"
            />
            <div className={styles.dimensionGrid}>
              {report.overview.map((dimension) => {
                const Icon = DIMENSION_ICONS[dimension.dimension];
                return (
                  <article className={styles.dimensionCard} key={dimension.dimension}>
                    <div className={styles.dimensionCardTop}>
                      <span className={styles.iconTile}><Icon size={19} /></span>
                      <span className={styles.levelTag}>{dimension.label}</span>
                    </div>
                    <h3>{dimension.name}</h3>
                    <ProfileRange classification={dimension.classification} label={dimension.label} />
                    <p>{dimension.summary}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.patternSection} aria-labelledby="primary-heading">
            <div className={styles.patternNumber} aria-hidden="true">03</div>
            <div>
              <span className={styles.sectionEyebrow}>{report.sectionHeadings.primaryPattern}</span>
              <h2 id="primary-heading">{report.primaryPattern.name} · {report.primaryPattern.label}</h2>
              <p className={styles.leadCopy}>{report.primaryPattern.detail}</p>
            </div>
          </section>

          <section className={`${styles.patternSection} ${styles.secondaryPattern}`} aria-labelledby="secondary-heading">
            <div className={styles.patternNumber} aria-hidden="true">04</div>
            <div>
              <span className={styles.sectionEyebrow}>{report.sectionHeadings.secondaryPattern}</span>
              <h2 id="secondary-heading">{report.secondaryPattern.name} · {report.secondaryPattern.label}</h2>
              <p>{report.secondaryPattern.detail}</p>
            </div>
          </section>

          {report.featuredInteraction && (
            <section className={styles.interactionSection} aria-labelledby="interaction-heading">
              <div className={styles.interactionIcon}><Activity size={22} aria-hidden="true" /></div>
              <div>
                <span className={styles.lightEyebrow}>{report.sectionHeadings.interactions}</span>
                <h2 id="interaction-heading">{report.featuredInteraction.title}</h2>
                <p>{report.featuredInteraction.summary}</p>
                <ul>
                  {report.featuredInteraction.actions.map((action) => (
                    <li key={action}><Check size={16} aria-hidden="true" /> {action}</li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section className={styles.reportSection} aria-labelledby="warnings-heading">
            <SectionHeading
              number="05"
              eyebrow={report.sectionHeadings.warnings}
              title="Common traps to avoid"
              id="warnings-heading"
            />
            <div className={styles.warningGrid}>
              {report.warnings.map((warning, index) => (
                <article key={warning.id}>
                  <span>0{index + 1}</span>
                  <h3>{warning.title}</h3>
                  <p>{warning.detail}</p>
                </article>
              ))}
            </div>
          </section>

        </div>

        <section className={styles.firstImpression} aria-labelledby="first-impression-heading">
          <div className={styles.firstImpressionInner}>
            <div className={styles.firstImpressionCopy}>
              <span className={styles.lightEyebrow}>Your results can change</span>
              <h2 id="first-impression-heading">{report.firstImpression.heading}</h2>
              <p>{report.firstImpression.body}</p>
              <blockquote>{report.firstImpression.closing}</blockquote>
            </div>
            <div className={styles.observationPanel}>
              <span><Eye size={16} aria-hidden="true" /> {report.firstImpression.examplesLabel}</span>
              <div>
                {report.firstImpression.examples.map((example) => (
                  <p key={example}><span>Example</span>{example}</p>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className={styles.reportBody}>
          <section className={styles.waitlistSection} aria-labelledby="waitlist-heading">
            <div className={styles.waitlistIcon}><ListChecks size={25} aria-hidden="true" /></div>
            <div className={styles.waitlistCopy}>
              <span className={styles.sectionEyebrow}>{STUDY_PROFILE_WAITLIST_CONTENT.eyebrow}</span>
              <h2 id="waitlist-heading">{STUDY_PROFILE_WAITLIST_CONTENT.heading}</h2>
              <p>{STUDY_PROFILE_WAITLIST_CONTENT.body}</p>
              <p>{STUDY_PROFILE_WAITLIST_CONTENT.helper}</p>
            </div>

            {interestState === "idle" || interestState === "joining" ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void joinWaitlist()}
                disabled={interestState === "joining"}
                aria-busy={interestState === "joining"}
              >
                {interestState === "joining" ? "Joining..." : STUDY_PROFILE_WAITLIST_CONTENT.buttonLabel}
              </button>
            ) : (
              <div className={styles.interestSuccess} role="status" ref={waitlistStatusRef} tabIndex={-1}>
                <CheckCircle2 size={20} aria-hidden="true" />
                <span><strong>{STUDY_PROFILE_WAITLIST_CONTENT.success}</strong></span>
              </div>
            )}

            {interestError && <p className={styles.formError} role="alert">{interestError}</p>}
          </section>

          <aside className={styles.methodology} aria-labelledby="methodology-heading">
            <div><ShieldCheck size={20} aria-hidden="true" /></div>
            <div>
              <h2 id="methodology-heading">{report.methodology.heading}</h2>
              <p>{report.methodology.body}</p>
              <p className={styles.researchAreas}>
                Informed by: {report.methodology.researchAreas.join(", ")}
              </p>
            </div>
          </aside>
        </div>
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

function SectionHeading({
  number,
  eyebrow,
  title,
  body,
  id,
}: {
  number: string;
  eyebrow: string;
  title: string;
  body?: string;
  id: string;
}) {
  return (
    <header className={styles.sectionHeading}>
      <span className={styles.sectionNumber}>{number}</span>
      <div>
        <span className={styles.sectionEyebrow}>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
        {body && <p>{body}</p>}
      </div>
    </header>
  );
}

function ProfileRange({
  classification,
  label,
}: {
  classification: "low" | "moderate" | "high";
  label: string;
}) {
  const activeSegments = classification === "low" ? 1 : classification === "moderate" ? 2 : 3;
  return (
    <div className={styles.profileRange} aria-label={`${label} range`} role="img">
      {[1, 2, 3].map((segment) => (
        <span key={segment} className={segment <= activeSegments ? styles.rangeActive : undefined} />
      ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleGauge,
  Eye,
  Focus,
  Layers3,
  Lightbulb,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TimerReset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  type StudyProfileDimension,
  type StudyProfilePublicStoredResponse,
  type StudyProfileRecommendationCategory,
  type StudyProfileReport,
} from "@/lib/study-profile";
import styles from "./study-profile.module.css";

type ReportViewProps = {
  storedResponse: StudyProfilePublicStoredResponse;
  report: StudyProfileReport;
  reportToken: string;
  emailDelivery?: "sent" | "skipped" | "failed";
  initialWaitlistJoined?: boolean;
  initialBetaInterest?: boolean | null;
  autoFocusHeading?: boolean;
};

type InterestState = "idle" | "joining" | "joined" | "saving-beta" | "complete";

const DIMENSION_ICONS: Record<StudyProfileDimension, ComponentType<{ size?: number }>> = {
  starting_friction: Play,
  structure_need: Layers3,
  attention_variability: Focus,
  calibration_risk: SearchCheck,
  mistake_sensitivity: ShieldCheck,
  cognitive_stamina: CircleGauge,
};

const RECOMMENDATION_ICONS: Record<
  StudyProfileRecommendationCategory,
  ComponentType<{ size?: number }>
> = {
  starting: Play,
  structure: ListChecks,
  focus: Focus,
  checking_what_you_know: SearchCheck,
  handling_mistakes: ShieldCheck,
  session_length_energy: CalendarClock,
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
  initialBetaInterest = null,
  autoFocusHeading = false,
}: ReportViewProps) {
  const [interestState, setInterestState] = useState<InterestState>(
    initialWaitlistJoined ? (initialBetaInterest !== null ? "complete" : "joined") : "idle",
  );
  const [interestError, setInterestError] = useState<string | null>(null);
  const [betaInterest, setBetaInterest] = useState<boolean | null>(initialBetaInterest);
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);
  const betaPromptRef = useRef<HTMLDivElement>(null);
  const betaStatusRef = useRef<HTMLParagraphElement>(null);
  const shouldManageInterestFocusRef = useRef(false);

  useEffect(() => {
    if (!autoFocusHeading) return;
    const frame = window.requestAnimationFrame(() => reportHeadingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusHeading]);

  useEffect(() => {
    if (!shouldManageInterestFocusRef.current) return;
    if (interestState !== "joined" && interestState !== "complete") return;
    const frame = window.requestAnimationFrame(() => {
      if (interestState === "joined") betaPromptRef.current?.focus();
      else betaStatusRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [interestState]);

  async function updateInterest(nextBetaInterest?: boolean) {
    shouldManageInterestFocusRef.current = true;
    setInterestError(null);
    setInterestState(nextBetaInterest === undefined ? "joining" : "saving-beta");

    try {
      const response = await fetch(
        `/api/study-profile/interest/${encodeURIComponent(reportToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            waitlist: true,
            ...(nextBetaInterest === undefined ? {} : { betaInterest: nextBetaInterest }),
          }),
        },
      );

      if (!response.ok) {
        throw new Error("We couldn’t save that yet. Please try again.");
      }

      if (nextBetaInterest === undefined) {
        setInterestState("joined");
      } else {
        setBetaInterest(nextBetaInterest);
        setInterestState("complete");
      }
    } catch (error) {
      setInterestState(nextBetaInterest === undefined ? "idle" : "joined");
      setInterestError(
        error instanceof Error ? error.message : "We couldn’t save that yet. Please try again.",
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
                  ? "Email delivery is not configured, so save this private link if you want to return."
                  : "The email could not be sent, so save this private link if you want to return."}
              </span>
            </div>
          </div>
        )}

        <section className={styles.reportHero} aria-labelledby="report-title">
          <div className={styles.reportHeroGlow} aria-hidden="true" />
          <div className={styles.reportHeroCopy}>
            <span className={styles.darkEyebrow}>Your initial YOVA Study Profile</span>
            <h1 id="report-title" ref={reportHeadingRef} tabIndex={-1}>{report.profileNarrative.heading}</h1>
            <div className={styles.heroPattern}>
              <span>{report.primaryPattern.name}</span>
              <strong>{report.primaryPattern.label}</strong>
            </div>
            <p>
              {report.profileNarrative.body} {report.primaryPattern.summary}
            </p>
            <div className={styles.contextPills} aria-label="Profile context">
              <span><Zap size={14} aria-hidden="true" /> Strongest: {ENERGY_LABELS[storedResponse.metadata.energyWindow]}</span>
              <span><Layers3 size={14} aria-hidden="true" /> {LEVEL_LABELS[storedResponse.metadata.schoolLevel]}</span>
              <span><LockKeyhole size={14} aria-hidden="true" /> Model v1</span>
            </div>
          </div>
          <div className={styles.heroSignalCard} aria-label="Primary and secondary patterns">
            <span className={styles.signalIndex}>01</span>
            <div>
              <small>Primary pattern</small>
              <strong>{report.primaryPattern.name}</strong>
              <span>{report.primaryPattern.label}</span>
            </div>
            <div className={styles.signalDivider} />
            <span className={styles.signalIndex}>02</span>
            <div>
              <small>Secondary pattern</small>
              <strong>{report.secondaryPattern.name}</strong>
              <span>{report.secondaryPattern.label}</span>
            </div>
          </div>
        </section>

        <div className={styles.reportBody}>
          <section className={styles.reportSection} aria-labelledby="overview-heading">
            <SectionHeading
              number="01"
              eyebrow={report.sectionHeadings.overview}
              title="Six signals. One connected study system."
              body="These ranges are product-routing signals from your answers—not diagnoses or fixed traits."
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
            <div className={styles.patternNumber} aria-hidden="true">01</div>
            <div>
              <span className={styles.sectionEyebrow}>{report.sectionHeadings.primaryPattern}</span>
              <h2 id="primary-heading">{report.primaryPattern.name} · {report.primaryPattern.label}</h2>
              <p className={styles.leadCopy}>{report.primaryPattern.detail}</p>
            </div>
          </section>

          <section className={`${styles.patternSection} ${styles.secondaryPattern}`} aria-labelledby="secondary-heading">
            <div className={styles.patternNumber} aria-hidden="true">02</div>
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

          <section className={styles.reportSection} aria-labelledby="adapt-heading">
            <SectionHeading
              number="05"
              eyebrow={report.sectionHeadings.adaptations}
              title="Design around your current tendencies."
              body="Each adjustment below answers a different part of the study loop."
              id="adapt-heading"
            />
            <div className={styles.recommendationList}>
              {report.recommendations.map((recommendation) => {
                const Icon = RECOMMENDATION_ICONS[recommendation.category];
                return (
                  <article className={styles.recommendationCard} key={recommendation.category}>
                    <span className={styles.recommendationIcon}><Icon size={20} /></span>
                    <div>
                      <span className={styles.recommendationLabel}>{recommendation.heading}</span>
                      <p>{recommendation.summary}</p>
                      <ul>
                        {recommendation.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.reportSection} aria-labelledby="warnings-heading">
            <SectionHeading
              number="06"
              eyebrow={report.sectionHeadings.warnings}
              title="Watch for these failure points."
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

          <section className={styles.protocolSection} aria-labelledby="protocol-heading">
            <div className={styles.protocolIntro}>
              <span className={styles.darkEyebrow}>A personalized protocol</span>
              <h2 id="protocol-heading">{report.protocol.title}</h2>
              <p>A small protocol built from the clearest signals in your profile.</p>
            </div>
            <ol className={styles.protocolSteps}>
              {report.protocol.steps.map((step, index) => (
                <li key={step}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.reportSection} aria-labelledby="product-heading">
            <SectionHeading
              number="08"
              eyebrow={report.sectionHeadings.productPreview}
              title="Personalization should change the experience."
              body="These are the first ways YOVA would adapt—not just observations about you."
              id="product-heading"
            />
            <div className={styles.productAdaptationGrid}>
              {report.productAdaptations.map((adaptation, index) => (
                <article key={adaptation.id}>
                  <div>
                    {index % 3 === 0 && <SlidersHorizontal size={20} aria-hidden="true" />}
                    {index % 3 === 1 && <TimerReset size={20} aria-hidden="true" />}
                    {index % 3 === 2 && <Target size={20} aria-hidden="true" />}
                  </div>
                  <h3>{adaptation.title}</h3>
                  <p>{adaptation.detail}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <section className={styles.firstImpression} aria-labelledby="first-impression-heading">
          <div className={styles.firstImpressionInner}>
            <div className={styles.firstImpressionCopy}>
              <span className={styles.lightEyebrow}>From self-report to real behavior</span>
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
          <section className={styles.earlyAccessSection} aria-labelledby="early-access-heading">
            <div className={styles.earlyAccessIcon}><Lightbulb size={25} aria-hidden="true" /></div>
            <div className={styles.earlyAccessCopy}>
              <span className={styles.sectionEyebrow}>YOVA is coming soon</span>
              <h2 id="early-access-heading">{report.earlyAccess.heading}</h2>
              <p>Join the early-access list using the email already connected to this report.</p>
            </div>

            {interestState === "idle" || interestState === "joining" ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void updateInterest()}
                disabled={interestState === "joining"}
                aria-busy={interestState === "joining"}
              >
                {interestState === "joining" ? "Joining…" : report.earlyAccess.buttonLabel}
                {interestState !== "joining" && <ArrowRight size={17} aria-hidden="true" />}
              </button>
            ) : (
              <div className={styles.interestSuccess} role="status">
                <CheckCircle2 size={20} aria-hidden="true" />
                <span><strong>You’re on the early-access list.</strong> We’ll keep you posted.</span>
              </div>
            )}

            {(interestState === "joined" || interestState === "saving-beta") && (
              <div
                className={styles.betaPrompt}
                ref={betaPromptRef}
                tabIndex={-1}
                role="group"
                aria-labelledby="study-profile-beta-prompt"
              >
                <p id="study-profile-beta-prompt">{report.earlyAccess.betaPrompt}</p>
                <div>
                  <button
                    type="button"
                    onClick={() => void updateInterest(true)}
                    disabled={interestState === "saving-beta"}
                  >
                    Yes, I’m interested
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateInterest(false)}
                    disabled={interestState === "saving-beta"}
                  >
                    Not right now
                  </button>
                </div>
              </div>
            )}

            {interestState === "complete" && (
              <p className={styles.betaSaved} role="status" ref={betaStatusRef} tabIndex={-1}>
                <Check size={16} aria-hidden="true" />
                {betaInterest
                  ? "Beta interest saved—we may reach out before launch."
                  : "Got it. You’re still on the early-access list."}
              </p>
            )}

            {interestError && <p className={styles.formError} role="alert">{interestError}</p>}
          </section>

          <aside className={styles.methodology} aria-labelledby="methodology-heading">
            <div><ShieldCheck size={20} aria-hidden="true" /></div>
            <div>
              <h2 id="methodology-heading">{report.methodology.heading}</h2>
              <p>{report.methodology.body}</p>
              <p className={styles.researchAreas}>
                Informed by: {report.methodology.researchAreas.join(" · ")}
              </p>
            </div>
          </aside>
        </div>
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

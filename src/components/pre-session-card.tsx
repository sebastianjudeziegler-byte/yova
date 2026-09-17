"use client";

import { useState } from "react";
import { ArrowRight, Clock3, Paperclip, X } from "lucide-react";
import { AllowanceLimitMessage, guidedSessionAllowanceBlocksNewStart, type GuidedSessionAllowanceDisplayState } from "@/components/guided-session-allowance-notice";
import { LivingPlanRevision, type RevisionClient } from "@/components/plan-revision/living-plan-revision";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import { personalizationNote } from "@/lib/routing/personalization-note";
import { alternativeProduceSteps, methodNameForProduceStep, type ProduceStep, type SessionRoute } from "@/lib/routing/session-route";
import type { StudyLocation } from "@/lib/session-shapes/baseline-checkpoint";
import { produceStepLabel } from "@/lib/session-shapes/shape-a";
import type { SourceDescription } from "@/lib/session-shapes/slots-schema";
import styles from "./pre-session-card.module.css";

/**
 * The one screen before a session (Brief 1.5 item 8): topic, block type and
 * time; the method with one line of why and a Change link; the source with
 * Add material; "I've already covered this"; inside or outside YOVA; Start.
 * Nothing else: what changed lives on the plan, pace lives in the hub timer.
 */
export type PreSessionCardProps = {
  plan: LearningPlan;
  session: LearningPlanSession;
  topic: KnowledgeMapTopic | null;
  /** The route before the location choice, with any method change applied. */
  insideRoute: SessionRoute;
  /** The route the session will run: insideRoute, or its outside version. */
  route: SessionRoute;
  source: SourceDescription | null;
  studyLocation: StudyLocation;
  /** False when this block has no study step to move outside (practice, or already covered). */
  canStudyOutside: boolean;
  revisionClient: RevisionClient | null;
  /** The guided-session allowance is enforced here: at the limit the card shows why instead of Start. */
  allowance: GuidedSessionAllowanceDisplayState;
  allowanceChecking: boolean;
  onStudyLocationChange: (location: StudyLocation) => void;
  onChangeProduceStep: (step: ProduceStep | null) => void;
  onStart: () => void;
  onExit: () => void;
};

type Revision = { key: string; type: "mark_covered" | "attach_source" };

export function sourceLine(source: SourceDescription) {
  const verb = source.kind === "video" ? "Watch" : source.kind === "link" ? "Open" : "Review";
  return `${verb} ${source.name}${source.location ? `, ${source.location}` : ""}`;
}

export function PreSessionCard({ plan, session, topic, insideRoute, route, source, studyLocation, canStudyOutside, revisionClient, allowance, allowanceChecking, onStudyLocationChange, onChangeProduceStep, onStart, onExit }: PreSessionCardProps) {
  const [choosingMethod, setChoosingMethod] = useState(false);
  const [revision, setRevision] = useState<Revision | null>(null);
  const note = personalizationNote(route);
  const alternatives = studyLocation === "inside" ? alternativeProduceSteps(insideRoute) : [];
  const methodChanged = insideRoute.ruleIds.some((ruleId) => ruleId.startsWith("L5.learner_change_method."));
  const covered = topic?.initialEvidence?.source === "learner_report";
  // A block with no study step is practice, whatever the plan called it (a covered topic, a practice block).
  const blockKind = route.learnPath === null ? "Practice block" : "Learn block";
  const canRevise = Boolean(revisionClient && topic && plan.status === "active" && !topic.removed);
  const sourceText = source
    ? sourceLine(source)
    : studyLocation === "outside" ? "No material added. YOVA will tell you what to find in your own textbook or notes." : "YOVA will teach this";

  return <main className={styles.shell} data-testid="pre-session-card">
    <section className={styles.card} aria-labelledby="pre-session-topic" data-pre-session-rule-ids={route.ruleIds.join(" ")}>
      <header className={styles.top}>
        <div>
          <span className={styles.kicker}>{blockKind.toUpperCase()} · {plan.title}</span>
          <h1 id="pre-session-topic" className={styles.topic}>{topic?.title ?? session.title}</h1>
          <p className={styles.meta}><Clock3 size={14} /> {blockKind} · {session.estimatedMinutes} min</p>
        </div>
        <button type="button" className={styles.exit} onClick={onExit} aria-label="Close"><X size={18} /></button>
      </header>

      <div className={styles.row} aria-label="Method">
        <span className={styles.label}>METHOD</span>
        <div className={styles.rowBody}>
          <strong className={styles.method}>{route.methodName}</strong>
          <p className={styles.why} data-rule-id-why={note.ruleId}>{note.sentence}</p>
          {(alternatives.length > 0 || methodChanged) && <button type="button" className={styles.link} aria-expanded={choosingMethod} onClick={() => setChoosingMethod((open) => !open)}>Change</button>}
          {choosingMethod && <div className={styles.choices} role="group" aria-label="Choose a method">
            {methodChanged && <button type="button" onClick={() => { setChoosingMethod(false); onChangeProduceStep(null); }}>Back to YOVA&apos;s pick</button>}
            {alternatives.map((step) => <button type="button" key={step} onClick={() => { setChoosingMethod(false); onChangeProduceStep(step); }}><strong>{methodNameForProduceStep(insideRoute, step)}</strong> · {produceStepLabel(step)}</button>)}
          </div>}
        </div>
      </div>

      <div className={styles.row} aria-label="Source">
        <span className={styles.label}>SOURCE</span>
        <div className={styles.rowBody}>
          <p className={styles.source}>{sourceText}</p>
          {canRevise && <button type="button" className={styles.link} disabled={revision !== null} onClick={() => setRevision({ key: crypto.randomUUID(), type: "attach_source" })}><Paperclip size={14} /> Add material</button>}
        </div>
      </div>

      <div className={styles.toggles}>
        {canRevise && <div className={styles.switchRow}>
          <span><strong>I&apos;ve already covered this</strong><small>{covered ? "Practice checks what you know. Your report is not proof." : "The block becomes practice. Your report is not proof."}</small></span>
          <button type="button" role="switch" aria-checked={covered} aria-label="I've already covered this" className={styles.switch} disabled={covered || revision !== null} onClick={() => setRevision({ key: crypto.randomUUID(), type: "mark_covered" })}><i /></button>
        </div>}
        {canStudyOutside && <div className={styles.location} role="radiogroup" aria-label="Where will you study?">
          <button type="button" role="radio" aria-checked={studyLocation === "inside"} onClick={() => onStudyLocationChange("inside")}>Study inside YOVA</button>
          <button type="button" role="radio" aria-checked={studyLocation === "outside"} onClick={() => { setChoosingMethod(false); onStudyLocationChange("outside"); }}>Study outside YOVA</button>
        </div>}
      </div>

      {revision && revisionClient && topic && <div className={styles.revision}>
        <LivingPlanRevision
          key={revision.key}
          plan={plan}
          client={revisionClient}
          initialDelta={{ operations: revision.type === "mark_covered" ? [{ op: "mark_covered", topic_id: topic.id }] : [] }}
          initialTopicId={topic.id}
          initialType={revision.type}
          onClose={() => setRevision(null)}
        />
      </div>}

      <footer className={styles.footer}>
        {allowance.kind === "exhausted" || allowance.kind === "temporarily_limited"
          ? <AllowanceLimitMessage allowance={allowance} />
          : <button type="button" className="button primary large" disabled={guidedSessionAllowanceBlocksNewStart(allowance, false, allowanceChecking)} onClick={onStart}>Start <ArrowRight size={17} /></button>}
      </footer>
    </section>
  </main>;
}

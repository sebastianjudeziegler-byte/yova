"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Layers3,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { GoalClarification } from "@/components/goal-clarification";
import { MaterialFileDropzone } from "@/components/material-file-dropzone";
import { MaterialLinkImporter } from "@/components/material-link-importer";
import type { LearningMaterial, LearningPlan } from "@/lib/domain";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import {
  abandonUploadedMaterials,
  deleteUploadedMaterial,
  uploadMaterialFiles,
} from "@/lib/materials/intake";
import { reportProductError } from "@/lib/monitoring/client";
import {
  PlanActivationResponseSchema,
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
  type PlanGenerationRequest,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";
import { explainStudyRouteDuration } from "@/lib/study-route/duration-explanation";
import { StudyRouteSchema } from "@/lib/study-route/schema";
import { LEARNING_INTENT_COPY, resolveLearningIntent } from "@/lib/learning/learning-intent";
import { assessGoalContext } from "@/lib/learning/goal-context";
import type { AddIntakeSeed } from "@/lib/intake/schema";
import { developmentPreviewPreferenceRequestInput } from "@/lib/plan-generation/development-preview-preferences";

type StudyNowStep = "setup" | "source" | "loading" | "review" | "error";
type SourceChoice = "materials" | "yova" | "outside";
type StudyNowDraft = {
  response: PlanGenerationResponse;
  activationRequest: PlanGenerationRequest;
};

const timeChoices = [10, 15, 25, 45, 60] as const;
const startingPoints = [
  "I haven't learned this yet",
  "I've seen it, but it doesn't make sense yet",
  "I understand the basics but need practice",
  "I know it and want to test my recall",
] as const;

export function studyNowPreviewPreferenceRequestInput(
  browserPreviewMode: boolean,
  previewPreferredMethodIds: readonly CoreMethodId[],
) {
  return developmentPreviewPreferenceRequestInput(
    browserPreviewMode,
    previewPreferredMethodIds,
  );
}

export function StudyNowCreator({
  onExit,
  onFinish,
  profileSummary,
  browserPreviewMode = false,
  previewPreferredMethodIds = [],
  seed = null,
}: {
  onExit: () => void;
  onFinish: (plan: LearningPlan) => void;
  profileSummary: string;
  browserPreviewMode?: boolean;
  previewPreferredMethodIds?: readonly CoreMethodId[];
  seed?: AddIntakeSeed | null;
}) {
  const [step, setStep] = useState<StudyNowStep>(seed ? "source" : "setup");
  const [goal, setGoal] = useState(seed ? buildStudyNowRequestSummary(seed) : "");
  const [minutes, setMinutes] = useState<(typeof timeChoices)[number]>(() => seedMinutes(seed));
  const [startingPoint, setStartingPoint] = useState<(typeof startingPoints)[number]>(seedStartingPoint(seed));
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(seed ? seedSourceChoice(seed) : null);
  const [materials, setMaterials] = useState<LearningMaterial[]>(seed?.materials ?? []);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [linkMaterialWorking, setLinkMaterialWorking] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [abandoningMaterials, setAbandoningMaterials] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudyNowDraft | null>(null);
  const [activating, setActivating] = useState(false);
  const goalContext = assessGoalContext(
    goal,
    sourceChoice === "materials" && materials.length > 0,
  );

  const addMaterials = async (files: File[]) => {
    if (!files.length) return;
    setMaterialError(null);
    setMaterialNotice(null);
    setProcessingMaterials(true);
    try {
      const { accepted, errors, notices } = await uploadMaterialFiles(files, materials);
      setMaterialError(errors[0] ?? null);
      setMaterialNotice(notices[0] ?? null);
      if (accepted.length) setMaterials((current) => [...current, ...accepted]);
    } finally {
      setProcessingMaterials(false);
    }
  };

  const removeMaterial = async (id: string) => {
    setRemovingMaterialId(id);
    setMaterialError(null);
    setMaterialNotice(null);
    try {
      await deleteUploadedMaterial(id);
      setMaterials((current) => current.filter((material) => material.id !== id));
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : "YOVA could not remove this material.");
    } finally {
      setRemovingMaterialId(null);
    }
  };

  const abandonMaterials = async () => {
    const pendingMaterials = materials;
    if (!pendingMaterials.length) return;
    setMaterials([]);
    const cleanup = await abandonUploadedMaterials(pendingMaterials);
    if (cleanup.unconfirmed > 0) {
      setMaterialNotice("YOVA could not confirm cleanup for every pending source. They cannot be used here and will expire automatically.");
    } else if (cleanup.cleanupPending > 0) {
      setMaterialNotice("The pending sources were cancelled. Private file cleanup will finish automatically.");
    }
  };

  const exitCreator = async () => {
    if (processingMaterials || linkMaterialWorking || abandoningMaterials || removingMaterialId) return;
    setAbandoningMaterials(true);
    try {
      await abandonMaterials();
    } finally {
      setAbandoningMaterials(false);
      onExit();
    }
  };

  const chooseSource = async (choice: SourceChoice) => {
    if (processingMaterials || linkMaterialWorking || abandoningMaterials || removingMaterialId) return;
    if (choice === "materials") {
      setSourceChoice(choice);
      return;
    }
    setSourceChoice(choice);
    setMaterialError(null);
    setMaterialNotice(null);
    if (!materials.length) return;
    setAbandoningMaterials(true);
    try {
      await abandonMaterials();
    } finally {
      setAbandoningMaterials(false);
    }
  };

  const activateSession = async (candidate: StudyNowDraft) => {
    if (activating) return;
    setActivating(true);
    let requestId: string | null = null;
    try {
      const activationResponse = await fetch("/api/plans/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode
            ? { "X-Yova-Development-Preview": "plan-creator" }
            : {}),
        },
        body: JSON.stringify({
          plan: candidate.response.plan,
          generationRequest: candidate.activationRequest,
          draftReceipt: candidate.response.generation.draftReceipt,
        }),
      });
      requestId = activationResponse.headers.get("X-Yova-Request-Id");
      const activationBody: unknown = await activationResponse.json();
      if (!activationResponse.ok) {
        const message = typeof activationBody === "object" && activationBody && "error" in activationBody && typeof activationBody.error === "string"
          ? activationBody.error
          : "YOVA could not save this focused session yet.";
        throw new Error(message);
      }
      const activated = PlanActivationResponseSchema.safeParse(activationBody);
      if (!activated.success) {
        throw new Error("The saved session came back in an unsafe format, so YOVA did not open it.");
      }
      onFinish(activated.data.plan);
    } catch (error) {
      reportProductError({
        surface: "plan_generation",
        errorCode: "study_now_generation_failed",
        requestId,
      });
      setGenerationError(error instanceof Error ? error.message : "YOVA could not save this focused session yet.");
      setStep("error");
    } finally {
      setActivating(false);
    }
  };

  const generateSession = async ({
    reviewBeforeStart = false,
    methodId = null,
  }: {
    reviewBeforeStart?: boolean;
    methodId?: CoreMethodId | null;
  } = {}) => {
    if (!sourceChoice) return;
    setGenerationError(null);
    setStep("loading");
    let requestId: string | null = null;

    try {
      const now = new Date();
      const learningApproach = resolveLearningIntent({ goal, startingPoint });
      const planRequest = PlanGenerationRequestSchema.parse({
        intent: "study_now",
        learningIntent: learningApproach.intent,
        goal,
        materialMode: sourceChoice === "materials" ? "upload" : "none",
        materials: sourceChoice === "materials" ? materials : [],
        studyMode: seed?.itemType === "assignment" || sourceChoice === "outside" ? "outside" : "inside",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        diagnosticResponses: [
          {
            question: "Where are you starting with this topic?",
            answer: startingPoint,
            evaluation: "self_report",
          },
          {
            question: "What kind of session do you want right now?",
            answer: `Up to ${minutes} minutes are available for this focused session`,
            evaluation: "self_report",
          },
        ],
        availability: [{
          day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now),
          window: "Now",
          minutes,
        }],
        profileSummary,
        ...studyNowPreviewPreferenceRequestInput(
          browserPreviewMode,
          previewPreferredMethodIds,
        ),
        ...(methodId ? { methodChoice: { methodId } } : {}),
        ...(methodId && draft?.response.plan.knowledgeMap
          ? { knowledgeMap: draft.response.plan.knowledgeMap }
          : {}),
      });
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode
            ? { "X-Yova-Development-Preview": "plan-creator" }
            : {}),
        },
        body: JSON.stringify(planRequest),
      });
      requestId = response.headers.get("X-Yova-Request-Id");

      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not build this session yet.";
        throw new Error(message);
      }

      const parsed = PlanGenerationResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.plan.sessions.length !== 1) {
        throw new Error("The session came back in an unsafe format, so YOVA did not open it.");
      }

      const candidate = {
        response: parsed.data,
        activationRequest: PlanGenerationRequestSchema.parse({
          ...planRequest,
          knowledgeMap: parsed.data.plan.knowledgeMap,
        }),
      };
      setDraft(candidate);
      if (reviewBeforeStart || methodId) {
        setStep("review");
        return;
      }
      await activateSession(candidate);
    } catch (error) {
      reportProductError({
        surface: "plan_generation",
        errorCode: "study_now_generation_failed",
        requestId,
      });
      setGenerationError(error instanceof Error ? error.message : "YOVA could not build this session yet.");
      setStep("error");
    }
  };

  const reviewedSession = draft?.response.plan.sessions[0] ?? null;
  const reviewedRouteResult = StudyRouteSchema.safeParse(reviewedSession?.studyRoute);
  const reviewedRoute = reviewedRouteResult.success ? reviewedRouteResult.data : null;
  const durationExplanation = reviewedRoute
    ? explainStudyRouteDuration(reviewedRoute.timing)
    : null;

  return (
    <main className="plan-shell study-now-shell">
      <header className="plan-header">
        <BrandMark />
        {step !== "loading" && step !== "error" && <span>{step === "setup" ? "Step 1 of 2" : step === "source" ? "Step 2 of 2" : "Review"}</span>}
        {step !== "loading" && <button className="button ghost" disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} onClick={() => void exitCreator()}>{abandoningMaterials ? "Removing sources…" : "Exit"}</button>}
      </header>
      {step !== "loading" && step !== "error" && <div className="plan-progress"><i style={{ width: step === "setup" ? "50%" : "100%" }} /></div>}

      {step === "setup" && (
        <section className="plan-panel">
          <span className="step-label">FOCUSED SESSION</span>
          <h1>What do you want help with?</h1>
          <p className="plan-description">Describe the result you want. YOVA will turn it into one focused session, not a multi-day plan.</p>
          <textarea
            className="goal-input"
            placeholder="Example: Help me understand the product rule and practice using it."
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          {!assessGoalContext(goal).hasEnoughContext && (
            <p className="goal-context-warning"><AlertCircle size={16} /> Add the actual topic before asking YOVA to create the content. A class label such as “Unit 3” does not tell YOVA what your teacher included.</p>
          )}
          <div className="study-now-field">
            <strong>How much time do you have?</strong>
            <div className="study-now-options compact">{timeChoices.map((choice) => <button aria-label={`${choice} minutes`} aria-pressed={minutes === choice} className={minutes === choice ? "selected" : ""} key={choice} onClick={() => setMinutes(choice)}><span className="duration-value" aria-hidden="true"><span>{choice}</span><span className="duration-unit">min</span></span>{minutes === choice && <Check aria-hidden="true" size={16} />}</button>)}</div>
          </div>
          <div className="study-now-field">
            <strong>Which sounds most like you right now?</strong>
            <div className="study-now-options">{startingPoints.map((choice) => <button className={startingPoint === choice ? "selected" : ""} key={choice} onClick={() => setStartingPoint(choice)}>{choice}{startingPoint === choice && <Check size={16} />}</button>)}</div>
            <p className="approach-preview"><Sparkles size={15} /><span><strong>Starting approach: {LEARNING_INTENT_COPY[resolveLearningIntent({ goal, startingPoint }).intent].shortName}.</strong> {resolveLearningIntent({ goal, startingPoint }).reason}</span></p>
          </div>
          <footer className="plan-actions"><button className="button ghost" onClick={() => void exitCreator()}><ArrowLeft size={17} /> Cancel</button><button className="button primary" disabled={goal.trim().length < 10} onClick={() => setStep("source")}>Choose how YOVA should help <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "source" && (
        <section className="plan-panel">
          <span className="step-label">CHOOSE A SOURCE</span>
          <h1>How should YOVA help?</h1>
          <p className="plan-description">This decides where the content comes from and where most of the work happens.</p>
          <div className="plan-goal-echo"><span>YOUR REQUEST</span><p>{goal}</p><button className="button ghost" onClick={() => setStep("setup")}>Edit</button></div>
          <div className="mode-cards three-up">
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "materials" ? "selected" : ""} onClick={() => void chooseSource("materials")}><Upload /><span><strong>Use my materials</strong><small>Study guides, PDF slides, notes, review sheets, or textbook excerpts.</small></span>{sourceChoice === "materials" && <Check />}</button>
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "yova" ? "selected" : ""} onClick={() => void chooseSource("yova")}><Sparkles /><span><strong>Create it for me</strong><small>YOVA creates the teaching and practice from the topic.</small></span>{sourceChoice === "yova" && <Check />}</button>
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "outside" ? "selected" : ""} onClick={() => void chooseSource("outside")}><Layers3 /><span><strong>Guide me outside YOVA</strong><small>Get a method and exact steps for using another source.</small></span>{sourceChoice === "outside" && <Check />}</button>
          </div>
          {sourceChoice === "materials" && <div className="material-uploader">
            <MaterialFileDropzone
              busy={processingMaterials}
              disabled={linkMaterialWorking || Boolean(removingMaterialId) || materials.length >= 5}
              onFiles={addMaterials}
            />
            <p className="material-examples"><strong>Useful examples:</strong> teacher study guide · lecture slides exported as PDF · class notes · review sheet · readable textbook excerpt</p>
            <p className="material-supplement-note"><Sparkles size={14} /> If a source only names the topics, YOVA can add the minimum explanation needed and will show you exactly what it supplemented.</p>
            <MaterialLinkImporter existingCount={materials.length} disabled={processingMaterials || Boolean(removingMaterialId)} onWorkingChange={setLinkMaterialWorking} onImported={(material, notice) => { setMaterials((current) => [...current, material]); setMaterialError(null); setMaterialNotice(notice); }} />
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · ready for this session</small></span><button aria-label={`Remove ${material.name}`} disabled={removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}>{removingMaterialId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}</div>}
          </div>}
          {materialNotice && <p className="material-notice" role="status"><AlertCircle size={15} /> {materialNotice}</p>}
          {materialError && <p className="material-error" role="alert"><AlertCircle size={15} /> {materialError}</p>}
          {sourceChoice && sourceChoice !== "materials" && !goalContext.hasEnoughContext && (
            <GoalClarification
              goal={goal}
              onClarify={(detail) => setGoal(`${goal.trim().replace(/[.:]\s*$/, "")}: ${detail}`)}
              onUseMaterials={() => setSourceChoice("materials")}
            />
          )}
          <footer className="plan-actions"><button className="button ghost" onClick={() => setStep("setup")}><ArrowLeft size={17} /> Back</button><button className="button secondary" disabled={!sourceChoice || !goalContext.hasEnoughContext || processingMaterials || linkMaterialWorking || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} onClick={() => void generateSession({ reviewBeforeStart: true })}>Review method first</button><button className="button primary" disabled={!sourceChoice || !goalContext.hasEnoughContext || processingMaterials || linkMaterialWorking || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} onClick={() => void generateSession()}>Build and start session <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "review" && draft && reviewedSession && reviewedRoute && (
        <section className="plan-panel">
          <span className="step-label">YOUR SESSION RECIPE</span>
          <h1>{reviewedRoute.agency.selectedBy === "learner" ? "Your method is ready." : "YOVA recommends this method."}</h1>
          <p className="plan-description">The task and your current starting point limit the safe choices. Pick another option only if you prefer it today.</p>
          <div className="plan-goal-echo"><span>YOUR REQUEST</span><p>{goal}</p><button className="button ghost" onClick={() => setStep("source")}>Edit</button></div>
          <div className="study-now-field">
            <strong>Recommended session</strong>
            <div className="study-now-options">
              <button className="selected" aria-pressed="true">
                <span><strong>{reviewedRoute.approach.visibleMethodName}</strong><small>{reviewedRoute.explanation.shortReason}</small></span>
                <Check size={16} />
              </button>
            </div>
            <p className="approach-preview"><Sparkles size={15} /><span><strong>{reviewedRoute.timing.activeMinutes} focused minutes.</strong> {durationExplanation}</span></p>
          </div>
          {reviewedRoute.agency.alternatives.length > 0 && <div className="study-now-field">
            <strong>Other methods that also fit</strong>
            <div className="study-now-options">{reviewedRoute.agency.alternatives.map((alternative) => <button key={alternative.alternativeId} aria-pressed="false" disabled={activating} onClick={() => void generateSession({ reviewBeforeStart: true, methodId: alternative.primaryMethodId })}><span><strong>{alternative.visibleMethodName}</strong><small>{alternative.tradeoff}</small></span></button>)}</div>
          </div>}
          <footer className="plan-actions"><button className="button ghost" disabled={activating} onClick={() => setStep("source")}><ArrowLeft size={17} /> Back</button><button className="button primary" disabled={activating} onClick={() => void activateSession(draft)}>{activating ? "Saving…" : "Start this session"} <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "loading" && <section className="plan-loading"><span className="loading-orbit"><Sparkles /></span><h1>Building your session…</h1><p>Deciding what needs teaching, what should be practiced, and how to use the time you have now.</p><div><span className="done"><Check /> Understanding the goal</span><span className="done"><Check /> Choosing teaching-first or practice-first</span><span className="active"><span /> Creating the guided activities</span></div></section>}

      {step === "error" && <section className="plan-error-state"><span><AlertCircle /></span><h1>Your information is safe.</h1><p>{generationError ?? "YOVA could not build the session yet."}</p><div><button className="button ghost" onClick={() => setStep("source")}><ArrowLeft size={17} /> Review choices</button><button className="button primary" onClick={() => void generateSession()}>Try again <ArrowRight size={17} /></button></div></section>}
    </main>
  );
}

function seedStartingPoint(seed: AddIntakeSeed | null): (typeof startingPoints)[number] {
  if (!seed?.progress) return "I understand the basics but need practice";
  if (/beginning|ground zero|nothing|new/i.test(seed.progress)) return "I haven't learned this yet";
  if (/exposure|seen|doesn't make sense/i.test(seed.progress)) return "I've seen it, but it doesn't make sense yet";
  if (/review|foundation|basics/i.test(seed.progress)) return "I understand the basics but need practice";
  return "I understand the basics but need practice";
}

function seedSourceChoice(seed: AddIntakeSeed): SourceChoice {
  if (seed.materials.length) return "materials";
  if (seed.itemType === "assignment") return "outside";
  return "yova";
}

function seedMinutes(seed: AddIntakeSeed | null): (typeof timeChoices)[number] {
  if (!seed?.requestedMinutes) return 25;
  return timeChoices.reduce((closest, candidate) => Math.abs(candidate - seed.requestedMinutes!) < Math.abs(closest - seed.requestedMinutes!) ? candidate : closest, timeChoices[0]);
}

export function buildStudyNowRequestSummary(
  seed: Pick<AddIntakeSeed, "title" | "objective" | "scope">,
) {
  return [
    completeSentence(seed.title),
    completeSentence(seed.objective),
    completeSentence(`Scope: ${seed.scope}`),
  ].join(" ");
}

function completeSentence(value: string) {
  const trimmed = value.trim();
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

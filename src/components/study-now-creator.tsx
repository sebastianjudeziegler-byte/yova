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
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import { reportProductError } from "@/lib/monitoring/client";
import {
  PlanActivationResponseSchema,
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
} from "@/lib/plan-generation/schema";
import { LEARNING_INTENT_COPY, resolveLearningIntent } from "@/lib/learning/learning-intent";
import { assessGoalContext } from "@/lib/learning/goal-context";
import type { AddIntakeSeed } from "@/lib/intake/schema";

type StudyNowStep = "setup" | "source" | "loading" | "error";
type SourceChoice = "materials" | "yova" | "outside";

const timeChoices = [15, 20, 25, 40, 60] as const;
const startingPoints = [
  "I haven't learned this yet",
  "I've seen it, but it doesn't make sense yet",
  "I understand the basics but need practice",
  "I know it and want to test my recall",
] as const;

export function StudyNowCreator({
  onExit,
  onFinish,
  profileSummary,
  seed = null,
}: {
  onExit: () => void;
  onFinish: (plan: LearningPlan) => void;
  profileSummary: string;
  seed?: AddIntakeSeed | null;
}) {
  const [step, setStep] = useState<StudyNowStep>(seed ? "source" : "setup");
  const [goal, setGoal] = useState(seed ? `${seed.title}. ${seed.objective} Scope: ${seed.scope}` : "");
  const [minutes, setMinutes] = useState<(typeof timeChoices)[number]>(() => seedMinutes(seed));
  const [startingPoint, setStartingPoint] = useState<(typeof startingPoints)[number]>(seedStartingPoint(seed));
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(seed ? seedSourceChoice(seed) : null);
  const [materials, setMaterials] = useState<LearningMaterial[]>(seed?.materials ?? []);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
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

  const generateSession = async () => {
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
            answer: `One focused session lasting ${minutes} minutes`,
            evaluation: "self_report",
          },
        ],
        availability: [{
          day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now),
          window: "Now",
          minutes,
        }],
        profileSummary,
      });
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      const activationResponse = await fetch("/api/plans/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: parsed.data.plan, generationRequest: planRequest }),
      });
      requestId = activationResponse.headers.get("X-Yova-Request-Id") ?? requestId;
      const activationBody: unknown = await activationResponse.json();
      if (!activationResponse.ok) {
        const message = typeof activationBody === "object" && activationBody && "error" in activationBody && typeof activationBody.error === "string"
          ? activationBody.error
          : "YOVA could not save this focused session yet.";
        throw new Error(message);
      }
      const activated = PlanActivationResponseSchema.safeParse(activationBody);
      if (!activated.success) throw new Error("The saved session came back in an unsafe format, so YOVA did not open it.");
      onFinish(activated.data.plan);
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

  return (
    <main className="plan-shell study-now-shell">
      <header className="plan-header">
        <BrandMark />
        {step !== "loading" && step !== "error" && <span>{step === "setup" ? "Step 1 of 2" : "Step 2 of 2"}</span>}
        {step !== "loading" && <button className="button ghost" onClick={onExit}>Exit</button>}
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
            <div className="study-now-options compact">{timeChoices.map((choice) => <button className={minutes === choice ? "selected" : ""} key={choice} onClick={() => setMinutes(choice)}>{choice} min{minutes === choice && <Check size={16} />}</button>)}</div>
          </div>
          <div className="study-now-field">
            <strong>Which sounds most like you right now?</strong>
            <div className="study-now-options">{startingPoints.map((choice) => <button className={startingPoint === choice ? "selected" : ""} key={choice} onClick={() => setStartingPoint(choice)}>{choice}{startingPoint === choice && <Check size={16} />}</button>)}</div>
            <p className="approach-preview"><Sparkles size={15} /><span><strong>Starting approach: {LEARNING_INTENT_COPY[resolveLearningIntent({ goal, startingPoint }).intent].shortName}.</strong> {resolveLearningIntent({ goal, startingPoint }).reason}</span></p>
          </div>
          <footer className="plan-actions"><button className="button ghost" onClick={onExit}><ArrowLeft size={17} /> Cancel</button><button className="button primary" disabled={goal.trim().length < 10} onClick={() => setStep("source")}>Choose how YOVA should help <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "source" && (
        <section className="plan-panel">
          <span className="step-label">CHOOSE A SOURCE</span>
          <h1>How should YOVA help?</h1>
          <p className="plan-description">This decides where the content comes from and where most of the work happens.</p>
          <div className="plan-goal-echo"><span>YOUR REQUEST</span><p>{goal}</p><button className="button ghost" onClick={() => setStep("setup")}>Edit</button></div>
          <div className="mode-cards three-up">
            <button className={sourceChoice === "materials" ? "selected" : ""} onClick={() => setSourceChoice("materials")}><Upload /><span><strong>Use my materials</strong><small>Study guides, PDF slides, notes, review sheets, or textbook excerpts.</small></span>{sourceChoice === "materials" && <Check />}</button>
            <button className={sourceChoice === "yova" ? "selected" : ""} onClick={() => { setSourceChoice("yova"); setMaterialError(null); setMaterialNotice(null); }}><Sparkles /><span><strong>Create it for me</strong><small>YOVA creates the teaching and practice from the topic.</small></span>{sourceChoice === "yova" && <Check />}</button>
            <button className={sourceChoice === "outside" ? "selected" : ""} onClick={() => { setSourceChoice("outside"); setMaterialError(null); setMaterialNotice(null); }}><Layers3 /><span><strong>Guide me outside YOVA</strong><small>Get a method and exact steps for using another source.</small></span>{sourceChoice === "outside" && <Check />}</button>
          </div>
          {sourceChoice === "materials" && <div className="material-uploader">
            <MaterialFileDropzone
              busy={processingMaterials}
              disabled={Boolean(removingMaterialId) || materials.length >= 5}
              onFiles={addMaterials}
            />
            <p className="material-examples"><strong>Useful examples:</strong> teacher study guide · lecture slides exported as PDF · class notes · review sheet · readable textbook excerpt</p>
            <p className="material-supplement-note"><Sparkles size={14} /> If a source only names the topics, YOVA can add the minimum explanation needed and will show you exactly what it supplemented.</p>
            <MaterialLinkImporter existingCount={materials.length} disabled={processingMaterials || Boolean(removingMaterialId)} onImported={(material, notice) => { setMaterials((current) => [...current, material]); setMaterialError(null); setMaterialNotice(notice); }} />
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
          <footer className="plan-actions"><button className="button ghost" onClick={() => setStep("setup")}><ArrowLeft size={17} /> Back</button><button className="button primary" disabled={!sourceChoice || !goalContext.hasEnoughContext || processingMaterials || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} onClick={() => void generateSession()}>Build and start session <ArrowRight size={17} /></button></footer>
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

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
import type { LearningMaterial, LearningPlan } from "@/lib/domain";
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import { PlanGenerationResponseSchema } from "@/lib/plan-generation/schema";

type StudyNowStep = "setup" | "source" | "loading" | "error";
type SourceChoice = "materials" | "yova" | "outside";

const timeChoices = [15, 25, 40, 60] as const;
const startingPoints = [
  "I am new to this",
  "I know a few basics",
  "I understand the basics",
  "I am mostly reviewing",
] as const;

export function StudyNowCreator({
  onExit,
  onFinish,
  profileSummary,
}: {
  onExit: () => void;
  onFinish: (plan: LearningPlan) => void;
  profileSummary: string;
}) {
  const [step, setStep] = useState<StudyNowStep>("setup");
  const [goal, setGoal] = useState("");
  const [minutes, setMinutes] = useState<(typeof timeChoices)[number]>(25);
  const [startingPoint, setStartingPoint] = useState<(typeof startingPoints)[number]>("I know a few basics");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const addMaterials = async (files: FileList | null) => {
    if (!files?.length) return;
    setMaterialError(null);
    setProcessingMaterials(true);
    try {
      const { accepted, errors } = await uploadMaterialFiles(Array.from(files), materials);
      setMaterialError(errors[0] ?? null);
      if (accepted.length) setMaterials((current) => [...current, ...accepted]);
    } finally {
      setProcessingMaterials(false);
    }
  };

  const removeMaterial = async (id: string) => {
    setRemovingMaterialId(id);
    setMaterialError(null);
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

    try {
      const now = new Date();
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "study_now",
          goal,
          materialMode: sourceChoice === "materials" ? "upload" : "none",
          materials: sourceChoice === "materials" ? materials : [],
          studyMode: sourceChoice === "outside" ? "outside" : "inside",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          diagnosticAnswers: [
            `Starting point: ${startingPoint}`,
            `The learner wants one focused session right now, lasting ${minutes} minutes.`,
          ],
          availability: [{
            day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now),
            window: "Now",
            minutes,
          }],
          profileSummary,
        }),
      });

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

      onFinish(parsed.data.plan);
    } catch (error) {
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
          <span className="step-label">STUDY SOMETHING NOW</span>
          <h1>What do you want help with?</h1>
          <p className="plan-description">Describe the result you want. YOVA will turn it into one focused session—not a multi-day plan.</p>
          <textarea
            className="goal-input"
            placeholder="Example: Help me understand the product rule and practice using it."
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
          />
          <div className="study-now-field">
            <strong>How much time do you have?</strong>
            <div className="study-now-options compact">{timeChoices.map((choice) => <button className={minutes === choice ? "selected" : ""} key={choice} onClick={() => setMinutes(choice)}>{choice} min{minutes === choice && <Check size={16} />}</button>)}</div>
          </div>
          <div className="study-now-field">
            <strong>Where are you starting?</strong>
            <div className="study-now-options">{startingPoints.map((choice) => <button className={startingPoint === choice ? "selected" : ""} key={choice} onClick={() => setStartingPoint(choice)}>{choice}{startingPoint === choice && <Check size={16} />}</button>)}</div>
          </div>
          <footer className="plan-actions"><button className="button ghost" onClick={onExit}><ArrowLeft size={17} /> Cancel</button><button className="button primary" disabled={goal.trim().length < 10} onClick={() => setStep("source")}>Choose how to study <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "source" && (
        <section className="plan-panel">
          <span className="step-label">CHOOSE A SOURCE</span>
          <h1>How should YOVA help?</h1>
          <p className="plan-description">This decides where the content comes from and where most of the work happens.</p>
          <div className="mode-cards three-up">
            <button className={sourceChoice === "materials" ? "selected" : ""} onClick={() => setSourceChoice("materials")}><Upload /><span><strong>Use my materials</strong><small>Build the session from my PDF, TXT, or Markdown files.</small></span>{sourceChoice === "materials" && <Check />}</button>
            <button className={sourceChoice === "yova" ? "selected" : ""} onClick={() => { setSourceChoice("yova"); setMaterialError(null); }}><Sparkles /><span><strong>Create it for me</strong><small>YOVA creates the teaching and practice from the topic.</small></span>{sourceChoice === "yova" && <Check />}</button>
            <button className={sourceChoice === "outside" ? "selected" : ""} onClick={() => { setSourceChoice("outside"); setMaterialError(null); }}><Layers3 /><span><strong>Guide me outside YOVA</strong><small>Get a method and exact steps for using another source.</small></span>{sourceChoice === "outside" && <Check />}</button>
          </div>
          {sourceChoice === "materials" && <div className="material-uploader">
            <label className="upload-dropzone">
              <Upload size={20} />
              <span><strong>{processingMaterials ? "Reading files…" : "Choose materials"}</strong><small>Up to 5 files · 10 MB each</small></span>
              <input aria-label="Choose learning materials" type="file" multiple accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" disabled={processingMaterials || Boolean(removingMaterialId)} onChange={(event) => { void addMaterials(event.target.files); event.target.value = ""; }} />
            </label>
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · ready for this session</small></span><button aria-label={`Remove ${material.name}`} disabled={removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}>{removingMaterialId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}</div>}
          </div>}
          {materialError && <p className="material-error"><AlertCircle size={15} /> {materialError}</p>}
          <footer className="plan-actions"><button className="button ghost" onClick={() => setStep("setup")}><ArrowLeft size={17} /> Back</button><button className="button primary" disabled={!sourceChoice || processingMaterials || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} onClick={() => void generateSession()}>Build and start session <ArrowRight size={17} /></button></footer>
        </section>
      )}

      {step === "loading" && <section className="plan-loading"><span className="loading-orbit"><Sparkles /></span><h1>Building your session…</h1><p>Matching the task, your starting point, and the time you have right now.</p><div><span className="done"><Check /> Understanding the goal</span><span className="done"><Check /> Choosing a useful method</span><span className="active"><span /> Creating the guided activities</span></div></section>}

      {step === "error" && <section className="plan-error-state"><span><AlertCircle /></span><h1>Your information is safe.</h1><p>{generationError ?? "YOVA could not build the session yet."}</p><div><button className="button ghost" onClick={() => setStep("source")}><ArrowLeft size={17} /> Review choices</button><button className="button primary" onClick={() => void generateSession()}>Try again <ArrowRight size={17} /></button></div></section>}
    </main>
  );
}

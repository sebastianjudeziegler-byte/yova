"use client";

import { useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, FileText, Trash2 } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { MaterialFileDropzone } from "@/components/material-file-dropzone";
import { MaterialLinkImporter } from "@/components/material-link-importer";
import type { LearningMaterial, LearningPlan } from "@/lib/domain";
import type { CoreMethodId } from "@/lib/learning/method-catalog";
import type { CanonicalLearnerProfile } from "@/lib/personalization/canonical-profile-schema";
import { abandonUploadedMaterials, deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import { reportProductError } from "@/lib/monitoring/client";
import { fetchClientJson, GENERATION_REQUEST_TIMEOUT_MS, MUTATION_REQUEST_TIMEOUT_MS } from "@/lib/http/client-json";
import { PlanActivationResponseSchema, PlanGenerationRequestSchema, PlanGenerationResponseSchema } from "@/lib/plan-generation/schema";
import { isWorkProductGoal, resolveLearningIntent } from "@/lib/learning/learning-intent";
import { assessGoalContext } from "@/lib/learning/goal-context";
import type { AddIntakeSeed } from "@/lib/intake/schema";
import { developmentPreviewPreferenceRequestInput } from "@/lib/plan-generation/development-preview-preferences";
import type { StudyLocation } from "@/lib/session-shapes/baseline-checkpoint";

/**
 * Study Now, first screen (Brief 1.5 item 8): what to study, optional
 * material, inside or outside YOVA. Continue builds the one-session plan and
 * hands it to the pre-session card, the same card a plan block opens with.
 * There is no review step and no separate loading screen.
 */
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
  previewCanonicalProfile?: Readonly<CanonicalLearnerProfile> | null,
) {
  return developmentPreviewPreferenceRequestInput(browserPreviewMode, previewPreferredMethodIds, previewCanonicalProfile);
}

export function StudyNowCreator({
  onExit,
  onFinish,
  profileSummary,
  browserPreviewMode = false,
  previewPreferredMethodIds = [],
  previewCanonicalProfile = null,
  seed = null,
}: {
  onExit: () => void;
  onFinish: (plan: LearningPlan, studyLocation: StudyLocation) => void;
  profileSummary: string;
  browserPreviewMode?: boolean;
  previewPreferredMethodIds?: readonly CoreMethodId[];
  previewCanonicalProfile?: Readonly<CanonicalLearnerProfile> | null;
  seed?: AddIntakeSeed | null;
}) {
  const [goal, setGoal] = useState(seed ? buildStudyNowRequestSummary(seed) : "");
  const [studyLocation, setStudyLocation] = useState<StudyLocation>(seed?.itemType === "assignment" ? "outside" : "inside");
  const [materials, setMaterials] = useState<LearningMaterial[]>(seed?.materials ?? []);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [linkMaterialWorking, setLinkMaterialWorking] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [abandoningMaterials, setAbandoningMaterials] = useState(false);
  const [building, setBuilding] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const busy = building || processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId);
  const goalContext = assessGoalContext(goal, materials.length > 0);

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

  const exitCreator = async () => {
    if (busy) return;
    setAbandoningMaterials(true);
    try {
      if (materials.length) {
        const pending = materials;
        setMaterials([]);
        await abandonUploadedMaterials(pending);
      }
    } finally {
      setAbandoningMaterials(false);
      onExit();
    }
  };

  const buildSession = async () => {
    if (busy) return;
    setBuilding(true);
    setGenerationError(null);
    let requestId: string | null = null;
    try {
      const now = new Date();
      const minutes = seedMinutes(seed);
      const startingPoint = seed ? studyNowStartingPointForSeed(seed) : startingPoints[0];
      const planRequest = PlanGenerationRequestSchema.parse({
        intent: "study_now",
        learningIntent: resolveLearningIntent({ goal, startingPoint }).intent,
        goal,
        materialMode: materials.length ? "upload" : "none",
        materials,
        studyMode: studyLocation,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        diagnosticResponses: [
          { question: "Where are you starting with this topic?", answer: startingPoint, evaluation: "self_report" },
          { question: "What kind of session do you want right now?", answer: `Up to ${minutes} minutes are available for this focused session`, evaluation: "self_report" },
        ],
        availability: [{ day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now), window: "Now", minutes }],
        profileSummary,
        ...studyNowPreviewPreferenceRequestInput(browserPreviewMode, previewPreferredMethodIds, previewCanonicalProfile),
      });
      const previewHeaders: Record<string, string> = browserPreviewMode ? { "X-Yova-Development-Preview": "plan-creator" } : {};
      const generated = await fetchClientJson("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...previewHeaders },
        body: JSON.stringify(planRequest),
      }, {
        timeoutMs: GENERATION_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Setting up this session took too long. Nothing was saved; try again when the connection is stable.",
        invalidResponseMessage: "The session-planning service returned an invalid response.",
      });
      requestId = generated.response.headers.get("X-Yova-Request-Id");
      if (!generated.response.ok) throw new Error(errorMessage(generated.body, "YOVA could not set up this session yet."));
      const parsed = PlanGenerationResponseSchema.safeParse(generated.body);
      if (!parsed.success || parsed.data.plan.sessions.length !== 1) throw new Error("The session came back in an unsafe format, so YOVA did not open it.");
      const activated = await fetchClientJson("/api/plans/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...previewHeaders },
        body: JSON.stringify({
          plan: parsed.data.plan,
          generationRequest: PlanGenerationRequestSchema.parse({ ...planRequest, knowledgeMap: parsed.data.plan.knowledgeMap }),
          draftReceipt: parsed.data.generation.draftReceipt,
        }),
      }, {
        timeoutMs: MUTATION_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Saving this session took too long. Check Learning before trying again so you do not create a duplicate.",
        invalidResponseMessage: "The session activation service returned an invalid response.",
      });
      requestId = activated.response.headers.get("X-Yova-Request-Id") ?? requestId;
      if (!activated.response.ok) throw new Error(errorMessage(activated.body, "YOVA could not save this focused session yet."));
      const saved = PlanActivationResponseSchema.safeParse(activated.body);
      if (!saved.success) throw new Error("The saved session came back in an unsafe format, so YOVA did not open it.");
      onFinish(saved.data.plan, studyLocation);
    } catch (error) {
      reportProductError({ surface: "plan_generation", errorCode: "study_now_generation_failed", requestId });
      setGenerationError(error instanceof Error ? error.message : "YOVA could not set up this session yet.");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <main className="plan-shell study-now-shell">
      <header className="plan-header">
        <BrandMark />
        <button className="button ghost" disabled={busy} onClick={() => void exitCreator()}>{abandoningMaterials ? "Removing sources…" : "Exit"}</button>
      </header>
      <section className="plan-panel">
        <span className="step-label">STUDY NOW</span>
        <h1>What do you want to study?</h1>
        <textarea
          className="goal-input"
          aria-label="Study Now topic or result"
          placeholder="Example: Help me understand the product rule and practice using it."
          value={goal}
          disabled={building}
          onChange={(event) => setGoal(event.target.value)}
        />
        {goal.trim().length >= 10 && !goalContext.hasEnoughContext && (
          <p className="goal-context-warning"><AlertCircle size={16} /> Add the actual topic, or add your material. A class label such as “Unit 3” does not tell YOVA what your teacher included.</p>
        )}

        <div className="study-now-field">
          <strong>Material <small>(optional)</small></strong>
          <div className="material-uploader">
            <MaterialFileDropzone busy={processingMaterials} disabled={building || linkMaterialWorking || Boolean(removingMaterialId) || materials.length >= 5} onFiles={addMaterials} />
            <MaterialLinkImporter existingCount={materials.length} disabled={building || processingMaterials || Boolean(removingMaterialId)} onWorkingChange={setLinkMaterialWorking} onImported={(material, notice) => { setMaterials((current) => [...current, material]); setMaterialError(null); setMaterialNotice(notice); }} />
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · ready for this session</small></span><button aria-label={`Remove ${material.name}`} disabled={building || removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}><Trash2 size={16} /></button></div>)}</div>}
          </div>
          {materialNotice && <p className="material-notice" role="status"><AlertCircle size={15} /> {materialNotice}</p>}
          {materialError && <p className="material-error" role="alert"><AlertCircle size={15} /> {materialError}</p>}
        </div>

        <div className="study-now-field">
          <strong>Where will you study?</strong>
          <div className="study-now-options compact" role="radiogroup" aria-label="Where will you study?">
            <button type="button" role="radio" aria-checked={studyLocation === "inside"} className={studyLocation === "inside" ? "selected" : ""} disabled={building} onClick={() => setStudyLocation("inside")}>Inside YOVA</button>
            <button type="button" role="radio" aria-checked={studyLocation === "outside"} className={studyLocation === "outside" ? "selected" : ""} disabled={building} onClick={() => setStudyLocation("outside")}>Outside YOVA</button>
          </div>
          <p className="approach-preview"><span>{studyLocation === "inside" ? "YOVA runs the whole session here, from your material or its own explanation." : "YOVA tells you what to study and how, then gives you questions when you are back."}</span></p>
        </div>

        {generationError && <p className="material-error" role="alert"><AlertCircle size={15} /> {generationError} Your information is safe.</p>}
        <footer className="plan-actions">
          <button className="button ghost" disabled={busy} onClick={() => void exitCreator()}><ArrowLeft size={17} /> Cancel</button>
          <button className="button primary" disabled={busy || goal.trim().length < 10 || !goalContext.hasEnoughContext} onClick={() => void buildSession()}>
            {building ? <><span className="button-spinner" aria-hidden="true" /> Setting up…</> : <>{generationError ? "Try again" : "Continue"} <ArrowRight size={17} /></>}
          </button>
        </footer>
      </section>
    </main>
  );
}

function errorMessage(body: unknown, fallback: string) {
  return typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

export function studyNowStartingPointForSeed(seed: AddIntakeSeed | null): (typeof startingPoints)[number] {
  if (!seed?.progress) return "I understand the basics but need practice";
  const workProductContext = [seed.title, seed.objective, seed.scope, seed.description].join(" ");
  if (/not started|not begun|haven't started|have not started/i.test(seed.progress) && isWorkProductGoal(workProductContext)) {
    return "I haven't learned this yet";
  }
  if (/beginning|ground zero|nothing|new/i.test(seed.progress)) return "I haven't learned this yet";
  if (/exposure|seen|doesn't make sense/i.test(seed.progress)) return "I've seen it, but it doesn't make sense yet";
  if (/review|foundation|basics/i.test(seed.progress)) return "I understand the basics but need practice";
  return "I understand the basics but need practice";
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

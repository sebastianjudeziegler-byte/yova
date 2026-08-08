"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Clock3,
  FileText,
  Layers3,
  Link2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { MaterialFileDropzone } from "@/components/material-file-dropzone";
import { MaterialLinkImporter } from "@/components/material-link-importer";
import type { DeadlineMilestone, LearningMaterial } from "@/lib/domain";
import { interpretIntake } from "@/lib/intake/interpret";
import {
  IntakeInterpretationSchema,
  type AddIntakeSeed,
  type IntakeInterpretation,
  type IntakeItemType,
} from "@/lib/intake/schema";
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";

type AddStep = "describe" | "review" | "outcome" | "saving";

export function AddToYova({
  previewMode,
  onExit,
  onTrackDeadline,
  onCreatePlan,
  onCreateSession,
}: {
  previewMode: boolean;
  onExit: () => void;
  onTrackDeadline: (draft: Omit<DeadlineMilestone, "id" | "status" | "createdAt">) => Promise<unknown>;
  onCreatePlan: (seed: AddIntakeSeed) => void;
  onCreateSession: (seed: AddIntakeSeed) => void;
}) {
  const [step, setStep] = useState<AddStep>("describe");
  const [description, setDescription] = useState("");
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [interpretation, setInterpretation] = useState<IntakeInterpretation | null>(null);
  const [processing, setProcessing] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const seed = interpretation ? { ...interpretation, description, materials } : null;

  const addMaterials = async (files: File[]) => {
    setProcessing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await uploadMaterialFiles(files, materials);
      if (result.accepted.length) setMaterials((current) => [...current, ...result.accepted]);
      setError(result.errors[0] ?? null);
      setNotice(result.notices[0] ?? null);
    } finally {
      setProcessing(false);
    }
  };

  const removeMaterial = async (id: string) => {
    setRemovingId(id);
    setError(null);
    try {
      await deleteUploadedMaterial(id);
      setMaterials((current) => current.filter((material) => material.id !== id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "YOVA could not remove this source.");
    } finally {
      setRemovingId(null);
    }
  };

  const interpret = async () => {
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch("/api/intake/interpret", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(previewMode ? { "X-Yova-Development-Preview": "add-intake" } : {}),
        },
        body: JSON.stringify({
          description,
          materialNames: materials.map((material) => material.name),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(body) ?? "YOVA could not organize this request yet.");
      const parsed = IntakeInterpretationSchema.safeParse(readProperty(body, "interpretation"));
      if (!parsed.success) throw new Error("YOVA could not safely organize this request yet.");
      setInterpretation(parsed.data);
      setStep("review");
    } catch {
      setInterpretation(interpretIntake({ description, materialNames: materials.map((material) => material.name) }));
      setNotice("YOVA used its reliable intake organizer. You can review every detail before continuing.");
      setStep("review");
    } finally {
      setProcessing(false);
    }
  };

  const trackDeadline = async () => {
    if (!seed?.dueAt) return;
    setStep("saving");
    setError(null);
    try {
      await onTrackDeadline({
        title: seed.title,
        description: seed.objective,
        dueAt: seed.dueAt,
        linkedLearningItemId: null,
      });
      onExit();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "YOVA could not save this deadline yet.");
      setStep("outcome");
    }
  };

  return <main className="add-shell">
    <header className="add-header"><BrandMark /><button className="button ghost" onClick={onExit}>Exit</button></header>

    {step === "describe" && <section className="add-panel add-describe">
      <span className="step-label">ADD TO YOVA</span>
      <h1>What do you need to learn, prepare for, or complete?</h1>
      <p>Describe a goal, assignment, deadline, or something you want to study.</p>
      <textarea
        autoFocus
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Example: I have a World War I test in two weeks. I am starting from the beginning and I have a study guide."
      />
      <div className="add-materials-heading"><div><strong>Materials are optional</strong><span>Attach a study guide, notes, slides, article, or video when it helps define the scope.</span></div><PaperclipLabel /></div>
      <MaterialFileDropzone busy={processing} disabled={Boolean(removingId) || materials.length >= 5} onFiles={addMaterials} />
      <MaterialLinkImporter existingCount={materials.length} disabled={processing || Boolean(removingId)} onImported={(material, materialNotice) => { setMaterials((current) => [...current, material]); setNotice(materialNotice); }} />
      <MaterialList materials={materials} removingId={removingId} onRemove={removeMaterial} />
      {notice && <p className="material-notice"><Sparkles size={15} /> {notice}</p>}
      {error && <p className="material-error"><AlertCircle size={15} /> {error}</p>}
      <footer><button className="button ghost" onClick={onExit}><ArrowLeft size={17} /> Cancel</button><button className="button primary" disabled={description.trim().length < 3 || processing} onClick={() => void interpret()}>{processing ? <span className="button-spinner" /> : null} Organize this <ArrowRight size={17} /></button></footer>
    </section>}

    {step === "review" && interpretation && <section className="add-panel add-review">
      <span className="step-label">YOVA&apos;S DRAFT</span>
      <h1>Here is what YOVA understood.</h1>
      <p>Correct anything that is off. Nothing has been scheduled or added yet.</p>
      <div className="add-review-grid">
        <label><span>Title</span><input value={interpretation.title} onChange={(event) => setInterpretation({ ...interpretation, title: event.target.value })} /></label>
        <label className="wide"><span>What success means</span><textarea value={interpretation.objective} onChange={(event) => setInterpretation({ ...interpretation, objective: event.target.value })} /></label>
        <label className="wide"><span>Scope</span><textarea value={interpretation.scope} onChange={(event) => setInterpretation({ ...interpretation, scope: event.target.value })} /></label>
        <label><span>Due date, if there is one</span><input type="date" value={dateInputValue(interpretation.dueAt)} onChange={(event) => setInterpretation({ ...interpretation, dueAt: dueAtFromInput(event.target.value) })} /></label>
        {interpretation.itemType === "assignment"
          ? <label><span>How far along are you?</span><select value={assignmentProgressValue(interpretation.progress)} onChange={(event) => setInterpretation({ ...interpretation, progress: event.target.value })}><option value="">Not sure yet</option><option value="Not started">Not started</option><option value="Started">Started</option><option value="Partially complete">Partially complete</option><option value="Mostly complete">Mostly complete</option></select></label>
          : <label><span>Current starting point</span><input placeholder="Optional" value={interpretation.progress} onChange={(event) => setInterpretation({ ...interpretation, progress: event.target.value })} /></label>}
      </div>
      <div className="add-source-summary"><FileText size={19} /><div><strong>{materials.length ? `${materials.length} ${materials.length === 1 ? "source" : "sources"} ready` : "No materials needed"}</strong><span>{interpretation.materialsSummary}</span></div></div>
      {notice && <p className="material-notice"><Sparkles size={15} /> {notice}</p>}
      <footer><button className="button ghost" onClick={() => setStep("describe")}><ArrowLeft size={17} /> Back</button><button className="button primary" disabled={interpretation.title.trim().length < 2 || interpretation.objective.trim().length < 3} onClick={() => setStep("outcome")}>Choose what YOVA should do <ArrowRight size={17} /></button></footer>
    </section>}

    {(step === "outcome" || step === "saving") && seed && <section className="add-panel add-outcome">
      <span className="step-label">CHOOSE THE OUTCOME</span>
      <h1>What should YOVA do with this?</h1>
      <p>YOVA will not turn every request into a large learning plan.</p>
      <div className="add-outcome-summary"><strong>{seed.title}</strong><span>{seed.dueAt ? `Due ${formatDueDate(seed.dueAt)}` : "No fixed deadline"} · {formatItemType(seed.itemType)}{seed.requestedMinutes ? ` · ${seed.requestedMinutes} minutes requested` : ""}</span></div>
      <div className="add-outcome-options">
        {seed.dueAt && <button disabled={step === "saving"} onClick={() => void trackDeadline()}><CalendarDays /><span><strong>Track the deadline</strong><small>Add it to Agenda without creating study sessions.</small></span><ArrowRight /></button>}
        <button disabled={step === "saving"} onClick={() => onCreateSession(seed)}><Clock3 /><span><strong>Create one session</strong><small>Turn this into one focused session.</small></span><ArrowRight /></button>
        <button disabled={step === "saving"} onClick={() => onCreatePlan(seed)}><Layers3 /><span><strong>Create a plan</strong><small>Break this into multiple sessions and schedule them around your availability.</small></span><ArrowRight /></button>
      </div>
      {error && <p className="material-error"><AlertCircle size={15} /> {error}</p>}
      <footer><button className="button ghost" disabled={step === "saving"} onClick={() => setStep("review")}><ArrowLeft size={17} /> Back</button></footer>
    </section>}
  </main>;
}

function MaterialList({ materials, removingId, onRemove }: { materials: LearningMaterial[]; removingId: string | null; onRemove: (id: string) => Promise<void> }) {
  if (!materials.length) return null;
  return <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Ready for YOVA</small></span><button aria-label={`Remove ${material.name}`} disabled={removingId === material.id} onClick={() => void onRemove(material.id)}>{removingId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}</div>;
}

function PaperclipLabel() {
  return <span className="add-attachment-label"><Link2 size={16} /> Files or links</span>;
}

function readProperty(value: unknown, key: string) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : null;
}

function readError(value: unknown) {
  const error = readProperty(value, "error");
  return typeof error === "string" ? error : null;
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueAtFromInput(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDueDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatItemType(value: IntakeItemType) {
  return ({ test: "Test or quiz", assignment: "Assignment or project", topic: "Topic", course: "Course", book: "Book or reading", skill: "Skill" } as const)[value];
}

function assignmentProgressValue(value: string) {
  return ["Not started", "Started", "Partially complete", "Mostly complete"].includes(value) ? value : "";
}

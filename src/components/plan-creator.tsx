"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
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
import {
  PlanGenerationResponseSchema,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";

type PlanStep = "goal" | "understood" | "materials" | "mode" | "schedule" | "diagnostic" | "confirm" | "loading" | "error" | "result";

const availability = [
  { day: "Monday", window: "Afternoon", minutes: 30 },
  { day: "Tuesday", window: "Evening", minutes: 30 },
  { day: "Wednesday", window: "Afternoon", minutes: 45 },
  { day: "Thursday", window: "Evening", minutes: 30 },
];

export function PlanCreator({ onExit, onFinish, profileSummary }: { onExit: () => void; onFinish: (plan: LearningPlan) => void; profileSummary: string }) {
  const [step, setStep] = useState<PlanStep>("goal");
  const [goal, setGoal] = useState("");
  const [materialMode, setMaterialMode] = useState<"upload" | "none" | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [studyMode, setStudyMode] = useState<"inside" | "outside" | null>(null);
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<string[]>([]);
  const [generatedPlan, setGeneratedPlan] = useState<PlanGenerationResponse | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const goalPreview = previewGoal(goal);
  const diagnosticQuestions = questionsForGoal(goal);

  const stepNumber = ({ goal: 1, understood: 1, materials: 2, mode: 3, schedule: 4, diagnostic: 5, confirm: 6, loading: 6, error: 6, result: 6 } as Record<PlanStep, number>)[step];

  const back = () => {
    const previous: Record<PlanStep, PlanStep> = {
      goal: "goal",
      understood: "goal",
      materials: "understood",
      mode: "materials",
      schedule: "mode",
      diagnostic: "schedule",
      confirm: "diagnostic",
      loading: "confirm",
      error: "confirm",
      result: "confirm",
    };
    setStep(previous[step]);
  };

  const generatePlan = async () => {
    if (!materialMode || !studyMode) return;

    setGenerationError(null);
    setStep("loading");

    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          materialMode,
          materials: materialMode === "upload" ? materials : [],
          studyMode,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          diagnosticAnswers,
          availability,
          profileSummary,
        }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not build this plan yet.";
        throw new Error(message);
      }

      const parsed = PlanGenerationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The plan came back in an unsafe format, so YOVA did not save it.");

      setGeneratedPlan(parsed.data);
      setStep("result");
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "YOVA could not build this plan yet.");
      setStep("error");
    }
  };

  const addMaterials = async (files: FileList | null) => {
    if (!files?.length) return;

    setMaterialMode("upload");
    setMaterialError(null);
    setProcessingMaterials(true);

    try {
      const incoming = Array.from(files);
      const { accepted, errors } = await uploadMaterialFiles(incoming, materials);
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

  return (
    <main className={`plan-shell ${step === "result" ? "plan-result-shell" : ""}`}>
      <header className="plan-header">
        <BrandMark />
        {step !== "result" && <span>Step {stepNumber} of 6</span>}
        {step !== "result" && <button className="button ghost" onClick={onExit}>Exit</button>}
      </header>
      {step !== "result" && <div className="plan-progress"><i style={{ width: `${(stepNumber / 6) * 100}%` }} /></div>}

      {step === "goal" && (
        <PlanPanel eyebrow="CREATE A PLAN" title="What do you need to learn or prepare for?" description="Write it naturally. YOVA will organize the details before anything is created.">
          <textarea className="goal-input" placeholder="Example: I have a biology test next Friday on photosynthesis and cellular respiration." value={goal} onChange={(event) => setGoal(event.target.value)} />
          <PlanActions onBack={onExit} backLabel="Cancel" onNext={() => setStep("understood")} nextDisabled={!goal.trim()} />
        </PlanPanel>
      )}

      {step === "understood" && (
        <PlanPanel eyebrow="HERE IS WHAT YOVA UNDERSTOOD" title={goalPreview.title} description="Check the goal before we build around it.">
          <div className="understood-grid"><SummaryFact label="Your request" value={goal} /><SummaryFact label="Deadline" value={goalPreview.deadline} /><SummaryFact label="Focus" value={goalPreview.topic} /><SummaryFact label="Likely task" value={goalPreview.task} /></div>
          <div className="source-note"><Sparkles size={18} /><p>YOVA will use these details to decide what to teach first, how many sessions fit, and which methods match the task.</p></div>
          <PlanActions onBack={back} onNext={() => setStep("materials")} />
        </PlanPanel>
      )}

      {step === "materials" && (
        <PlanPanel eyebrow="OPTIONAL MATERIALS" title="Do you have materials YOVA should use?" description="Materials are optional. If you have none, YOVA can create the explanations, questions, and learning sequence from the topic.">
          <div className="choice-cards">
            <button className={materialMode === "upload" ? "selected" : ""} onClick={() => setMaterialMode("upload")}><Upload /><span><strong>Use my materials</strong><small>Add PDF, TXT, or Markdown files</small></span>{materialMode === "upload" && <Check />}</button>
            <button className={materialMode === "none" ? "selected" : ""} onClick={() => { setMaterialMode("none"); setMaterialError(null); }}><Sparkles /><span><strong>I do not have materials</strong><small>YOVA creates the learning content from the goal</small></span>{materialMode === "none" && <Check />}</button>
          </div>
          {materialMode === "upload" && <div className="material-uploader">
            <label className="upload-dropzone">
              <Upload size={20} />
              <span><strong>{processingMaterials ? "Reading files…" : "Choose materials"}</strong><small>Up to 5 files · 10 MB each</small></span>
              <input aria-label="Choose learning materials" type="file" multiple accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" disabled={processingMaterials || Boolean(removingMaterialId)} onChange={(event) => { void addMaterials(event.target.files); event.target.value = ""; }} />
            </label>
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · text ready for YOVA</small></span><button aria-label={`Remove ${material.name}`} disabled={removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}>{removingMaterialId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}<p>{materials.length} {materials.length === 1 ? "material" : "materials"} ready for plan generation</p></div>}
          </div>}
          {materialError && <p className="material-error"><AlertCircle size={15} /> {materialError}</p>}
          <PlanActions onBack={back} onNext={() => setStep("mode")} nextDisabled={!materialMode || processingMaterials || Boolean(removingMaterialId) || (materialMode === "upload" && materials.length === 0)} />
        </PlanPanel>
      )}

      {step === "mode" && (
        <PlanPanel eyebrow="DEFAULT STUDY MODE" title="Where should most of the studying happen?" description="This is a starting preference. The student can mix both modes later.">
          <div className="mode-cards">
            <button className={studyMode === "inside" ? "selected" : ""} onClick={() => setStudyMode("inside")}><BookOpen /><span><strong>Study inside YOVA</strong><small>YOVA teaches, quizzes, and guides each step.</small></span>{studyMode === "inside" && <Check />}</button>
            <button className={studyMode === "outside" ? "selected" : ""} onClick={() => setStudyMode("outside")}><Layers3 /><span><strong>Study outside YOVA</strong><small>YOVA selects the method and gives exact instructions for using books, notes, or another course.</small></span>{studyMode === "outside" && <Check />}</button>
          </div>
          <PlanActions onBack={back} onNext={() => setStep("schedule")} nextDisabled={!studyMode} />
        </PlanPanel>
      )}

      {step === "schedule" && (
        <PlanPanel eyebrow="DEADLINE AND AVAILABILITY" title="When can you realistically study?" description="Broad windows are enough. YOVA does not need control of the student’s calendar.">
          <div className="deadline-card"><CalendarDays /><div><span>{goalPreview.hasDeadline ? "Target date" : "Timeframe"}</span><strong>{goalPreview.deadline}</strong></div><button>Edit</button></div>
          <div className="availability-list">{availability.map(({ day, window, minutes }) => <div key={day}><Check /><strong>{day}</strong><span>{window}</span><span>{minutes} min</span></div>)}</div>
          <p className="plain-note">YOVA used your afternoon preference and usual 20–30-minute session length. You can change any window.</p>
          <PlanActions onBack={back} onNext={() => setStep("diagnostic")} />
        </PlanPanel>
      )}

      {step === "diagnostic" && (
        <PlanPanel eyebrow={`STARTING-POINT CHECK · ${diagnosticIndex + 1} OF ${diagnosticQuestions.length}`} title={diagnosticQuestions[diagnosticIndex].prompt} description="The check is intentionally easy. Its purpose is to avoid repeating what you already know.">
          <div className="diagnostic-options">{diagnosticQuestions[diagnosticIndex].options.map((option) => <button className={diagnosticAnswers[diagnosticIndex] === option ? "selected" : ""} key={option} onClick={() => { const next = [...diagnosticAnswers]; next[diagnosticIndex] = option; setDiagnosticAnswers(next); }}>{option}{diagnosticAnswers[diagnosticIndex] === option && <Check />}</button>)}</div>
          <PlanActions onBack={diagnosticIndex === 0 ? back : () => setDiagnosticIndex((value) => value - 1)} onNext={() => { if (diagnosticIndex === diagnosticQuestions.length - 1) setStep("confirm"); else setDiagnosticIndex((value) => value + 1); }} nextLabel={diagnosticIndex === diagnosticQuestions.length - 1 ? "Review information" : "Next question"} nextDisabled={!diagnosticAnswers[diagnosticIndex]} />
        </PlanPanel>
      )}

      {step === "confirm" && (
        <PlanPanel eyebrow="FINAL CHECK" title="Everything YOVA will use" description="Review the inputs and change anything before your plan is generated.">
          <div className="confirmation-list"><SummaryFact label="Goal" value={goal} /><SummaryFact label="Starting point" value={diagnosticAnswers[diagnosticAnswers.length - 1] ?? "Starting check completed"} /><SummaryFact label="Availability" value="Four realistic study windows" /><SummaryFact label="Study mode" value={studyMode === "outside" ? "Primarily outside YOVA" : "Primarily inside YOVA"} /><SummaryFact label="Sources" value={materialMode === "upload" ? `${materials.length} ${materials.length === 1 ? "uploaded material" : "uploaded materials"}: ${materials.map((material) => material.name).join(", ")}` : "YOVA-generated content from the goal"} /><SummaryFact label="Profile considerations" value="Clear structure, examples first, shorter activity blocks" /></div>
          <PlanActions onBack={back} onNext={() => void generatePlan()} nextLabel="Generate my plan" />
        </PlanPanel>
      )}

      {step === "loading" && <section className="plan-loading"><span className="loading-orbit"><Sparkles /></span><h1>Building your plan…</h1><p>Matching the task, starting point, schedule, and learning methods.</p><div><span className="done"><Check /> Reviewing your goal</span><span className="done"><Check /> Identifying current knowledge</span><span className="active"><span /> Sequencing realistic sessions</span></div></section>}

      {step === "error" && (
        <section className="plan-error-state">
          <span><AlertCircle /></span>
          <h1>Your information is safe.</h1>
          <p>{generationError ?? "YOVA could not build the plan yet."}</p>
          <div>
            <button className="button ghost" onClick={() => setStep("confirm")}><ArrowLeft size={17} /> Review information</button>
            <button className="button primary" onClick={() => void generatePlan()}>Try again <ArrowRight size={17} /></button>
          </div>
        </section>
      )}

      {step === "result" && generatedPlan && (
        <section className="generated-plan">
          <div className="generated-heading"><div><span className="eyebrow"><Sparkles size={15} /> Plan active</span><h1>{generatedPlan.plan.title}</h1><p>{generatedPlan.plan.sessions.length} focused sessions organized around the goal.</p></div><button className="button primary large" onClick={() => onFinish(generatedPlan.plan)}>Go to Learning <ArrowRight size={18} /></button></div>
          <div className="why-plan"><Sparkles /><div><strong>Why this plan</strong><p>{generatedPlan.plan.rationale}</p></div></div>
          {generatedPlan.generation.notice && <div className="generation-notice"><span>Alpha note</span><p>{generatedPlan.generation.notice}</p></div>}
          <div className="generated-timeline">{generatedPlan.plan.sessions.map((session) => <article key={session.id}><span>{session.sequence}</span><div><small>{formatSessionDate(session.scheduledFor)}</small><h3>{session.title}</h3><p>{session.method}</p></div><strong>{session.amountLabel}</strong></article>)}</div>
        </section>
      )}
    </main>
  );
}

function PlanPanel({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="plan-panel"><span className="step-label">{eyebrow}</span><h1>{title}</h1><p className="plan-description">{description}</p>{children}</section>;
}

function PlanActions({ onBack, onNext, backLabel = "Back", nextLabel = "Continue", nextDisabled = false }: { onBack: () => void; onNext: () => void; backLabel?: string; nextLabel?: string; nextDisabled?: boolean }) {
  return <footer className="plan-actions"><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> {backLabel}</button><button className="button primary" onClick={onNext} disabled={nextDisabled}>{nextLabel} <ArrowRight size={17} /></button></footer>;
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return <div className="summary-fact"><span>{label}</span><strong>{value}</strong></div>;
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function previewGoal(goal: string) {
  if (/biology|photosynthesis|cellular respiration/i.test(goal)) {
    return { title: "AP Biology Unit 3", topic: "Photosynthesis and cellular respiration", task: "Concept learning and mixed assessment review", deadline: "Next Friday", hasDeadline: true };
  }
  if (/calculus|derivative|product rule|quotient rule/i.test(goal)) {
    return { title: "Calculus: Derivatives", topic: "Derivative rules and applied problem solving", task: "Worked examples followed by independent practice", deadline: /test|exam|quiz|friday/i.test(goal) ? "Inferred from your request" : "Flexible", hasDeadline: /test|exam|quiz|friday/i.test(goal) };
  }
  if (/finance|investing|budget|credit|interest/i.test(goal)) {
    return { title: "Personal Finance Fundamentals", topic: "Practical finance concepts and decisions", task: "Concept learning followed by realistic scenarios", deadline: "Flexible", hasDeadline: false };
  }
  return { title: "Your learning goal", topic: "YOVA will organize the concepts during generation", task: "Understanding, retrieval, and applied practice", deadline: /test|exam|quiz|deadline/i.test(goal) ? "Inferred from your request" : "Flexible", hasDeadline: /test|exam|quiz|deadline/i.test(goal) };
}

function questionsForGoal(goal: string) {
  if (/biology|photosynthesis|cellular respiration/i.test(goal)) {
    return [
      { prompt: "What is the main purpose of cellular respiration?", options: ["Produce ATP", "Store genetic information", "Build cell membranes", "Transport water"] },
      { prompt: "Where does glycolysis occur?", options: ["Cytoplasm", "Mitochondrial matrix", "Nucleus", "Cell membrane"] },
      { prompt: "How confident are you that you could explain both processes without notes?", options: ["Not confident", "Somewhat confident", "Very confident"] },
    ];
  }
  if (/calculus|derivative|product rule|quotient rule/i.test(goal)) {
    return [
      { prompt: "What does a derivative describe?", options: ["A rate of change", "Only the area under a curve", "A fixed intercept", "I do not know yet"] },
      { prompt: "Which practice feels least stable right now?", options: ["Power rule", "Product and quotient rules", "Chain rule", "Applications"] },
      { prompt: "How confident are you solving a derivative without an example beside you?", options: ["Not confident", "Somewhat confident", "Very confident"] },
    ];
  }
  if (/finance|investing|budget|credit|interest/i.test(goal)) {
    return [
      { prompt: "Which idea is most familiar already?", options: ["Budgeting", "Credit", "Interest", "Investing", "None yet"] },
      { prompt: "What kind of result matters most?", options: ["Make better real decisions", "Understand the vocabulary", "Prepare for an assessment", "Build long-term knowledge"] },
      { prompt: "How confident are you explaining the topic without notes?", options: ["Not confident", "Somewhat confident", "Very confident"] },
    ];
  }
  return [
    { prompt: "Where are you starting?", options: ["Completely new", "Know a few basics", "Understand the basics", "Mostly reviewing"] },
    { prompt: "What should this plan help you do?", options: ["Understand it", "Remember it", "Apply it", "Prepare for an assessment"] },
    { prompt: "How confident are you working without guidance?", options: ["Not confident", "Somewhat confident", "Very confident"] },
  ];
}

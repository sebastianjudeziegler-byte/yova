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
import { reportProductError } from "@/lib/monitoring/client";
import {
  PlanGenerationResponseSchema,
  type DiagnosticResponse,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";
import { LEARNING_INTENT_COPY, recommendLearningIntent, resolveLearningIntent } from "@/lib/learning/learning-intent";

type PlanStep = "goal" | "understood" | "materials" | "mode" | "schedule" | "diagnostic" | "confirm" | "loading" | "error" | "result";

type AvailabilityChoice = {
  day: string;
  dateLabel: string;
  window: "Morning" | "Afternoon" | "Evening";
  minutes: number;
  enabled: boolean;
};

type DiagnosticQuestion = {
  prompt: string;
  options: string[];
  correctAnswer?: string;
};

export function PlanCreator({ onExit, onFinish, profileSummary }: { onExit: () => void; onFinish: (plan: LearningPlan) => void; profileSummary: string }) {
  const [step, setStep] = useState<PlanStep>("goal");
  const [goal, setGoal] = useState("");
  const [materialMode, setMaterialMode] = useState<"upload" | "none" | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [studyMode, setStudyMode] = useState<"inside" | "outside" | null>(null);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [availabilityChoices, setAvailabilityChoices] = useState<AvailabilityChoice[]>(() => defaultAvailability(profileSummary));
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<string[]>([]);
  const [generatedPlan, setGeneratedPlan] = useState<PlanGenerationResponse | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const availability = availabilityChoices
    .filter((choice) => choice.enabled)
    .map(({ day, window, minutes }) => ({ day, window, minutes }));
  const goalPreview = previewGoal(goal, deadlineDate);
  const diagnosticQuestions = questionsForGoal(goal);
  const diagnosticResponses = buildDiagnosticResponses(diagnosticQuestions, diagnosticAnswers);
  const preliminaryApproach = recommendLearningIntent(goal);
  const learningApproach = resolveLearningIntent({ goal, diagnosticResponses });

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
    let requestId: string | null = null;

    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "plan",
          learningIntent: learningApproach.intent,
          goal,
          materialMode,
          materials: materialMode === "upload" ? materials : [],
          studyMode,
          deadline: deadlineDate ? deadlineAtEndOfDay(deadlineDate) : null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          diagnosticResponses,
          availability,
          profileSummary,
        }),
      });
      requestId = response.headers.get("X-Yova-Request-Id");

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
      reportProductError({
        surface: "plan_generation",
        errorCode: "plan_generation_failed",
        requestId,
      });
      setGenerationError(error instanceof Error ? error.message : "YOVA could not build this plan yet.");
      setStep("error");
    }
  };

  const addMaterials = async (files: FileList | null) => {
    if (!files?.length) return;

    setMaterialMode("upload");
    setMaterialError(null);
    setMaterialNotice(null);
    setProcessingMaterials(true);

    try {
      const incoming = Array.from(files);
      const { accepted, errors, notices } = await uploadMaterialFiles(incoming, materials);
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
          <div className="source-note"><Sparkles size={18} /><p><strong>Current starting recommendation: {LEARNING_INTENT_COPY[preliminaryApproach.intent].name}.</strong> {preliminaryApproach.reason} The starting check will confirm this before YOVA builds the plan.</p></div>
          <PlanActions onBack={back} onNext={() => setStep("materials")} />
        </PlanPanel>
      )}

      {step === "materials" && (
        <PlanPanel eyebrow="OPTIONAL MATERIALS" title="Do you have materials YOVA should use?" description="Materials are optional. If you have none, YOVA can create the explanations, questions, and learning sequence from the topic.">
          <div className="choice-cards">
            <button className={materialMode === "upload" ? "selected" : ""} onClick={() => setMaterialMode("upload")}><Upload /><span><strong>Use my materials</strong><small>Study guides, PDF slides, notes, review sheets, or textbook excerpts</small></span>{materialMode === "upload" && <Check />}</button>
            <button className={materialMode === "none" ? "selected" : ""} onClick={() => { setMaterialMode("none"); setMaterialError(null); setMaterialNotice(null); }}><Sparkles /><span><strong>I do not have materials</strong><small>YOVA creates the learning content from the goal</small></span>{materialMode === "none" && <Check />}</button>
          </div>
          {materialMode === "upload" && <div className="material-uploader">
            <label className="upload-dropzone">
              <Upload size={20} />
              <span><strong>{processingMaterials ? "Reading files…" : "Choose materials"}</strong><small>Up to 5 files · 10 MB each</small></span>
              <input aria-label="Choose learning materials" type="file" multiple accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" disabled={processingMaterials || Boolean(removingMaterialId)} onChange={(event) => { void addMaterials(event.target.files); event.target.value = ""; }} />
            </label>
            <p className="material-examples"><strong>Useful examples:</strong> teacher study guide · lecture slides exported as PDF · class notes · review sheet · readable textbook excerpt</p>
            <p className="material-supplement-note"><Sparkles size={14} /> If a source only lists topics, YOVA can fill in the minimum explanation needed—while keeping your material as the scope and showing what it added.</p>
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · text ready for YOVA</small></span><button aria-label={`Remove ${material.name}`} disabled={removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}>{removingMaterialId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}<p>{materials.length} {materials.length === 1 ? "material" : "materials"} ready for plan generation</p></div>}
          </div>}
          {materialNotice && <p className="material-notice"><AlertCircle size={15} /> {materialNotice}</p>}
          {materialError && <p className="material-error"><AlertCircle size={15} /> {materialError}</p>}
          <PlanActions onBack={back} onNext={() => setStep("mode")} nextDisabled={!materialMode || processingMaterials || Boolean(removingMaterialId) || (materialMode === "upload" && materials.length === 0)} />
        </PlanPanel>
      )}

      {step === "mode" && (
        <PlanPanel eyebrow="WORK LOCATION" title="Where should most of the work happen?" description="This is a starting preference. You can mix both locations later.">
          <div className="mode-cards">
            <button className={studyMode === "inside" ? "selected" : ""} onClick={() => setStudyMode("inside")}><BookOpen /><span><strong>Work inside YOVA</strong><small>YOVA teaches, checks understanding, and guides each step.</small></span>{studyMode === "inside" && <Check />}</button>
            <button className={studyMode === "outside" ? "selected" : ""} onClick={() => setStudyMode("outside")}><Layers3 /><span><strong>Use another source</strong><small>YOVA selects the method and gives exact instructions for using books, notes, or another course.</small></span>{studyMode === "outside" && <Check />}</button>
          </div>
          <PlanActions onBack={back} onNext={() => { if (!deadlineDate) setDeadlineDate(deadlineDateFromGoal(goal)); setStep("schedule"); }} nextDisabled={!studyMode} />
        </PlanPanel>
      )}

      {step === "schedule" && (
        <PlanPanel eyebrow="DEADLINE AND AVAILABILITY" title="When can you realistically study?" description="Broad windows are enough. YOVA does not need control of the student’s calendar.">
          <label className="deadline-card"><CalendarDays /><div><span>Target date · optional</span><strong>{deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"}</strong></div><input type="date" min={todayDateInput()} value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} /></label>
          <div className="availability-list editable">{availabilityChoices.map((choice, index) => <div className={choice.enabled ? "enabled" : ""} key={`${choice.day}-${choice.dateLabel}`}><button className="availability-toggle" type="button" aria-label={`${choice.enabled ? "Remove" : "Add"} ${choice.day}`} aria-pressed={choice.enabled} onClick={() => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))}>{choice.enabled && <Check size={14} />}</button><div><strong>{choice.day}</strong><small>{choice.dateLabel}</small></div><select aria-label={`${choice.day} time window`} value={choice.window} disabled={!choice.enabled} onChange={(event) => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, window: event.target.value as AvailabilityChoice["window"] } : item))}><option>Morning</option><option>Afternoon</option><option>Evening</option></select><select aria-label={`${choice.day} available minutes`} value={choice.minutes} disabled={!choice.enabled} onChange={(event) => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, minutes: Number(event.target.value) } : item))}><option value={15}>15 min</option><option value={25}>25 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></div>)}</div>
          <p className="plain-note">Select at least one realistic window. YOVA uses these limits when deciding how much work belongs in each session.</p>
          <PlanActions onBack={back} onNext={() => setStep("diagnostic")} nextDisabled={availability.length === 0} />
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
          <div className="confirmation-list"><SummaryFact label="Goal" value={goal} /><SummaryFact label="Target date" value={deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"} /><SummaryFact label="Starting evidence" value={summarizeDiagnosticResponses(diagnosticResponses)} /><SummaryFact label="How YOVA will start" value={`${LEARNING_INTENT_COPY[learningApproach.intent].name}: ${learningApproach.reason}`} /><SummaryFact label="Availability" value={`${availability.length} selected ${availability.length === 1 ? "window" : "windows"}: ${availability.map((slot) => `${slot.day} ${slot.window.toLowerCase()} (${slot.minutes} min)`).join(", ")}`} /><SummaryFact label="Work location" value={studyMode === "outside" ? "Using another source with YOVA guidance" : "Primarily inside YOVA"} /><SummaryFact label="Sources" value={materialMode === "upload" ? `${materials.length} ${materials.length === 1 ? "uploaded material" : "uploaded materials"}: ${materials.map((material) => material.name).join(", ")}` : "YOVA-generated content from the goal"} /><SummaryFact label="Profile considerations" value={profileSummary} /></div>
          <PlanActions onBack={back} onNext={() => void generatePlan()} nextLabel="Generate my plan" />
        </PlanPanel>
      )}

      {step === "loading" && <section className="plan-loading"><span className="loading-orbit"><Sparkles /></span><h1>Building your plan…</h1><p>Separating what needs to be taught from what should be practiced and retrieved.</p><div><span className="done"><Check /> Reviewing your goal</span><span className="done"><Check /> Identifying the starting approach</span><span className="active"><span /> Sequencing teaching and practice</span></div></section>}

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
          <div className="generated-timeline">{generatedPlan.plan.sessions.map((session) => <article key={session.id}><span>{session.sequence}</span><div><small>{session.learningMode === "learn" ? "TEACHING FIRST" : "PRACTICE FIRST"} · {formatSessionDate(session.scheduledFor)}</small><h3>{session.title}</h3><p>{session.method}</p></div><strong>{session.amountLabel}</strong></article>)}</div>
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

function previewGoal(goal: string, deadlineDate: string) {
  const suppliedDeadline = deadlineDate ? formatDateOnly(deadlineDate) : null;
  if (/biology|photosynthesis|cellular respiration/i.test(goal)) {
    return { title: "AP Biology Unit 3", topic: "Photosynthesis and cellular respiration", task: "Concept learning and mixed assessment review", deadline: suppliedDeadline ?? (/next friday/i.test(goal) ? "Next Friday" : "Confirm during scheduling"), hasDeadline: Boolean(suppliedDeadline || /test|exam|quiz|friday|tomorrow/i.test(goal)) };
  }
  if (/calculus|derivative|product rule|quotient rule/i.test(goal)) {
    return { title: "Calculus: Derivatives", topic: "Derivative rules and applied problem solving", task: "Worked examples followed by independent practice", deadline: suppliedDeadline ?? (/test|exam|quiz|friday|tomorrow/i.test(goal) ? "Confirm during scheduling" : "Flexible"), hasDeadline: Boolean(suppliedDeadline || /test|exam|quiz|friday|tomorrow/i.test(goal)) };
  }
  if (/finance|investing|budget|credit|interest/i.test(goal)) {
    return { title: "Personal Finance Fundamentals", topic: "Practical finance concepts and decisions", task: "Concept learning followed by realistic scenarios", deadline: suppliedDeadline ?? "Flexible", hasDeadline: Boolean(suppliedDeadline) };
  }
  return { title: "Your learning goal", topic: "YOVA will organize the concepts during generation", task: "Understanding, retrieval, and applied practice", deadline: suppliedDeadline ?? (/test|exam|quiz|deadline|friday|tomorrow/i.test(goal) ? "Confirm during scheduling" : "Flexible"), hasDeadline: Boolean(suppliedDeadline || /test|exam|quiz|deadline|friday|tomorrow/i.test(goal)) };
}

function defaultAvailability(profileSummary: string): AvailabilityChoice[] {
  const preferredWindow: AvailabilityChoice["window"] = /morning/i.test(profileSummary)
    ? "Morning"
    : /evening|late night/i.test(profileSummary)
      ? "Evening"
      : "Afternoon";
  const sessionRange = profileSummary.match(/(10|20|30|45)[–-](15|30|45|60) minutes/i);
  const preferredMinutes = sessionRange ? Number(sessionRange[2]) : 30;

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date),
      dateLabel: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date),
      window: preferredWindow,
      minutes: preferredMinutes,
      enabled: index < 4,
    };
  });
}

function todayDateInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function deadlineDateFromGoal(goal: string) {
  const date = new Date();
  if (/tomorrow/i.test(goal)) date.setDate(date.getDate() + 1);
  else if (/next friday|\bfriday\b/i.test(goal)) {
    const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilFriday);
  } else return "";

  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function deadlineAtEndOfDay(value: string) {
  return new Date(`${value}T23:59:00`).toISOString();
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function questionsForGoal(goal: string): DiagnosticQuestion[] {
  if (/biology|photosynthesis|cellular respiration/i.test(goal)) {
    return [
      { prompt: "What is the main purpose of cellular respiration?", options: ["Produce ATP", "Store genetic information", "Build cell membranes", "Transport water"], correctAnswer: "Produce ATP" },
      { prompt: "Where does glycolysis occur?", options: ["Cytoplasm", "Mitochondrial matrix", "Nucleus", "Cell membrane"], correctAnswer: "Cytoplasm" },
      { prompt: "How confident are you that you could explain both processes without notes?", options: ["Not confident", "Somewhat confident", "Very confident"] },
    ];
  }
  if (/calculus|derivative|product rule|quotient rule/i.test(goal)) {
    return [
      { prompt: "What does a derivative describe?", options: ["A rate of change", "Only the area under a curve", "A fixed intercept", "I do not know yet"], correctAnswer: "A rate of change" },
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

function buildDiagnosticResponses(questions: DiagnosticQuestion[], answers: string[]): DiagnosticResponse[] {
  return questions.flatMap((question, index) => {
    const answer = answers[index]?.trim();
    if (!answer) return [];
    return [{
      question: question.prompt,
      answer,
      evaluation: question.correctAnswer
        ? answer === question.correctAnswer ? "correct" : "incorrect"
        : "self_report",
    }];
  });
}

function summarizeDiagnosticResponses(responses: DiagnosticResponse[]) {
  const checked = responses.filter((response) => response.evaluation !== "self_report");
  const correct = checked.filter((response) => response.evaluation === "correct").length;
  const reported = responses.filter((response) => response.evaluation === "self_report").map((response) => response.answer);
  const knowledgeSummary = checked.length ? `${correct} of ${checked.length} knowledge checks correct` : "Self-reported starting point";
  return reported.length ? `${knowledgeSummary} · ${reported.join(" · ")}` : knowledgeSummary;
}

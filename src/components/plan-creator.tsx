"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  FileText,
  Layers3,
  Moon,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Trash2,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { GoalClarification } from "@/components/goal-clarification";
import { MaterialFileDropzone } from "@/components/material-file-dropzone";
import { MaterialLinkImporter } from "@/components/material-link-importer";
import { makeId, type LearningMaterial, type LearningPlan } from "@/lib/domain";
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import { reportProductError } from "@/lib/monitoring/client";
import {
  PlanActivationResponseSchema,
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
  type DiagnosticResponse,
  type PlanGenerationRequest,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { LEARNING_INTENT_COPY, resolveLearningIntent } from "@/lib/learning/learning-intent";
import { assessGoalContext } from "@/lib/learning/goal-context";
import {
  deadlineDateFromGoal,
  frequencyIndexes,
  frequencyLabel,
  recommendStudySchedule,
  type StudyFrequency,
  type StudySessionLength,
  type StudyWindow,
} from "@/lib/personalization/study-schedule";

type PlanStep = "goal" | "source" | "schedule" | "diagnostic" | "confirm" | "loading" | "error" | "result";
type SourceChoice = "materials" | "yova" | "outside";

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

export function PlanCreator({ onExit, onFinish, profileSummary, browserPreviewMode = false }: { onExit: () => void; onFinish: (plan: LearningPlan) => void; profileSummary: string; browserPreviewMode?: boolean }) {
  const scheduleRecommendation = recommendStudySchedule(profileSummary);
  const [step, setStep] = useState<PlanStep>("goal");
  const [goal, setGoal] = useState("");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(null);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [studyFrequency, setStudyFrequency] = useState<StudyFrequency>(scheduleRecommendation.frequency);
  const [preferredWindows, setPreferredWindows] = useState<StudyWindow[]>([scheduleRecommendation.window]);
  const [sessionLength, setSessionLength] = useState<StudySessionLength>(scheduleRecommendation.minutes);
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [availabilityChoices, setAvailabilityChoices] = useState<AvailabilityChoice[]>(() => configureAvailability(
    defaultAvailability(profileSummary),
    scheduleRecommendation.frequency,
    [scheduleRecommendation.window],
    scheduleRecommendation.minutes,
    scheduleRecommendation.window,
  ));
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<string[]>([]);
  const [generatedPlan, setGeneratedPlan] = useState<PlanGenerationResponse | null>(null);
  const [generatedFrom, setGeneratedFrom] = useState<PlanGenerationRequest | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const availability = availabilityChoices
    .filter((choice) => choice.enabled)
    .map(({ day, window, minutes }) => ({ day, window, minutes }));
  const availabilityWindows = availability.reduce<Record<string, number>>((summary, slot) => {
    summary[slot.window] = (summary[slot.window] ?? 0) + 1;
    return summary;
  }, {});
  const diagnosticQuestions = questionsForGoal(goal);
  const diagnosticResponses = buildDiagnosticResponses(diagnosticQuestions, diagnosticAnswers);
  const learningApproach = resolveLearningIntent({ goal, diagnosticResponses });
  const goalContext = assessGoalContext(
    goal,
    sourceChoice === "materials" && materials.length > 0,
  );

  const stepNumber = ({ goal: 1, source: 2, schedule: 3, diagnostic: 4, confirm: 5, loading: 5, error: 5, result: 5 } as Record<PlanStep, number>)[step];

  const back = () => {
    const previous: Record<PlanStep, PlanStep> = {
      goal: "goal",
      source: "goal",
      schedule: "source",
      diagnostic: "schedule",
      confirm: "diagnostic",
      loading: "confirm",
      error: "confirm",
      result: "confirm",
    };
    setStep(previous[step]);
  };

  const generatePlan = async () => {
    if (!sourceChoice) return;

    setGenerationError(null);
    setActivationError(null);
    setStep("loading");
    let requestId: string | null = null;
    let planRequest: PlanGenerationRequest | null = null;

    try {
      planRequest = PlanGenerationRequestSchema.parse({
        intent: "plan",
        learningIntent: learningApproach.intent,
        goal,
        materialMode: sourceChoice === "materials" ? "upload" : "none",
        materials: sourceChoice === "materials" ? materials : [],
        studyMode: sourceChoice === "outside" ? "outside" : "inside",
        deadline: deadlineDate ? deadlineAtEndOfDay(deadlineDate) : null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        diagnosticResponses,
        availability,
        profileSummary,
      });
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "plan-creator" } : {}),
        },
        body: JSON.stringify(planRequest),
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
      setGeneratedFrom(planRequest);
      setStep("result");
    } catch (error) {
      reportProductError({
        surface: "plan_generation",
        errorCode: "plan_generation_failed",
        requestId,
      });
      if (planRequest) {
        const reliablePlan = generatePreviewPlan(planRequest);
        const reliableResponse = PlanGenerationResponseSchema.parse({
          plan: reliablePlan,
          generation: {
            mode: "system",
            model: null,
            notice: "YOVA used its reliable planning engine because the live planning request was interrupted. Review this draft before saving it. The guided lessons will still use the exact topic and your learning profile.",
            requestId: requestId ?? makeId("plan_request"),
            durationMs: 0,
            persistence: "draft",
          },
        });
        setGeneratedPlan(reliableResponse);
        setGeneratedFrom(planRequest);
        setStep("result");
        return;
      }
      setGenerationError(error instanceof Error ? error.message : "YOVA could not build this plan yet.");
      setStep("error");
    }
  };

  const addMaterials = async (files: File[]) => {
    if (!files.length) return;

    setSourceChoice("materials");
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

  const reviseGeneratedPlan = (target: "goal" | "source" | "schedule" | "diagnostic") => {
    setGeneratedPlan(null);
    setGeneratedFrom(null);
    setGenerationError(null);
    setActivationError(null);
    if (target === "goal") {
      setDiagnosticAnswers([]);
      setDiagnosticIndex(0);
    }
    if (target === "diagnostic") setDiagnosticIndex(0);
    setStep(target);
  };

  const applyQuickSchedule = (
    frequency = studyFrequency,
    windows = preferredWindows,
    minutes = sessionLength,
  ) => {
    setAvailabilityChoices((current) => configureAvailability(
      current,
      frequency,
      windows,
      minutes,
      scheduleRecommendation.window,
    ));
  };

  const chooseFrequency = (frequency: StudyFrequency) => {
    setStudyFrequency(frequency);
    setCustomScheduleOpen(false);
    applyQuickSchedule(frequency, preferredWindows, sessionLength);
  };

  const togglePreferredWindow = (window: StudyWindow) => {
    const nextWindows = window === "Anytime"
      ? ["Anytime" as const]
      : preferredWindows.includes(window)
        ? preferredWindows.length === 1
          ? preferredWindows
          : preferredWindows.filter((item) => item !== window)
        : [...preferredWindows.filter((item) => item !== "Anytime"), window];
    setPreferredWindows(nextWindows);
    setCustomScheduleOpen(false);
    applyQuickSchedule(studyFrequency, nextWindows, sessionLength);
  };

  const chooseSessionLength = (minutes: StudySessionLength) => {
    setSessionLength(minutes);
    setCustomScheduleOpen(false);
    applyQuickSchedule(studyFrequency, preferredWindows, minutes);
  };

  const activateGeneratedPlan = async () => {
    if (!generatedPlan || !generatedFrom || activating) return;
    setActivationError(null);
    setActivating(true);
    let requestId: string | null = null;

    try {
      const response = await fetch("/api/plans/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "plan-creator" } : {}),
        },
        body: JSON.stringify({ plan: generatedPlan.plan, generationRequest: generatedFrom }),
      });
      requestId = response.headers.get("X-Yova-Request-Id");
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not activate this plan yet.";
        throw new Error(message);
      }

      const parsed = PlanActivationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The saved plan came back in an unsafe format, so YOVA did not open it.");
      onFinish(parsed.data.plan);
    } catch (error) {
      reportProductError({
        surface: "plan_generation",
        errorCode: "plan_activation_failed",
        requestId,
      });
      setActivationError(error instanceof Error ? error.message : "YOVA could not activate this plan yet.");
    } finally {
      setActivating(false);
    }
  };

  return (
    <main className={`plan-shell ${step === "result" ? "plan-result-shell" : ""}`}>
      <header className="plan-header">
        <BrandMark />
        {step !== "result" && <span>Step {stepNumber} of 5</span>}
        {step !== "result" && <button className="button ghost" onClick={onExit}>Exit</button>}
      </header>
      {step !== "result" && <div className="plan-progress"><i style={{ width: `${(stepNumber / 5) * 100}%` }} /></div>}

      {step === "goal" && (
        <PlanPanel eyebrow="CREATE A PLAN" title="What do you need to learn or prepare for?" description="Write it naturally. YOVA will organize the details before anything is created.">
          <textarea className="goal-input" placeholder="Example: I have a biology test next Friday on photosynthesis and cellular respiration." value={goal} onChange={(event) => setGoal(event.target.value)} />
          <p className="goal-input-hint">Include the topic and, if relevant, the test, deadline, or result you want.</p>
          {!assessGoalContext(goal).hasEnoughContext && <p className="goal-context-warning"><AlertCircle size={16} /> Add the actual topic, or continue and choose Use my materials so YOVA can identify what the class label contains.</p>}
          <PlanActions onBack={onExit} backLabel="Cancel" onNext={() => setStep("source")} nextDisabled={goal.trim().length < 10} />
        </PlanPanel>
      )}

      {step === "source" && (
        <PlanPanel eyebrow="CHOOSE HOW YOVA SHOULD HELP" title="Where should the learning come from?" description="Pick one starting mode. YOVA will use the same choice throughout the plan, and you can still change it later.">
          <div className="plan-goal-echo"><span>YOUR GOAL</span><p>{goal}</p><button className="button ghost" onClick={() => setStep("goal")}>Edit</button></div>
          <div className="mode-cards three-up">
            <button className={sourceChoice === "materials" ? "selected" : ""} onClick={() => setSourceChoice("materials")}><Upload /><span><strong>Use my materials</strong><small>Build from study guides, PDF slides, notes, review sheets, or textbook excerpts.</small></span>{sourceChoice === "materials" && <Check />}</button>
            <button className={sourceChoice === "yova" ? "selected" : ""} onClick={() => { setSourceChoice("yova"); setMaterialError(null); setMaterialNotice(null); }}><Sparkles /><span><strong>Create it for me</strong><small>YOVA creates the teaching, examples, and practice from the topic.</small></span>{sourceChoice === "yova" && <Check />}</button>
            <button className={sourceChoice === "outside" ? "selected" : ""} onClick={() => { setSourceChoice("outside"); setMaterialError(null); setMaterialNotice(null); }}><Layers3 /><span><strong>Guide me outside YOVA</strong><small>YOVA chooses the method and gives exact steps for another trusted source.</small></span>{sourceChoice === "outside" && <Check />}</button>
          </div>
          {sourceChoice === "materials" && <div className="material-uploader">
            <MaterialFileDropzone
              busy={processingMaterials}
              disabled={Boolean(removingMaterialId) || materials.length >= 5}
              onFiles={addMaterials}
            />
            <p className="material-examples"><strong>Useful examples:</strong> teacher study guide · lecture slides exported as PDF · class notes · review sheet · readable textbook excerpt</p>
            <p className="material-supplement-note"><Sparkles size={14} /> If a source only lists topics, YOVA can fill in the minimum explanation needed while keeping your material as the scope and showing what it added.</p>
            <MaterialLinkImporter existingCount={materials.length} disabled={processingMaterials || Boolean(removingMaterialId)} onImported={(material, notice) => { setMaterials((current) => [...current, material]); setMaterialError(null); setMaterialNotice(notice); }} />
            {materials.length > 0 && <div className="material-files">{materials.map((material) => <div key={material.id}><FileText /><span><strong>{material.name}</strong><small>Securely stored · text ready for YOVA</small></span><button aria-label={`Remove ${material.name}`} disabled={removingMaterialId === material.id} onClick={() => void removeMaterial(material.id)}>{removingMaterialId === material.id ? <span className="button-spinner dark" /> : <Trash2 size={16} />}</button></div>)}<p>{materials.length} {materials.length === 1 ? "material" : "materials"} ready for plan generation</p></div>}
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
          <PlanActions onBack={back} onNext={() => { if (!deadlineDate) setDeadlineDate(deadlineDateFromGoal(goal)); setStep("schedule"); }} nextDisabled={!sourceChoice || !goalContext.hasEnoughContext || processingMaterials || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} />
        </PlanPanel>
      )}

      {step === "schedule" && !customScheduleOpen && (
        <PlanPanel wide eyebrow="YOUR STUDY RHYTHM" title="When would you prefer to study this material?" description="Choose a realistic pattern. YOVA will build the learning sequence around it and adapt the schedule as your results change.">
          <div className="schedule-builder-layout">
            <div className="schedule-quick-builder">
              <fieldset className="schedule-question"><legend><span>1</span> How often can you study?</legend><div className="schedule-choice-grid frequency">{(["every_day", "most_days", "three_four", "one_two"] as StudyFrequency[]).map((frequency) => <button type="button" key={frequency} className={studyFrequency === frequency && !customScheduleOpen ? "selected" : ""} onClick={() => chooseFrequency(frequency)}><CalendarDays size={18} /><strong>{frequencyLabel(frequency)}</strong>{scheduleRecommendation.frequency === frequency && <small>Recommended</small>}</button>)}<button type="button" className={customScheduleOpen ? "selected" : ""} onClick={() => setCustomScheduleOpen(true)}><SlidersHorizontal size={18} /><strong>Custom</strong><small>Choose each day</small></button></div></fieldset>
              <fieldset className="schedule-question"><legend><span>2</span> When do you prefer to study?</legend><div className="schedule-choice-grid windows">{(["Morning", "Afternoon", "Evening", "Anytime"] as StudyWindow[]).map((window) => <button type="button" key={window} className={preferredWindows.includes(window) && !customScheduleOpen ? "selected" : ""} onClick={() => togglePreferredWindow(window)}>{window === "Morning" ? <SunMedium size={18} /> : window === "Evening" ? <Moon size={18} /> : <Clock3 size={18} />}<strong>{window}</strong>{scheduleRecommendation.window === window && <small>Recommended</small>}</button>)}</div></fieldset>
              <fieldset className="schedule-question"><legend><span>3</span> What is a realistic session length?</legend><div className="schedule-choice-grid lengths">{([15, 25, 45, 60] as StudySessionLength[]).map((minutes) => <button type="button" key={minutes} className={sessionLength === minutes && !customScheduleOpen ? "selected" : ""} onClick={() => chooseSessionLength(minutes)}><strong>{minutes} min</strong>{scheduleRecommendation.minutes === minutes && <small>Recommended</small>}</button>)}</div></fieldset>
            </div>
            <aside className="schedule-preview-card">
              <label className="schedule-deadline"><CalendarDays /><span><small>Target date</small><strong>{deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"}</strong></span><input aria-label="Target date" type="date" min={todayDateInput()} value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} /></label>
              <div className="schedule-preview-summary"><Sparkles /><div><span>YOVA preview</span><strong>{availability.length} study {availability.length === 1 ? "window" : "windows"} available</strong><p>{scheduleRecommendation.reason}</p></div></div>
              <div className="schedule-preview-windows">{Object.entries(availabilityWindows).map(([window, count]) => <div key={window}>{window === "Morning" ? <SunMedium size={17} /> : window === "Evening" ? <Moon size={17} /> : <Clock3 size={17} />}<strong>{window}</strong><span>{durationLabel(availability.filter((slot) => slot.window === window).map((slot) => slot.minutes))}</span><small>{count} {count === 1 ? "session" : "sessions"}</small></div>)}</div>
              <small className="schedule-preview-note">These are availability limits, not mandatory appointments. YOVA will only schedule the amount of learning the plan actually needs.</small>
            </aside>
          </div>
          <PlanActions onBack={back} onNext={() => setStep("diagnostic")} nextDisabled={availability.length === 0} />
        </PlanPanel>
      )}

      {step === "schedule" && customScheduleOpen && (
        <PlanPanel wide eyebrow="CUSTOM TIMETABLE" title="Build your study week" description="Choose the exact days, time of day, and maximum session length that work for you.">
          <section className="schedule-customizer standalone">
            <header>
              <div><span className="step-label">YOUR AVAILABILITY</span><h2>{availability.length} study {availability.length === 1 ? "window" : "windows"} selected</h2><p>YOVA treats these as limits, not mandatory appointments. The plan will use only the time the material actually needs.</p></div>
              <label className="custom-deadline"><span>Target date</span><input aria-label="Custom target date" type="date" min={todayDateInput()} value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} /></label>
            </header>
            <div className="availability-list editable">{availabilityChoices.map((choice, index) => <div className={choice.enabled ? "enabled" : ""} key={`${choice.day}-${choice.dateLabel}`}><button className="availability-toggle" type="button" aria-label={`${choice.enabled ? "Remove" : "Add"} ${choice.day}`} aria-pressed={choice.enabled} onClick={() => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: !item.enabled } : item))}>{choice.enabled && <Check size={14} />}</button><div><strong>{choice.day}</strong><small>{choice.dateLabel}</small></div><select aria-label={`${choice.day} time window`} value={choice.window} disabled={!choice.enabled} onChange={(event) => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, window: event.target.value as AvailabilityChoice["window"] } : item))}><option>Morning</option><option>Afternoon</option><option>Evening</option></select><select aria-label={`${choice.day} available minutes`} value={choice.minutes} disabled={!choice.enabled} onChange={(event) => setAvailabilityChoices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, minutes: Number(event.target.value) } : item))}><option value={15}>15 min</option><option value={25}>25 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></div>)}</div>
          </section>
          <PlanActions onBack={() => setCustomScheduleOpen(false)} backLabel="Quick choices" onNext={() => setStep("diagnostic")} nextLabel="Use this timetable" nextDisabled={availability.length === 0} />
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
          <div className="confirmation-list"><SummaryFact label="Goal" value={goal} /><SummaryFact label="Target date" value={deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"} /><SummaryFact label="Starting evidence" value={summarizeDiagnosticResponses(diagnosticResponses)} /><SummaryFact label="How YOVA will start" value={`${LEARNING_INTENT_COPY[learningApproach.intent].name}: ${learningApproach.reason}`} /><SummaryFact label="Availability" value={`${availability.length} selected ${availability.length === 1 ? "window" : "windows"}: ${availability.map((slot) => `${slot.day} ${slot.window.toLowerCase()} (${slot.minutes} min)`).join(", ")}`} /><SummaryFact label="Learning mode" value={sourceChoice === "outside" ? "YOVA-guided plan using another trusted source" : sourceChoice === "materials" ? "Guided inside YOVA from your uploaded materials" : "Guided inside YOVA with YOVA-created teaching and practice"} /><SummaryFact label="Sources" value={sourceChoice === "materials" ? `${materials.length} ${materials.length === 1 ? "uploaded material" : "uploaded materials"}: ${materials.map((material) => material.name).join(", ")}` : sourceChoice === "outside" ? "The source you choose outside YOVA" : "YOVA-generated content from the goal"} /><SummaryFact label="Saved learning profile" value="Session length, structure, explanation style, focus support, and study timing from onboarding" /></div>
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
          <div className="generated-heading"><div><span className="eyebrow"><Sparkles size={15} /> Plan ready</span><h1>{generatedPlan.plan.title}</h1><p>{generatedPlan.plan.sessions.length} focused sessions organized around the goal. Nothing is active until you confirm it below.</p></div></div>
          <div className="why-plan"><Sparkles /><div><strong>Why this plan</strong><p>{generatedPlan.plan.rationale}</p></div></div>
          {generatedPlan.generation.notice && <div className="generation-notice"><span>Alpha note</span><p>{generatedPlan.generation.notice}</p></div>}
          <div className="generated-timeline">{generatedPlan.plan.sessions.map((session) => <article key={session.id}><span>{session.sequence}</span><div><small>{session.learningMode === "learn" ? "TEACHING FIRST" : "PRACTICE FIRST"} · {formatSessionDate(session.scheduledFor)}</small><h3>{session.title}</h3><p>{session.method}</p></div><strong>{session.amountLabel}</strong></article>)}</div>
          <section className="plan-alignment-check" aria-labelledby="plan-alignment-title">
            <div className="plan-alignment-heading"><span className="step-label">BEFORE YOVA SAVES THIS</span><h2 id="plan-alignment-title">Does this plan match what you need?</h2><p>Check the content, starting approach, source, and pace. If one part is wrong, change that input and YOVA will rebuild the draft.</p></div>
            <div className="plan-alignment-facts">
              <div><span>CONTENT</span><strong>{generatedPlan.plan.topic}</strong></div>
              <div><span>STARTING APPROACH</span><strong>{generatedPlan.plan.learningIntent === "learn" ? "Teach first, then remove support" : "Practice first, then repair gaps"}</strong></div>
              <div><span>LEARNING SOURCE</span><strong>{sourceChoice === "materials" ? `${materials.length} uploaded ${materials.length === 1 ? "source" : "sources"}` : sourceChoice === "outside" ? "Your trusted source outside YOVA" : "Teaching and practice created by YOVA"}</strong></div>
              <div><span>PACE</span><strong>{generatedPlan.plan.sessions.length} sessions · {Math.min(...generatedPlan.plan.sessions.map((session) => session.estimatedMinutes))} to {Math.max(...generatedPlan.plan.sessions.map((session) => session.estimatedMinutes))} minutes each</strong></div>
            </div>
            <div className="plan-revision-actions" aria-label="Change this plan before saving">
              <button className="button ghost" onClick={() => reviseGeneratedPlan("goal")}>Change content</button>
              <button className="button ghost" onClick={() => reviseGeneratedPlan("source")}>Change source</button>
              <button className="button ghost" onClick={() => reviseGeneratedPlan("schedule")}>Change schedule</button>
              <button className="button ghost" onClick={() => reviseGeneratedPlan("diagnostic")}>Change starting level</button>
            </div>
            {activationError && <p className="plan-activation-error"><AlertCircle size={16} /> {activationError}</p>}
            <div className="plan-activation"><div><Check size={18} /><span><strong>Confirm only when this looks right.</strong><small>YOVA will save the plan and make its first session available.</small></span></div><button className="button primary large" disabled={activating} onClick={() => void activateGeneratedPlan()}>{activating ? <><span className="button-spinner" /> Saving plan…</> : <>Use this plan <ArrowRight size={18} /></>}</button></div>
          </section>
        </section>
      )}
    </main>
  );
}

function PlanPanel({ eyebrow, title, description, children, wide = false }: { eyebrow: string; title: string; description: string; children: React.ReactNode; wide?: boolean }) {
  return <section className={`plan-panel ${wide ? "wide" : ""}`}><span className="step-label">{eyebrow}</span><h1>{title}</h1><p className="plan-description">{description}</p>{children}</section>;
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

function defaultAvailability(profileSummary: string): AvailabilityChoice[] {
  const recommendation = recommendStudySchedule(profileSummary);
  const preferredWindow: AvailabilityChoice["window"] = recommendation.window === "Anytime" ? "Afternoon" : recommendation.window;

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      day: new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date),
      dateLabel: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date),
      window: preferredWindow,
      minutes: recommendation.minutes,
      enabled: frequencyIndexes(recommendation.frequency).includes(index),
    };
  });
}

function configureAvailability(
  choices: AvailabilityChoice[],
  frequency: StudyFrequency,
  windows: StudyWindow[],
  minutes: StudySessionLength,
  recommendedWindow: StudyWindow,
) {
  const enabledIndexes = frequencyIndexes(frequency);
  const concreteWindows = windows.includes("Anytime")
    ? [recommendedWindow === "Anytime" ? "Afternoon" : recommendedWindow]
    : windows.filter((window): window is AvailabilityChoice["window"] => window !== "Anytime");
  return choices.map((choice, index) => ({
    ...choice,
    enabled: enabledIndexes.includes(index),
    window: concreteWindows[index % concreteWindows.length] ?? "Afternoon",
    minutes,
  }));
}

function todayDateInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function deadlineAtEndOfDay(value: string) {
  return new Date(`${value}T23:59:00`).toISOString();
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function durationLabel(minutes: number[]) {
  const unique = [...new Set(minutes)].sort((a, b) => a - b);
  if (!unique.length) return "";
  if (unique.length === 1) return `${unique[0]} min`;
  return `${unique[0]}–${unique.at(-1)} min`;
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

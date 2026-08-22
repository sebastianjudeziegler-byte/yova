"use client";

import { useReducer, useState } from "react";
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
import { PlanGenerationNotice } from "@/components/plan-generation-notice";
import { makeId, type LearningMaterial, type LearningPlan } from "@/lib/domain";
import {
  abandonUploadedMaterials,
  deleteUploadedMaterial,
  uploadMaterialFiles,
} from "@/lib/materials/intake";
import { userFacingErrorMessage } from "@/lib/errors/user-facing-message";
import { reportProductError } from "@/lib/monitoring/client";
import {
  PlanDiagnosticPreparationResponseSchema,
  PlanActivationResponseSchema,
  PlanGenerationRequestSchema,
  PlanGenerationResponseSchema,
  type DiagnosticResponse,
  type PlanDiagnosticQuestion,
  type PlanGenerationRequest,
  type PlanGenerationResponse,
} from "@/lib/plan-generation/schema";
import { PlanKnowledgeMapSchema, type PlanKnowledgeMap } from "@/lib/knowledge-map/schema";
import { generatePreviewPlan } from "@/lib/plan-generation/preview-generator";
import { planScheduleCapacityGuidance } from "@/lib/plan-generation/capacity-guidance";
import { LIVE_AI_PLAN_FALLBACK_NOTICE } from "@/lib/plan-generation/fallback";
import { inferPlanScopeContract } from "@/lib/plan-generation/scope-contract";
import { buildPlanContentBudget } from "@/lib/plan-generation/content-budget";
import { LEARNING_INTENT_COPY, resolveLearningIntent } from "@/lib/learning/learning-intent";
import type { AddIntakeSeed } from "@/lib/intake/schema";
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
import { buildPlanPreferenceContract } from "@/lib/personalization/plan-preference-contract";
import {
  deadlineAtEndOfDay,
  futureDeadlineDateInputFromIso,
} from "@/lib/intake/deadline";
import {
  configureAvailability,
  planCreatorScheduleReducer,
  type AvailabilityChoice,
} from "@/lib/scheduling/plan-creator-schedule";

type PlanStep = "goal" | "source" | "schedule" | "diagnostic-loading" | "diagnostic" | "confirm" | "loading" | "error" | "result";
type SourceChoice = "materials" | "yova" | "outside";

export function PlanCreator({ onExit, onFinish, profileSummary, browserPreviewMode = false, seed = null }: { onExit: () => void; onFinish: (plan: LearningPlan) => void; profileSummary: string; browserPreviewMode?: boolean; seed?: AddIntakeSeed | null }) {
  const scheduleRecommendation = recommendStudySchedule(profileSummary);
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [step, setStep] = useState<PlanStep>(seed ? "schedule" : "goal");
  const [goal, setGoal] = useState(seed ? seedGoal(seed) : "");
  const [sourceChoice, setSourceChoice] = useState<SourceChoice | null>(seed ? seedSourceChoice(seed) : null);
  const [materials, setMaterials] = useState<LearningMaterial[]>(seed?.materials ?? []);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialNotice, setMaterialNotice] = useState<string | null>(null);
  const [processingMaterials, setProcessingMaterials] = useState(false);
  const [linkMaterialWorking, setLinkMaterialWorking] = useState(false);
  const [removingMaterialId, setRemovingMaterialId] = useState<string | null>(null);
  const [abandoningMaterials, setAbandoningMaterials] = useState(false);
  const [scheduleState, dispatchSchedule] = useReducer(planCreatorScheduleReducer, null, () => ({
    deadlineDate: seed?.dueAt
      ? futureDeadlineDateInputFromIso(seed.dueAt, browserTimeZone)
      : "",
    studyFrequency: scheduleRecommendation.frequency,
    preferredWindows: [scheduleRecommendation.window],
    sessionLength: scheduleRecommendation.minutes,
    customScheduleOpen: false,
    availabilityChoices: configureAvailability(
      defaultAvailability(profileSummary),
      scheduleRecommendation.frequency,
      [scheduleRecommendation.window],
      scheduleRecommendation.minutes,
      scheduleRecommendation.window,
    ),
    recommendedWindow: scheduleRecommendation.window,
  }));
  const {
    deadlineDate,
    studyFrequency,
    preferredWindows,
    sessionLength,
    customScheduleOpen,
    availabilityChoices,
  } = scheduleState;
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<string[]>([]);
  const [diagnosticQuestions, setDiagnosticQuestions] = useState<PlanDiagnosticQuestion[]>([]);
  const [diagnosticResponses, setDiagnosticResponses] = useState<DiagnosticResponse[]>([]);
  const [diagnosticMap, setDiagnosticMap] = useState<PlanKnowledgeMap | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [diagnosticLatencyMs, setDiagnosticLatencyMs] = useState<number | null>(null);
  const [startingContext, setStartingContext] = useState(seed?.progress ?? "");
  const [generatedPlan, setGeneratedPlan] = useState<PlanGenerationResponse | null>(null);
  const [generatedFrom, setGeneratedFrom] = useState<PlanGenerationRequest | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [scheduleCapacityError, setScheduleCapacityError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [mapCorrection, setMapCorrection] = useState("");
  const [mapUpdating, setMapUpdating] = useState(false);
  const [mapCorrectionError, setMapCorrectionError] = useState<string | null>(null);
  const availability = availabilityChoices
    .filter((choice) => choice.enabled)
    .map(({ day, window, minutes }) => ({ day, window, minutes }));
  const availabilityWindows = availability.reduce<Record<string, number>>((summary, slot) => {
    summary[slot.window] = (summary[slot.window] ?? 0) + 1;
    return summary;
  }, {});
  const learningApproach = resolveLearningIntent({
    goal,
    startingPoint: startingContext,
    diagnosticResponses,
  });
  const goalContext = assessGoalContext(
    goal,
    sourceChoice === "materials" && materials.length > 0,
  );
  const mappedGeneratedFrom = generatedFrom && generatedPlan?.plan.knowledgeMap
    ? { ...generatedFrom, knowledgeMap: generatedPlan.plan.knowledgeMap }
    : generatedFrom;
  const generatedScope = mappedGeneratedFrom ? inferPlanScopeContract(mappedGeneratedFrom) : null;
  const generatedContentBudget = mappedGeneratedFrom && generatedScope
    ? buildPlanContentBudget(mappedGeneratedFrom, generatedScope)
    : null;
  const preferenceContract = buildPlanPreferenceContract(profileSummary);
  const generatedPhases = generatedPlan ? groupPlanSessions(generatedPlan.plan.sessions) : [];

  const stepNumber = ({ goal: 1, source: 2, schedule: 3, "diagnostic-loading": 4, diagnostic: 4, confirm: 5, loading: 5, error: 5, result: 5 } as Record<PlanStep, number>)[step];

  const back = () => {
    const previous: Record<PlanStep, PlanStep> = {
      goal: "goal",
      source: "goal",
      schedule: "source",
      "diagnostic-loading": "schedule",
      diagnostic: "schedule",
      confirm: "diagnostic",
      loading: "confirm",
      error: "confirm",
      result: "confirm",
    };
    setStep(previous[step]);
  };

  const buildGenerationRequest = (overrides: Partial<PlanGenerationRequest> = {}) => {
    if (!sourceChoice) throw new Error("Choose how YOVA should build this plan.");
    return PlanGenerationRequestSchema.parse({
      intent: "plan",
      learningIntent: learningApproach.intent,
      goal,
      startingContext,
      materialMode: sourceChoice === "materials" ? "upload" : "none",
      materials: sourceChoice === "materials" ? materials : [],
      studyMode: seed?.itemType === "assignment" || sourceChoice === "outside" ? "outside" : "inside",
      deadline: deadlineDate ? deadlineAtEndOfDay(deadlineDate, browserTimeZone) : null,
      timeZone: browserTimeZone,
      diagnosticResponses,
      availability,
      profileSummary,
      ...(diagnosticMap ? { knowledgeMap: diagnosticMap } : {}),
      ...overrides,
    });
  };

  const prepareDiagnostic = async () => {
    setDiagnosticError(null);
    setScheduleCapacityError(null);
    setStep("diagnostic-loading");
    try {
      const planRequest = buildGenerationRequest({ diagnosticResponses: [], knowledgeMap: undefined });
      const response = await fetch("/api/plans/generate?mode=diagnostic", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "plan-creator" } : {}),
        },
        body: JSON.stringify(planRequest),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(readApiError(body) ?? "YOVA could not prepare the placement check.");
      const parsed = PlanDiagnosticPreparationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The placement check came back in an unsafe format.");
      setDiagnosticQuestions(parsed.data.questions);
      setDiagnosticMap(parsed.data.knowledgeMap);
      setDiagnosticLatencyMs(parsed.data.generation.durationMs);
      setDiagnosticIndex(0);
      setDiagnosticAnswers([]);
      setDiagnosticResponses([]);
    } catch (error) {
      setDiagnosticQuestions([]);
      setDiagnosticMap(null);
      setDiagnosticError(userFacingErrorMessage(error, "YOVA could not prepare the placement check."));
    } finally {
      setStep("diagnostic");
    }
  };

  const finishDiagnostic = (skipped: boolean) => {
    if (skipped || !diagnosticMap) {
      setDiagnosticResponses([]);
      if (diagnosticMap) setDiagnosticMap(markDiagnosticSkipped(diagnosticMap));
      setStep("confirm");
      return;
    }
    const result = scoreDiagnostic(diagnosticMap, diagnosticQuestions, diagnosticAnswers);
    setDiagnosticResponses(result.responses);
    setDiagnosticMap(result.map);
    setStep("confirm");
  };

  const generatePlan = async () => {
    if (!sourceChoice) return;

    setGenerationError(null);
    setScheduleCapacityError(null);
    setActivationError(null);
    setStep("loading");
    let requestId: string | null = null;
    let planRequest: PlanGenerationRequest | null = null;

    try {
      planRequest = buildGenerationRequest();
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
        const capacityGuidance = planScheduleCapacityGuidance(body);
        if (capacityGuidance) {
          showScheduleCapacityError(capacityGuidance);
          return;
        }
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
        try {
          const reliablePlan = generatePreviewPlan(planRequest);
          const reliableResponse = PlanGenerationResponseSchema.parse({
            plan: reliablePlan,
            generation: {
              mode: "system",
              model: null,
              notice: LIVE_AI_PLAN_FALLBACK_NOTICE,
              requestId: requestId ?? makeId("plan_request"),
              durationMs: 0,
              persistence: "draft",
            },
          });
          setGeneratedPlan(reliableResponse);
          setGeneratedFrom(planRequest);
          setStep("result");
        } catch (fallbackError) {
          const capacityGuidance = planScheduleCapacityGuidance(fallbackError);
          if (capacityGuidance) {
            showScheduleCapacityError(capacityGuidance);
            return;
          }
          setGenerationError(userFacingErrorMessage(fallbackError, "YOVA could not build this plan yet."));
          setStep("error");
        }
        return;
      }
      setGenerationError(userFacingErrorMessage(error, "YOVA could not build this plan yet."));
      setStep("error");
    }
  };

  const showScheduleCapacityError = (guidance: string) => {
    setGeneratedPlan(null);
    setGeneratedFrom(null);
    setGenerationError(null);
    setScheduleCapacityError(guidance);
    setStep("schedule");
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
      setMaterialError(userFacingErrorMessage(error, "YOVA could not remove this material."));
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

  const reviseGeneratedPlan = (target: "goal" | "source" | "schedule" | "diagnostic") => {
    setGeneratedPlan(null);
    setGeneratedFrom(null);
    setGenerationError(null);
    setScheduleCapacityError(null);
    setActivationError(null);
    if (target === "goal") {
      setDiagnosticAnswers([]);
      setDiagnosticIndex(0);
    }
    if (target === "diagnostic") setDiagnosticIndex(0);
    setStep(target);
  };

  const updateTopicMapAndPlan = async () => {
    const correction = mapCorrection.trim();
    if (!correction || mapUpdating) return;
    setMapUpdating(true);
    setMapCorrectionError(null);
    try {
      const planRequest = buildGenerationRequest({
        knowledgeMap: undefined,
        mapCorrection: correction,
      });
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "plan-creator" } : {}),
        },
        body: JSON.stringify(planRequest),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const capacityGuidance = planScheduleCapacityGuidance(body);
        if (capacityGuidance) {
          setMapCorrectionError(`${capacityGuidance} Use Change schedule below to revise the available time.`);
          return;
        }
        throw new Error(readApiError(body) ?? "YOVA could not update this topic map yet.");
      }
      const parsed = PlanGenerationResponseSchema.safeParse(body);
      if (!parsed.success || !parsed.data.plan.knowledgeMap) throw new Error("The updated map came back in an unsafe format.");
      setGeneratedPlan(parsed.data);
      setGeneratedFrom({ ...planRequest, knowledgeMap: parsed.data.plan.knowledgeMap });
      setDiagnosticMap(parsed.data.plan.knowledgeMap);
      setMapCorrection("");
    } catch (error) {
      setMapCorrectionError(userFacingErrorMessage(error, "YOVA could not update this topic map yet."));
    } finally {
      setMapUpdating(false);
    }
  };

  const chooseFrequency = (frequency: StudyFrequency) => {
    dispatchSchedule({ type: "choose_frequency", frequency });
  };

  const togglePreferredWindow = (window: StudyWindow) => {
    dispatchSchedule({ type: "toggle_window", window });
  };

  const chooseSessionLength = (minutes: StudySessionLength) => {
    dispatchSchedule({ type: "choose_session_length", minutes });
  };

  const continueToSchedule = () => {
    if (!deadlineDate) {
      const inferredDeadline = deadlineDateFromGoal(goal, new Date(), browserTimeZone);
      if (inferredDeadline) {
        dispatchSchedule({ type: "set_deadline", deadlineDate: inferredDeadline });
      }
    }
    setStep("schedule");
  };

  const activateGeneratedPlan = async () => {
    if (!generatedPlan || !mappedGeneratedFrom || activating) return;
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
        body: JSON.stringify({ plan: generatedPlan.plan, generationRequest: mappedGeneratedFrom }),
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
      setActivationError(userFacingErrorMessage(error, "YOVA could not activate this plan yet."));
    } finally {
      setActivating(false);
    }
  };

  return (
    <main className={`plan-shell ${step === "result" ? "plan-result-shell" : ""}`}>
      <header className="plan-header">
        <BrandMark />
        {step !== "result" && <span>Step {stepNumber} of 5</span>}
        {step !== "result" && <button className="button ghost" disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} onClick={() => void exitCreator()}>{abandoningMaterials ? "Removing sources…" : "Exit"}</button>}
      </header>
      {step !== "result" && <div className="plan-progress"><i style={{ width: `${(stepNumber / 5) * 100}%` }} /></div>}

      {step === "goal" && (
        <PlanPanel eyebrow="CREATE A PLAN" title="What do you need to learn or prepare for?" description="Write it naturally. YOVA will organize the details before anything is created.">
          <textarea className="goal-input" placeholder="Example: I have a biology test next Friday on photosynthesis and cellular respiration." value={goal} onChange={(event) => setGoal(event.target.value)} />
          <p className="goal-input-hint">Include the topic and, if relevant, the test, deadline, or result you want.</p>
          {!assessGoalContext(goal).hasEnoughContext && <p className="goal-context-warning"><AlertCircle size={16} /> Add the actual topic, or continue and choose Use my materials so YOVA can identify what the class label contains.</p>}
          <PlanActions onBack={() => void exitCreator()} backLabel="Cancel" onNext={() => setStep("source")} nextDisabled={goal.trim().length < 10} />
        </PlanPanel>
      )}

      {step === "source" && (
        <PlanPanel eyebrow="CHOOSE HOW YOVA SHOULD HELP" title="Where should the learning come from?" description="Pick one starting mode. YOVA will use the same choice throughout the plan, and you can still change it later.">
          <div className="plan-goal-echo"><span>YOUR GOAL</span><p>{goal}</p><button className="button ghost" onClick={() => setStep("goal")}>Edit</button></div>
          <div className="mode-cards three-up">
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "materials" ? "selected" : ""} onClick={() => void chooseSource("materials")}><Upload /><span><strong>Use my materials</strong><small>Build from study guides, PDF slides, notes, review sheets, or textbook excerpts.</small></span>{sourceChoice === "materials" && <Check />}</button>
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "yova" ? "selected" : ""} onClick={() => void chooseSource("yova")}><Sparkles /><span><strong>Create it for me</strong><small>YOVA creates the teaching, examples, and practice from the topic.</small></span>{sourceChoice === "yova" && <Check />}</button>
            <button disabled={processingMaterials || linkMaterialWorking || abandoningMaterials || Boolean(removingMaterialId)} className={sourceChoice === "outside" ? "selected" : ""} onClick={() => void chooseSource("outside")}><Layers3 /><span><strong>Guide me outside YOVA</strong><small>YOVA chooses the method and gives exact steps for another trusted source.</small></span>{sourceChoice === "outside" && <Check />}</button>
          </div>
          {sourceChoice === "materials" && <div className="material-uploader">
            <MaterialFileDropzone
              busy={processingMaterials}
              disabled={linkMaterialWorking || Boolean(removingMaterialId) || materials.length >= 5}
              onFiles={addMaterials}
            />
            <p className="material-examples"><strong>Useful examples:</strong> teacher study guide · lecture slides exported as PDF · class notes · review sheet · readable textbook excerpt</p>
            <p className="material-supplement-note"><Sparkles size={14} /> If a source only lists topics, YOVA can fill in the minimum explanation needed while keeping your material as the scope and showing what it added.</p>
            <MaterialLinkImporter existingCount={materials.length} disabled={processingMaterials || Boolean(removingMaterialId)} onWorkingChange={setLinkMaterialWorking} onImported={(material, notice) => { setMaterials((current) => [...current, material]); setMaterialError(null); setMaterialNotice(notice); }} />
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
          <PlanActions onBack={back} onNext={continueToSchedule} nextDisabled={!sourceChoice || !goalContext.hasEnoughContext || processingMaterials || linkMaterialWorking || Boolean(removingMaterialId) || (sourceChoice === "materials" && materials.length === 0)} />
        </PlanPanel>
      )}

      {step === "schedule" && !customScheduleOpen && (
        <PlanPanel wide eyebrow="YOUR STUDY RHYTHM" title="When would you prefer to study this material?" description="Choose a realistic pattern. YOVA will build the learning sequence around it and adapt the schedule as your results change.">
          {scheduleCapacityError && <ScheduleCapacityGuidance guidance={scheduleCapacityError} />}
          <div className="schedule-builder-layout">
            <div className="schedule-quick-builder">
              <fieldset className="schedule-question"><legend><span>1</span> How often can you study?</legend><div className="schedule-choice-grid frequency">{(["every_day", "most_days", "three_four", "one_two"] as StudyFrequency[]).map((frequency) => <button type="button" key={frequency} className={studyFrequency === frequency && !customScheduleOpen ? "selected" : ""} onClick={() => chooseFrequency(frequency)}><CalendarDays size={18} /><strong>{frequencyLabel(frequency)}</strong>{scheduleRecommendation.frequency === frequency && <small>Recommended</small>}</button>)}<button type="button" className={customScheduleOpen ? "selected" : ""} onClick={() => dispatchSchedule({ type: "set_custom_open", open: true })}><SlidersHorizontal size={18} /><strong>Custom</strong><small>Choose each day</small></button></div></fieldset>
              <fieldset className="schedule-question"><legend><span>2</span> When do you prefer to study?</legend><div className="schedule-choice-grid windows">{(["Morning", "Afternoon", "Evening", "Anytime"] as StudyWindow[]).map((window) => <button type="button" key={window} className={preferredWindows.includes(window) && !customScheduleOpen ? "selected" : ""} onClick={() => togglePreferredWindow(window)}>{window === "Morning" ? <SunMedium size={18} /> : window === "Evening" ? <Moon size={18} /> : <Clock3 size={18} />}<strong>{window}</strong>{scheduleRecommendation.window === window && <small>Recommended</small>}</button>)}</div></fieldset>
              <fieldset className="schedule-question"><legend><span>3</span> What is a realistic session length?</legend><div className="schedule-choice-grid lengths">{([15, 25, 45, 60] as StudySessionLength[]).map((minutes) => <button type="button" key={minutes} aria-label={`${minutes} minutes${scheduleRecommendation.minutes === minutes ? ", recommended" : ""}`} aria-pressed={sessionLength === minutes && !customScheduleOpen} className={sessionLength === minutes && !customScheduleOpen ? "selected" : ""} onClick={() => chooseSessionLength(minutes)}><strong className="duration-value" aria-hidden="true"><span>{minutes}</span><span className="duration-unit">min</span></strong>{scheduleRecommendation.minutes === minutes && <small aria-hidden="true">Recommended</small>}</button>)}</div></fieldset>
            </div>
            <aside className="schedule-preview-card">
              <label className="schedule-deadline"><CalendarDays /><span><small>Target date</small><strong>{deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"}</strong></span><input aria-label="Target date" type="date" min={todayDateInput()} value={deadlineDate} onChange={(event) => dispatchSchedule({ type: "set_deadline", deadlineDate: event.target.value })} /></label>
              <div className="schedule-preview-summary"><Sparkles /><div><span>YOVA preview</span><strong>{availability.length} study {availability.length === 1 ? "window" : "windows"} available</strong><p>{scheduleRecommendation.reason}</p></div></div>
              <div className="schedule-preview-windows">{Object.entries(availabilityWindows).map(([window, count]) => <div key={window}>{window === "Morning" ? <SunMedium size={17} /> : window === "Evening" ? <Moon size={17} /> : <Clock3 size={17} />}<strong>{window}</strong><span>{durationLabel(availability.filter((slot) => slot.window === window).map((slot) => slot.minutes))}</span><small>{count} {count === 1 ? "session" : "sessions"}</small></div>)}</div>
              <small className="schedule-preview-note">These are availability limits, not mandatory appointments. YOVA will only schedule the amount of learning the plan actually needs.</small>
            </aside>
          </div>
          <PlanActions onBack={back} onNext={() => void prepareDiagnostic()} nextLabel="Continue to placement check" nextDisabled={availability.length === 0} />
        </PlanPanel>
      )}

      {step === "schedule" && customScheduleOpen && (
        <PlanPanel wide eyebrow="CUSTOM TIMETABLE" title="Build your study week" description="Choose the exact days, time of day, and maximum session length that work for you.">
          {scheduleCapacityError && <ScheduleCapacityGuidance guidance={scheduleCapacityError} />}
          <section className="schedule-customizer standalone">
            <header>
              <div><span className="step-label">YOUR AVAILABILITY</span><h2>{availability.length} study {availability.length === 1 ? "window" : "windows"} selected</h2><p>YOVA treats these as limits, not mandatory appointments. The plan will use only the time the material actually needs.</p></div>
              <label className="custom-deadline"><span>Target date</span><input aria-label="Custom target date" type="date" min={todayDateInput()} value={deadlineDate} onChange={(event) => dispatchSchedule({ type: "set_deadline", deadlineDate: event.target.value })} /></label>
            </header>
            <div className="availability-list editable">{availabilityChoices.map((choice, index) => <div className={choice.enabled ? "enabled" : ""} key={`${choice.day}-${choice.dateLabel}`}><button className="availability-toggle" type="button" aria-label={`${choice.enabled ? "Remove" : "Add"} ${choice.day}`} aria-pressed={choice.enabled} onClick={() => dispatchSchedule({ type: "toggle_day", index })}>{choice.enabled && <Check size={14} />}</button><div><strong>{choice.day}</strong><small>{choice.dateLabel}</small></div><select aria-label={`${choice.day} time window`} value={choice.window} disabled={!choice.enabled} onChange={(event) => dispatchSchedule({ type: "set_day_window", index, window: event.target.value as AvailabilityChoice["window"] })}><option>Morning</option><option>Afternoon</option><option>Evening</option></select><select aria-label={`${choice.day} available minutes`} value={choice.minutes} disabled={!choice.enabled} onChange={(event) => dispatchSchedule({ type: "set_day_minutes", index, minutes: Number(event.target.value) })}><option value={15}>15 min</option><option value={25}>25 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option></select></div>)}</div>
          </section>
          <PlanActions onBack={() => dispatchSchedule({ type: "set_custom_open", open: false })} backLabel="Quick choices" onNext={() => void prepareDiagnostic()} nextLabel="Continue to placement check" nextDisabled={availability.length === 0} />
        </PlanPanel>
      )}

      {step === "diagnostic-loading" && <section className="plan-loading"><span className="loading-orbit"><Sparkles /></span><h1>Preparing a short placement check…</h1><p>YOVA is sampling prerequisite and central topics from your knowledge map.</p><div><span className="done"><Check /> Mapping the goal</span><span className="active"><span /> Writing self-contained questions</span></div></section>}

      {step === "diagnostic" && (
        <PlanPanel eyebrow={diagnosticQuestions.length ? `OPTIONAL PLACEMENT CHECK · ${diagnosticIndex + 1} OF ${diagnosticQuestions.length}` : "OPTIONAL PLACEMENT CHECK"} title={diagnosticQuestions[diagnosticIndex]?.prompt ?? "Continue without a placement check"} description={diagnosticQuestions.length ? "Recommended: answering lets YOVA replace lessons on demonstrated topics with shorter verification checks, making the plan more focused." : "The placement check is unavailable right now. Skipping does not mark any topic as known, and you can take it later from the plan."}>
          {diagnosticError && <div className="chat-error"><AlertCircle size={16} /><span>{diagnosticError}</span></div>}
          {diagnosticQuestions[diagnosticIndex] && <div className="diagnostic-options">{diagnosticQuestions[diagnosticIndex].options.map((option) => <button className={diagnosticAnswers[diagnosticIndex] === option ? "selected" : ""} key={option} onClick={() => { const next = [...diagnosticAnswers]; next[diagnosticIndex] = option; setDiagnosticAnswers(next); }}>{option}{diagnosticAnswers[diagnosticIndex] === option && <Check />}</button>)}</div>}
          {diagnosticIndex === 0 && <label className="starting-context-field"><span>Anything YOVA should account for?</span><textarea rows={4} maxLength={800} value={startingContext} placeholder="Optional: what you already understand, where you feel lost, or what this plan must focus on." onChange={(event) => setStartingContext(event.target.value)} /><small>Your note can change emphasis, but it never counts as proof that a topic is known. {startingContext.length}/800</small></label>}
          {diagnosticLatencyMs !== null && <small className="diagnostic-generation-note">Built from {diagnosticMap?.topics.length ?? 0} mapped topics in {(diagnosticLatencyMs / 1_000).toFixed(1)} seconds.</small>}
          <footer className="plan-actions"><button className="button ghost" onClick={diagnosticIndex === 0 ? back : () => setDiagnosticIndex((value) => value - 1)}><ArrowLeft size={17} /> Back</button><div className="diagnostic-actions"><button className="button ghost" onClick={() => finishDiagnostic(true)}>Skip for now</button>{diagnosticQuestions.length > 0 && <button className="button primary" onClick={() => { if (diagnosticIndex === diagnosticQuestions.length - 1) finishDiagnostic(false); else setDiagnosticIndex((value) => value + 1); }} disabled={!diagnosticAnswers[diagnosticIndex]}>{diagnosticIndex === diagnosticQuestions.length - 1 ? "Use my answers" : "Next question"} <ArrowRight size={17} /></button>}</div></footer>
        </PlanPanel>
      )}

      {step === "confirm" && (
        <PlanPanel eyebrow="FINAL CHECK" title="Everything YOVA will use" description="Review the inputs and change anything before your plan is generated.">
          <div className="confirmation-list"><SummaryFact label="Goal" value={goal} /><SummaryFact label="Target date" value={deadlineDate ? formatDateOnly(deadlineDate) : "No fixed deadline"} /><SummaryFact label="Placement evidence" value={`${summarizeDiagnosticResponses(diagnosticResponses)}${startingContext.trim() ? `. Your note guides emphasis but is not evidence: ${startingContext.trim()}` : ""}`} /><SummaryFact label="How YOVA will start" value={`${LEARNING_INTENT_COPY[learningApproach.intent].name}: ${learningApproach.reason}`} /><SummaryFact label="Availability" value={`${availability.length} selected ${availability.length === 1 ? "window" : "windows"}: ${availability.map((slot) => `${slot.day} ${slot.window.toLowerCase()} (${slot.minutes} min)`).join(", ")}`} /><SummaryFact label="Learning mode" value={sourceChoice === "outside" ? "YOVA-guided plan using another trusted source" : sourceChoice === "materials" ? "Guided inside YOVA from your uploaded materials" : "Guided inside YOVA with YOVA-created teaching and practice"} /><SummaryFact label="Sources" value={sourceChoice === "materials" ? `${materials.length} ${materials.length === 1 ? "uploaded material" : "uploaded materials"}: ${materials.map((material) => material.name).join(", ")}` : sourceChoice === "outside" ? "The source you choose outside YOVA" : "YOVA-generated content from the goal"} /><SummaryFact label="Saved learning preferences" value={`${preferenceContract.presentation.label}; ${preferenceContract.support.label}; ${preferenceContract.retention.label}; ${preferenceContract.workspace.label}`} /></div>
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
          <div className="generated-heading"><div><span className="eyebrow"><Sparkles size={15} /> Plan ready</span><h1>{generatedPlan.plan.title}</h1><p>{generatedPlan.plan.sessions.length} sessions organized into a coherent path. Nothing is active until you confirm it below.</p></div>{generatedScope && <span className="generated-scope-label">{generatedScope.label}</span>}</div>
          <div className="why-plan"><Sparkles /><div><strong>Why this plan</strong><p>{generatedPlan.plan.rationale}</p></div></div>
          {generatedContentBudget && <section className="generated-plan-contract" aria-label="How YOVA mapped this plan">
            <div><span>KNOWLEDGE MAP</span><strong>{generatedContentBudget.requiredTopicCount} mapped {generatedContentBudget.requiredTopicCount === 1 ? "topic" : "topics"}</strong><p>Each topic is scheduled or shown explicitly as deferred.</p></div>
            <div><span>SESSION LOAD</span><strong>Usually {generatedContentBudget.typicalSession.preferredContentTargets} {generatedContentBudget.typicalSession.preferredContentTargets === 1 ? "target" : "targets"} at a time</strong><p>Each target needs an explanation, attempt, or application before it counts as covered.</p></div>
            <div><span>YOUR DELIVERY</span><strong>{preferenceContract.presentation.label}</strong><p>{preferenceContract.support.label} after a miss. {preferenceContract.retention.label} for later review.</p></div>
            <div><span>YOUR SCHEDULE</span><strong>{availability.length} preferred study {availability.length === 1 ? "window" : "windows"}</strong><p>{availability.map((slot) => `${slot.day} ${slot.window.toLowerCase()}, ${slot.minutes} min`).join("; ")}</p></div>
          </section>}
          {generatedPlan.plan.knowledgeMap && <section className="generated-topic-map" aria-labelledby="generated-topic-map-title">
            <header>
              <div><span className="step-label">TOPIC MAP</span><h2 id="generated-topic-map-title">Check what YOVA plans to cover</h2><p>This is the learning contract behind the schedule. Every included topic must be taught or checked, and anything skipped is shown plainly.</p></div>
              <strong>{generatedPlan.plan.knowledgeMap.topics.filter((topic) => !topic.deferred).length} included</strong>
            </header>
            <ol>{generatedPlan.plan.knowledgeMap.topics.map((topic, index) => {
              const sessionCount = generatedPlan.plan.sessions.filter((session) => session.topicIds?.includes(topic.id)).length;
              const state = topic.deferred ? "Deferred" : topic.initialEvidence?.outcome === "demonstrated" ? "Quick verification" : "Teach and check";
              return <li className={topic.deferred ? "deferred" : ""} key={topic.id}><span>{index + 1}</span><div><strong>{topic.title}</strong><p>{topic.description}</p>{topic.subtopics.length > 0 && <small>{topic.subtopics.slice(0, 4).join(" · ")}</small>}</div><em>{state}{!topic.deferred ? ` · ${sessionCount} ${sessionCount === 1 ? "session" : "sessions"}` : ""}</em></li>;
            })}</ol>
            <div className="topic-map-correction">
              <div><strong>Something is off?</strong><p>Tell YOVA what is missing, outside your goal, or needs a different emphasis. Saying you know something changes the plan only after a quick verification. It never creates evidence by itself.</p></div>
              <div className="topic-map-prompts" aria-label="Common topic map changes">
                {["A topic is missing: ", "I already know this and want a quick verification: ", "This is outside my goal: ", "Change the emphasis toward: "].map((prompt) => <button type="button" key={prompt} onClick={() => setMapCorrection(prompt)}>{prompt.replace(/:\s*$/, "")}</button>)}
              </div>
              <textarea rows={3} maxLength={800} value={mapCorrection} placeholder="Example: Include the causes of World War I, but leave detailed military technology outside this plan." onChange={(event) => setMapCorrection(event.target.value)} />
              {mapCorrectionError && <p className="plan-activation-error"><AlertCircle size={16} /> {mapCorrectionError}</p>}
              <button type="button" className="button secondary" disabled={!mapCorrection.trim() || mapUpdating} onClick={() => void updateTopicMapAndPlan()}>{mapUpdating ? <><span className="button-spinner" /> Updating map…</> : <>Update map and plan <ArrowRight size={17} /></>}</button>
            </div>
          </section>}
          <PlanGenerationNotice generation={generatedPlan.generation} onRetry={() => void generatePlan()} />
          <div className="generated-roadmap" aria-label="Learning roadmap">{generatedPhases.map((phase) => <section className="generated-phase" key={`${phase.key}-${phase.number}`}><header><div><span>{phase.number}</span><div><small>PLAN PHASE</small><h2>{phase.label}</h2></div></div><p>{phase.description}</p></header><div className="generated-timeline">{phase.sessions.map((session) => <article key={session.id}><span>{session.sequence}</span><div><small>{session.learningMode === "learn" ? "TEACHING FIRST" : "PRACTICE FIRST"} · {formatSessionDate(session.scheduledFor)}</small><h3>{session.title}</h3><p>{session.method}</p><p className="generated-session-focus">Focus: {(session.contentTargets ?? []).join("; ")}</p></div><strong>{session.amountLabel}</strong></article>)}</div></section>)}</div>
          <section className="plan-alignment-check" aria-labelledby="plan-alignment-title">
            <div className="plan-alignment-heading"><span className="step-label">BEFORE YOVA SAVES THIS</span><h2 id="plan-alignment-title">Does this plan match what you need?</h2><p>Check the content, starting approach, source, and pace. If one part is wrong, change that input and YOVA will rebuild the draft.</p></div>
            <div className="plan-alignment-facts">
              <div><span>CONTENT</span><strong>{generatedPlan.plan.topic}</strong></div>
              <div><span>STARTING APPROACH</span><strong>{generatedPlan.plan.learningIntent === "learn" ? "Teach first, then remove support" : "Practice first, then repair gaps"}</strong></div>
              <div><span>LEARNING SOURCE</span><strong>{sourceChoice === "materials" ? `${materials.length} uploaded ${materials.length === 1 ? "source" : "sources"}` : sourceChoice === "outside" ? "Your trusted source outside YOVA" : "Teaching and practice created by YOVA"}</strong></div>
              <div><span>PACE</span><strong>{generatedPlan.plan.sessions.length} sessions · {durationLabel(generatedPlan.plan.sessions.map((session) => session.estimatedMinutes), "per-session")}</strong></div>
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

function ScheduleCapacityGuidance({ guidance }: { guidance: string }) {
  return <div className="chat-error plan-schedule-capacity" role="alert"><AlertCircle size={18} /><span><strong>This plan needs more room before your target date.</strong><br />{guidance}</span></div>;
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupPlanSessions(sessions: LearningPlan["sessions"]) {
  const phaseDefinitions = {
    foundation: {
      label: "Build the foundation",
      description: "Learn the prerequisite ideas and see how the pieces connect before support is removed.",
    },
    guided: {
      label: "Learn with guidance",
      description: "Work through examples and reconstruct the reasoning with progressively less help.",
    },
    practice: {
      label: "Practice and apply",
      description: "Produce answers independently, use the ideas in new situations, and repair exposed gaps.",
    },
    review: {
      label: "Verify and retain",
      description: "Return after a delay and confirm that the important ideas are still available without support.",
    },
  } as const;
  type PhaseKey = keyof typeof phaseDefinitions;
  const groups: Array<{
    key: PhaseKey;
    label: string;
    description: string;
    number: number;
    sessions: LearningPlan["sessions"];
  }> = [];

  sessions.forEach((session, index) => {
    const methodText = `${session.title} ${session.method}`;
    const key: PhaseKey = index === sessions.length - 1 || /spaced|review|verify|retain|consolidate/i.test(methodText)
      ? "review"
      : session.learningMode === "learn"
        ? index === 0 ? "foundation" : "guided"
        : "practice";
    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.sessions.push(session);
      return;
    }
    groups.push({ key, ...phaseDefinitions[key], number: groups.length + 1, sessions: [session] });
  });

  return groups;
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

function todayDateInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export function durationLabel(minutes: number[], variant: "compact" | "per-session" = "compact") {
  const unique = [...new Set(minutes)].sort((a, b) => a - b);
  if (!unique.length) return "";
  if (variant === "per-session") {
    const unit = unique.at(-1) === 1 ? "minute" : "minutes";
    if (unique.length === 1) return `${unique[0]} ${unit} each`;
    return `${unique[0]} to ${unique.at(-1)} ${unit} each`;
  }
  if (unique.length === 1) return `${unique[0]} min`;
  return `${unique[0]}–${unique.at(-1)} min`;
}

function markDiagnosticSkipped(map: PlanKnowledgeMap): PlanKnowledgeMap {
  return PlanKnowledgeMapSchema.parse({
    ...map,
    placementCheck: {
      status: "skipped",
      completedAt: null,
      demonstratedTopicIds: [],
      gapTopicIds: [],
    },
  });
}

function scoreDiagnostic(map: PlanKnowledgeMap, questions: PlanDiagnosticQuestion[], answers: string[]) {
  const observedAt = new Date().toISOString();
  const responses: DiagnosticResponse[] = questions.map((question, index) => ({
    questionId: question.id,
    topicId: question.topicId,
    question: question.prompt,
    answer: answers[index] ?? "I don't know yet",
    evaluation: answers[index] === question.correctAnswer ? "correct" : "incorrect",
  }));
  const demonstratedTopicIds = [...new Set(responses.filter((response) => response.evaluation === "correct").map((response) => response.topicId))];
  const gapTopicIds = [...new Set(responses.filter((response) => response.evaluation === "incorrect").map((response) => response.topicId))];
  const scoredMap = PlanKnowledgeMapSchema.parse({
    ...map,
    placementCheck: { status: "completed", completedAt: observedAt, demonstratedTopicIds, gapTopicIds },
    topics: map.topics.map((topic) => {
      if (demonstratedTopicIds.includes(topic.id)) return { ...topic, status: "evidenced", initialEvidence: { source: "placement_check", outcome: "demonstrated", observedAt } };
      if (gapTopicIds.includes(topic.id)) return { ...topic, status: "not_started", initialEvidence: { source: "placement_check", outcome: "gap", observedAt } };
      return topic;
    }),
  });
  return { map: scoredMap, responses };
}

function summarizeDiagnosticResponses(responses: DiagnosticResponse[]) {
  if (responses.length === 0) return "Skipped. No topic was marked as known";
  const correct = responses.filter((response) => response.evaluation === "correct").length;
  return `${correct} of ${responses.length} mapped-topic checks demonstrated`;
}

function readApiError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

function seedGoal(seed: AddIntakeSeed) {
  // The interpretation already derives objective and scope from the original
  // description. Hand the original request to planning once instead of
  // repeating the same prose in several generated fields.
  return `${seed.title}. ${seed.description}${seed.progress ? `. Starting point: ${seed.progress}` : ""}`;
}

function seedSourceChoice(seed: AddIntakeSeed): SourceChoice {
  if (seed.materials.length) return "materials";
  if (seed.itemType === "assignment") return "outside";
  return "yova";
}

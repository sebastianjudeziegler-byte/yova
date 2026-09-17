"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { applyTopicWorkloadToRoute } from "@/lib/plan-generation/topic-workload-route";
import { GuidedConceptMap } from "./guided-concept-map";
import { conceptMapAsProduce, conceptMapCanSubmit, conceptMapItems } from "@/lib/session-shapes/concept-map";
import { QUESTION_TYPE_LABEL } from "@/lib/practice/question-mix";
import { PRACTICE_ROUND_LABEL, practiceRoundKind } from "@/lib/practice/practice-rounds";
import { AlertCircle, ArrowRight, Check, Clock3, RotateCcw, Sparkles, X } from "lucide-react";
import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { KnowledgeMapTopic } from "@/lib/knowledge-map/schema";
import type { KeyPoint, PracticeQuestion } from "@/lib/practice/compose-practice";
import { personalizationNote } from "@/lib/routing/personalization-note";
import { chosenBecause, receiptEvidence } from "@/lib/routing/rule-evidence";
import { hubRail, timerView } from "@/lib/session-shapes/session-hub";
import { tipRequest, visibleTip, type SessionTip, type TipStep } from "@/lib/session-shapes/session-tips";
import {
  alternativeProduceSteps,
  methodNameForProduceStep,
  type ProduceStep,
  type SessionRoute,
  type SessionShape,
} from "@/lib/routing/session-route";
import {
  currentShapeAStep,
  entersCompare,
  initialShapeAState,
  initialShapeADraft,
  produceAsText,
  produceStepLabel,
  shapeAReducer,
  type ShapeAComparison,
  type ShapeADraft,
  type ShapeAProduceInput,
  type ShapeAState,
} from "@/lib/session-shapes/shape-a";
import {
  currentShapeCQuestion,
  currentShapeCRound,
  initialShapeCState,
  lastShapeCAnswer,
  SHAPE_C_ESCALATION_MESSAGE,
  shapeCReducer,
  shapeCTotals,
  shapeCKeyPointOutcomes,
  type ShapeCState,
} from "@/lib/session-shapes/shape-c";
import { makeSlotIds, requestComparison, requestDirection, requestLearnBlock, requestPractice, ShapeSlotClientError } from "@/lib/session-shapes/slots-client";
import { routeFingerprint, type BaselineCheckpoint, type StudyLocation } from "@/lib/session-shapes/baseline-checkpoint";
import { baselineSourceForTopics } from "@/lib/session-shapes/source-context";
import { CORE_METHOD_CATALOG } from "@/lib/learning/method-catalog";
import {
  SHAPE_SLOT_HONEST_ERROR,
  type DirectionResponse,
  type LearnBlockResponse,
  type PracticeRequest,
  type SourceDescription,
  type SourceExcerpt,
} from "@/lib/session-shapes/slots-schema";
import styles from "./baseline-session.module.css";
import { AskYova, HubBriefing, HubHeader, HubShapeCard, HubSourceCard, HubTargetCard, HubTimerCard, HubTipCard, StepHead, StepPosition, type MethodControl } from "./session-hub";
import hubStyles from "./session-hub.module.css";

/**
 * The baseline session runner. Shape A and Shape C are coded step sequences
 * (docs/redesign/01-SESSION-SHAPES.md); this component renders whatever step
 * the reducers say is current and asks the API to fill one bounded slot at a
 * time. It never assembles a session and never sizes it to a time slot.
 */
export type BaselineSessionSource = {
  description: SourceDescription | null;
  excerpts: SourceExcerpt[];
};

export type BaselineSessionResult = {
  shape: SessionShape;
  methodName: string;
  ruleIds: string[];
  noteRuleId: string;
  correctAnswers: number;
  totalAnswers: number;
  keyPointOutcomes: Array<{ keyPointId: string; text: string; sourceTopicId?: string; outcome: "secure" | "needs_review" }>;
  topicDone: boolean;
  escalated: boolean;
  produced: string | null;
  comparison: ShapeAComparison | null;
  revision?: { produced: string; comparison: ShapeAComparison | null; status: "checked" | "unchecked" };
  comparisonUnavailable?: boolean;
  elapsedSeconds: number;
};

export type BaselineSessionProps = {
  plan: LearningPlan;
  session: LearningPlanSession;
  topic: KnowledgeMapTopic | null;
  route: SessionRoute;
  nextSession: LearningPlanSession | null;
  onChangeProduceStep: (step: ProduceStep) => void;
  onExit: () => void;
  onComplete: (result: BaselineSessionResult, continueToNext?: boolean) => Promise<boolean>;
  continuationSession?: LearningPlanSession | null;
  /** Interleaved Review only: the key points of related topics that each passed once (Brief 1.5 item 3). */
  interleavedKeyPoints?: KeyPoint[];
  /** Inside or outside YOVA, chosen on the pre-session card (Brief 1.5 item 8). */
  studyLocation?: StudyLocation;
  /** Where the learner left off; the session opens on that step (Brief 1.5 item 8). */
  checkpoint?: BaselineCheckpoint | null;
  onCheckpoint?: (checkpoint: BaselineCheckpoint) => boolean | void;
};

type SlotStatus = "idle" | "loading" | "ready" | "error";
type RepairTarget = PracticeRequest["repairTargets"][number];

function slotErrorMessage(error: unknown) {
  if (error instanceof ShapeSlotClientError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return null;
  return SHAPE_SLOT_HONEST_ERROR;
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function BaselineSession(props: BaselineSessionProps) {
  const { plan, session, topic, route: baseRoute, nextSession, continuationSession = null, onChangeProduceStep, onExit, onComplete, interleavedKeyPoints, studyLocation = "inside", checkpoint = null, onCheckpoint } = props;
  const route = useMemo(() => applyTopicWorkloadToRoute(baseRoute, session.workload), [baseRoute, session.workload]);
  const planMaterials = plan.materials;
  const planSourceMode = plan.sourceMode;
  const selectedTopics = useMemo(() => session.workload
    ? session.workload.topicSubtopics.flatMap((entry) => plan.knowledgeMap?.topics.filter((candidate) => candidate.id === entry.topicId) ?? [])
    : topic ? [topic] : [], [session.workload, plan.knowledgeMap, topic]);
  const source: BaselineSessionSource = useMemo(
    () => baselineSourceForTopics({ materials: planMaterials, sourceMode: planSourceMode }, selectedTopics),
    [planMaterials, planSourceMode, selectedTopics],
  );
  const topicId = topic?.id ?? session.topicIds?.[0] ?? null;
  const topicTitle = topic?.title ?? session.title;
  const slotTopic = useMemo(() => ({
    id: topicId ?? "00000000-0000-4000-8000-000000000000",
    title: topicTitle,
    description: (topic?.description ?? session.objective).slice(0, 400).padEnd(8, "."),
    subtopics: (session.workload?.topicSubtopics.find((entry) => entry.topicId === topicId)?.subtopics ?? topic?.subtopics ?? []).slice(0, 12),
    relatedTopics: selectedTopics.filter((candidate) => candidate.id !== topicId).map((candidate) => ({ id: candidate.id, title: candidate.title, subtopics: (session.workload?.topicSubtopics.find((entry) => entry.topicId === candidate.id)?.subtopics ?? candidate.subtopics).slice(0, 12) })),
    learningGoal: (plan.planModel?.learningGoal ?? [plan.title, plan.topic, plan.rationale, session.objective].join(". ")).slice(0, 1_200),
    taskType: route.input.taskType,
  }), [route.input.taskType, session.objective, session.workload, plan.planModel, plan.title, plan.topic, plan.rationale, topic, topicId, topicTitle, selectedTopics]);
  const modifiers = useMemo(() => ({
    instructionStyle: route.instructionStyle,
    questionMix: route.questionMix,
    produceStep: route.produceStep,
    explanationFocus: route.explanationFocus,
    questionCap: route.questionCap,
    questionTarget: route.questionTarget,
    workloadBounded: Boolean(session.workload),
  }), [route.explanationFocus, route.instructionStyle, route.produceStep, route.questionCap, route.questionMix, route.questionTarget, session.workload]);

  // ---------------------------------------------------------------- timer
  // Pause freezes only this counter; nothing server-side pauses. Hidden, +5 and
  // the acknowledgement are session-scoped UI state (handoff decision).
  const [elapsedSeconds, setElapsedSeconds] = useState(checkpoint?.elapsedSeconds ?? 0);
  const [elapsedSecondsRestored] = useState(checkpoint?.elapsedSeconds ?? 0);
  const clockRef = useRef<{ accumulatedMs: number; runningSince: number | null }>({ accumulatedMs: elapsedSecondsRestored * 1_000, runningSince: null });
  const [timerPaused, setTimerPaused] = useState(checkpoint?.timer?.paused ?? false);
  const [timerHidden, setTimerHidden] = useState(checkpoint?.timer?.hidden ?? false);
  const [timerExtraMinutes, setTimerExtraMinutes] = useState(checkpoint?.timer?.extraMinutes ?? 0);
  const [acknowledgedLimit, setAcknowledgedLimit] = useState<number | null>(checkpoint?.timer?.acknowledgedLimit ?? null);
  useEffect(() => {
    const clock = clockRef.current;
    if (!checkpoint?.timer?.paused) clock.runningSince ??= Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((clock.accumulatedMs + (clock.runningSince === null ? 0 : Date.now() - clock.runningSince)) / 1_000));
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [checkpoint?.timer?.paused]);
  const pauseTimer = () => {
    const clock = clockRef.current;
    if (clock.runningSince !== null) clock.accumulatedMs += Date.now() - clock.runningSince;
    clock.runningSince = null;
    setTimerPaused(true);
  };
  const resumeTimer = () => {
    clockRef.current.runningSince ??= Date.now();
    setTimerPaused(false);
  };
  const timer = timerView({ elapsedSeconds, timerMinutes: route.timerMinutes, extraMinutes: timerExtraMinutes, acknowledgedLimit });

  // ---------------------------------------------------------------- shapes
  const [aState, dispatchA] = useReducer(shapeAReducer, route, (initial) => checkpoint?.aState ? { ...checkpoint.aState, repairStatus: checkpoint.aState.repairStatus === "pending" ? "error" : checkpoint.aState.repairStatus } : initialShapeAState(initial));
  const [cState, dispatchC] = useReducer(shapeCReducer, route, (initial) => checkpoint?.cState ?? initialShapeCState(initial));
  // Active Recall: Shape A's study step hands off to closed-book questions.
  const handoffToQuestions = route.shape === "A" && (route.produceStep === "retrieval_questions" || (session.workload?.questionCount ?? 0) > 0);
  const aStep = currentShapeAStep(aState);
  // A memorization learn block is Shape C but opens on a brief study step, so
  // "in questions" cannot simply mean "this route is Shape C".
  const inQuestions = route.shape === "C"
    ? cState.phase !== "brief_study"
    : handoffToQuestions && aStep?.kind === "end";
  // The pre-session card already offered the method choice (Brief 1.5 item 8), so the hub opens on the work.
  const [started, setStarted] = useState(true);
  const [methodPanelOpen, setMethodPanelOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishIssue, setFinishIssue] = useState<string | null>(null);

  // ---------------------------------------------------------------- slots
  // Every request starts from an event (a click, or the first render's
  // hand-off) and only updates state when its promise settles, so no effect
  // sets state synchronously.
  const [direction, setDirection] = useState<DirectionResponse | null>(checkpoint?.direction ?? null);
  const [learnBlock, setLearnBlock] = useState<LearnBlockResponse | null>(checkpoint?.learnBlock ?? null);
  const [learnStatus, setLearnStatus] = useState<SlotStatus>(checkpoint?.direction || checkpoint?.learnBlock ? "ready" : "idle");
  const [learnError, setLearnError] = useState<string | null>(null);
  const [compareStatus, setCompareStatus] = useState<SlotStatus>("idle");
  const [compareError, setCompareError] = useState<string | null>(null);
  const [practiceKeyPoints, setPracticeKeyPoints] = useState<KeyPoint[]>(checkpoint?.practiceKeyPoints ?? []);
  // Brief 1.5 item 5: examples-first may only be claimed when an example was shown.
  const shownExample = learnBlock?.example ?? direction?.example ?? null;
  const workedExampleIndex = aState.steps.findIndex((step) => step.kind === "worked_structure");
  const exampleShown = workedExampleIndex >= 0 ? aState.exampleViewed ? true : aState.index > workedExampleIndex ? false : undefined : undefined;
  const happened = useMemo(() => ({ exampleShown, practiceOccurred: cState.rounds.length > 0, repairRoundOccurred: cState.rounds.length > 1, checkInsShown: route.stoppingPoints === "after_each_step" }), [exampleShown, cState.rounds.length, route.stoppingPoints]);
  const note = useMemo(() => personalizationNote(route, happened), [route, happened]);
  const pills = useMemo(() => chosenBecause(route, { exampleShown, practiceOccurred: route.shape === "C" || handoffToQuestions }), [route, exampleShown, handoffToQuestions]);
  // Brief 1.5 item 7: every fired rule is named on the end receipt (the difficulty band only by its effect).
  const receipt = useMemo(() => receiptEvidence(route, happened), [route, happened]);
  // Brief 1.5 item 6: each slot call writes the tips for the steps it covers.
  const [tips, setTips] = useState<Partial<Record<TipStep, SessionTip>>>(checkpoint?.tips ?? {});
  const mergeTips = useCallback((written: SessionTip[]) => {
    if (written.length) setTips((current) => ({ ...current, ...Object.fromEntries(written.map((tip) => [tip.step, tip])) }));
  }, []);
  const questionsInBlock = route.shape === "C" || handoffToQuestions;
  const studyTips = useMemo(() => {
    const first: TipStep = route.shape === "C" ? "brief" : "study";
    const withQuestions: TipStep[] = [first, "questions", "round", "end"];
    return {
      direction: tipRequest(route, questionsInBlock ? [first] : ["study", "produce"], { practiceOccurred: questionsInBlock }),
      learnBlock: tipRequest(route, questionsInBlock ? withQuestions : ["study", "produce"], { practiceOccurred: questionsInBlock }),
    };
  }, [route, questionsInBlock]);
  const practiceTips = useMemo(() => tipRequest(route, ["questions", "round", "end"], { exampleShown, practiceOccurred: true }), [route, exampleShown]);
  const compareTips = useMemo(() => tipRequest(route, ["compare", "repair", "end"], { exampleShown, practiceOccurred: false }), [route, exampleShown]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const planId = plan.id;
  const planSessionId = session.id;

  const sourceDescription = source.description;
  const requestStudySlot = useCallback((signal: AbortSignal) => {
    const outside = route.learnPath === "outside";
    const request = outside || (route.learnPath === "source" && sourceDescription)
      ? requestDirection({ ...makeSlotIds(), planId, planSessionId, action: "direction", topic: slotTopic, modifiers, source: sourceDescription, entry: route.entry === "brief_review" ? "brief_review" : "study_full", excerpts: outside ? source.excerpts.slice(0, 4) : (route.workedStructureBeforeProduce || route.produceStep === "worked_solution") ? source.excerpts.slice(0, 8) : [], wantsExample: !outside && route.workedStructureBeforeProduce, purpose: outside ? "study_outside" : "study_inside", tips: studyTips.direction }, signal)
        .then((result) => { setDirection(result); mergeTips(result.tips); })
      : requestLearnBlock({ ...makeSlotIds(), planId, planSessionId, action: "learn_block", topic: slotTopic, modifiers, tips: studyTips.learnBlock }, signal)
        .then((result) => { setLearnBlock(result); setPracticeKeyPoints(result.keyPoints); mergeTips(result.tips); });
    request.then(() => setLearnStatus("ready")).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      setLearnError(message);
      setLearnStatus("error");
    });
  }, [route.learnPath, route.entry, route.workedStructureBeforeProduce, route.produceStep, source.excerpts, sourceDescription, slotTopic, modifiers, planId, planSessionId, studyTips, mergeTips]);

  const needsStudySlot = started && !inQuestions && (
    (route.shape === "A" && (aStep?.kind === "direct" || aStep?.kind === "explanation" || aStep?.kind === "worked_structure" || (aStep?.kind === "produce" && route.produceStep === "worked_solution")))
    || (route.shape === "C" && cState.phase === "brief_study")
  );
  // The effect owns its request: an unmount (including StrictMode's
  // development remount) aborts it, and the guard on status restarts it.
  useEffect(() => {
    if (!needsStudySlot || learnStatus !== "idle") return;
    const controller = new AbortController();
    requestStudySlot(controller.signal);
    return () => controller.abort();
  }, [needsStudySlot, learnStatus, requestStudySlot]);
  const retryStudySlot = () => {
    setLearnError(null);
    setLearnStatus("idle");
  };
  const studyLoading = learnStatus === "idle" && needsStudySlot;

  const sourceExcerpts = source.excerpts;
  const practiceProblem = learnBlock?.practiceProblem ?? direction?.practiceProblem;
  const requestPracticeRound = useCallback((round: number, outstandingKeyPointIds: string[], knownKeyPoints: KeyPoint[], repairTargets: RepairTarget[], signal: AbortSignal) => {
    // Brief 1.5 item 3: the round kind is code's choice, and each kind is a different round.
    const roundKind = practiceRoundKind(route.firstPracticeRound, round);
    const keyPoints = !knownKeyPoints.length && roundKind === "interleaved_review" ? (interleavedKeyPoints ?? []) : knownKeyPoints;
    requestPractice({
      ...makeSlotIds(),
      planId,
      planSessionId,
      action: "practice",
      topic: slotTopic,
      modifiers,
      round,
      keyPoints,
      outstandingKeyPointIds,
      excerpts: sourceExcerpts.slice(0, 8),
      attempt: crypto.randomUUID(),
      roundKind,
      repairTargets: roundKind === "error_repair" ? repairTargets : [],
      tips: practiceTips,
    }, signal).then((result) => {
      if (!knownKeyPoints.length) setPracticeKeyPoints(result.keyPoints);
      mergeTips(result.tips);
      dispatchC({ type: "questions_ready", questions: result.questions });
    }).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      dispatchC({ type: "questions_failed", message });
    });
  }, [slotTopic, modifiers, sourceExcerpts, planId, planSessionId, route.firstPracticeRound, interleavedKeyPoints, practiceTips, mergeTips]);

  const nextRoundNumber = (currentShapeCRound(cState)?.number ?? 0) + 1;
  const outstandingKeyPointIds = cState.outstandingKeyPointIds;
  const lastRound = currentShapeCRound(cState);
  // Error Repair targets: what the learner chose on each question they missed.
  const repairTargets = useMemo<RepairTarget[]>(() => (lastRound?.answers ?? []).flatMap((answer) => {
    const missed = lastRound?.questions.find((question) => question.id === answer.questionId);
    if (answer.correct || !missed) return [];
    return [{ keyPointId: missed.keyPointIds[0]!, question: missed.prompt, chosenAnswer: missed.choices[answer.choiceIndex]!, correctAnswer: missed.choices[missed.correctChoiceIndex]! }];
  }).slice(0, 8), [lastRound]);
  const practiceLoading = started && inQuestions && cState.phase === "loading";
  useEffect(() => {
    if (!practiceLoading) return;
    const controller = new AbortController();
    requestPracticeRound(nextRoundNumber, outstandingKeyPointIds, practiceKeyPoints, repairTargets, controller.signal);
    return () => controller.abort();
  }, [practiceLoading, nextRoundNumber, outstandingKeyPointIds, practiceKeyPoints, repairTargets, requestPracticeRound]);
  const retryPractice = () => dispatchC({ type: "continue" });

  /**
   * Round 1 of an AI-explained block reuses the questions generated in the
   * same call as the explanation: practice cannot test what the explanation
   * did not cover. Dispatched from the click that enters the questions.
   */
  const enterQuestionsFromLearnBlock = () => {
    if (!learnBlock || currentShapeCRound(cState)) return;
    dispatchC({ type: "questions_ready", questions: learnBlock.questions });
  };

  const continueShapeA = () => {
    const next = shapeAReducer(aState, { type: "continue" });
    if (aStep?.kind === "worked_structure" && shownExample) dispatchA({ type: "example_viewed" });
    dispatchA({ type: "continue" });
    if (handoffToQuestions && currentShapeAStep(next)?.kind === "end") enterQuestionsFromLearnBlock();
    // Try-it-first: produced earlier, arrives at Compare from the study step.
    if (entersCompare(aState, next) && next.produce) startCompare(next.produce);
  };

  const requestCompare = useCallback((produce: ShapeAProduceInput) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    requestComparison({
      ...makeSlotIds(),
      planId,
      planSessionId,
      action: "compare",
      topic: slotTopic,
      modifiers,
      produced: produceAsText(produce).slice(0, 6_000),
      mapItems: produce.kind === "concept_map" && produce.map ? conceptMapItems(produce.map) : [],
      reference: { excerpts: sourceExcerpts.slice(0, 8), keyPoints: learnBlock?.keyPoints ?? [], ...(practiceProblem ? { practiceProblem } : {}) },
      tips: compareTips,
    }, controller.signal).then((result) => {
      mergeTips(result.tips);
      dispatchA({ type: "comparison_ready", comparison: { feedback: result.feedback, missing: result.missing, incorrect: result.incorrect, itemFeedback: result.itemFeedback } });
      setCompareStatus("ready");
    }).catch((error: unknown) => {
      const message = slotErrorMessage(error);
      if (message === null) return;
      setCompareError(message);
      setCompareStatus("error");
    });
  }, [slotTopic, modifiers, sourceExcerpts, practiceProblem, learnBlock, planId, planSessionId, compareTips, mergeTips]);

  function startCompare(produce: ShapeAProduceInput) {
    setCompareStatus("loading");
    setCompareError(null);
    requestCompare(produce);
  }

  const submitProduce = (produce: ShapeAProduceInput) => {
    const next = shapeAReducer(aState, { type: "submit_produce", produce });
    if (next === aState) return;
    dispatchA({ type: "submit_produce", produce });
    if (entersCompare(aState, next)) startCompare(produce);
  };
  const retryCompare = () => {
    if (!aState.produce) return;
    setCompareStatus("loading");
    setCompareError(null);
    requestCompare(aState.produce);
  };

  // ---------------------------------------------------------------- resume
  // Draft changes checkpoint synchronously in the input event, before React can
  // unmount the card. This includes the final keystroke before Exit or reload.
  const fingerprint = routeFingerprint(route, { workload: session.workload, learningGoal: plan.planModel?.learningGoal });
  const [checkpointIssue, setCheckpointIssue] = useState(false);
  const snapshot: BaselineCheckpoint = {
    version: 1, planId, planSessionId, produceStep: route.produceStep, studyLocation, routeFingerprint: fingerprint,
    savedAt: new Date().toISOString(), elapsedSeconds, started, aState, cState, direction, learnBlock, practiceKeyPoints, tips,
    timer: { paused: timerPaused, hidden: timerHidden, extraMinutes: timerExtraMinutes, acknowledgedLimit },
  };
  const checkpointRef = useRef(snapshot);
  useEffect(() => {
    checkpointRef.current = snapshot;
    const failed = onCheckpoint?.(snapshot) === false;
    let cancelled = false;
    if (failed !== checkpointIssue) queueMicrotask(() => { if (!cancelled) setCheckpointIssue(failed); });
    return () => { cancelled = true; };
  });
  const checkpointDraft = (draft: ShapeADraft) => {
    const updated = { ...checkpointRef.current, aState: shapeAReducer(aState, { type: "edit_draft", draft }), savedAt: new Date().toISOString() };
    checkpointRef.current = updated;
    setCheckpointIssue(onCheckpoint?.(updated) === false);
    dispatchA({ type: "edit_draft", draft });
  };
  const flushCheckpoint = useCallback(() => {
    const clock = clockRef.current;
    const seconds = Math.floor((clock.accumulatedMs + (clock.runningSince === null ? 0 : Date.now() - clock.runningSince)) / 1_000);
    onCheckpoint?.({ ...checkpointRef.current, elapsedSeconds: seconds, savedAt: new Date().toISOString() });
  }, [onCheckpoint]);
  useEffect(() => {
    window.addEventListener("pagehide", flushCheckpoint);
    return () => window.removeEventListener("pagehide", flushCheckpoint);
  }, [flushCheckpoint]);
  const exitSession = () => { flushCheckpoint(); onExit(); };

  const [repairError, setRepairError] = useState<string | null>(null);
  const repairBusy = useRef(false);
  const submitRepair = (text: string, revisedProduce?: ShapeAProduceInput) => {
    if (!text.trim() || repairBusy.current || aState.repairStatus === "checked" || !aState.produce || !aState.comparison) return;
    repairBusy.current = true;
    setRepairError(null);
    dispatchA({ type: "submit_repair", text, produce: revisedProduce });
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const deadline = window.setTimeout(() => controller.abort(), 45_000);
    requestComparison({
      ...makeSlotIds(), planId, planSessionId, action: "compare", topic: slotTopic, modifiers,
      produced: text.slice(0, 6_000),
      revision: { originalProduced: produceAsText(aState.produce).slice(0, 6_000), originalComparison: { feedback: aState.comparison.feedback, missing: aState.comparison.missing, incorrect: aState.comparison.incorrect } },
      mapItems: revisedProduce?.kind === "concept_map" && revisedProduce.map ? conceptMapItems(revisedProduce.map) : [],
      reference: { excerpts: sourceExcerpts.slice(0, 8), keyPoints: learnBlock?.keyPoints ?? [], ...(practiceProblem ? { practiceProblem } : {}) }, tips: [],
    }, controller.signal).then((result) => {
      dispatchA({ type: "repair_comparison_ready", comparison: { feedback: result.feedback, missing: result.missing, incorrect: result.incorrect, itemFeedback: result.itemFeedback } });
    }).catch((error: unknown) => {
      dispatchA({ type: "repair_failed" });
      setRepairError(slotErrorMessage(error) ?? "The check took too long. Your correction is saved and remains unchecked.");
    }).finally(() => { window.clearTimeout(deadline); repairBusy.current = false; });
  };
  const skipRepair = () => {
    if (aStep?.kind === "compare") dispatchA({ type: "skip_comparison" });
    else dispatchA({ type: "skip_repair" });
    if (handoffToQuestions) enterQuestionsFromLearnBlock();
  };

  // ---------------------------------------------------------------- end
  const totals = shapeCTotals(cState);
  const atEnd = route.shape === "A"
    ? (handoffToQuestions ? ["done", "escalate"].includes(cState.phase) : aStep?.kind === "end")
    : ["done", "escalate"].includes(cState.phase);
  const canOfferContinuation = cState.phase === "done" && continuationSession !== null && elapsedSeconds < (session.workload?.ceilingMinutes ?? route.timerMinutes) * 60;

  const finish = async (continueToNext = false) => {
    if (finishing) return;
    setFinishing(true);
    setFinishIssue(null);
    const outcomes = shapeCKeyPointOutcomes(cState, practiceKeyPoints);
    const ok = await onComplete({
      shape: route.shape,
      methodName: route.methodName,
      ruleIds: route.ruleIds,
      noteRuleId: note.ruleId,
      correctAnswers: totals.correct,
      totalAnswers: totals.total,
      keyPointOutcomes: outcomes,
      topicDone: cState.phase === "done",
      escalated: cState.phase === "escalate",
      produced: aState.produce ? produceAsText(aState.produce) : null,
      comparison: aState.comparison,
      comparisonUnavailable: aState.comparisonUnavailable,
      ...(aState.repair ? { revision: { produced: aState.repair, comparison: aState.repairComparison ?? null, status: aState.repairStatus === "checked" ? "checked" as const : "unchecked" as const } } : {}),
      elapsedSeconds,
    }, continueToNext).catch(() => false);
    if (!ok) {
      setFinishing(false);
      setFinishIssue("YOVA could not save this session. Your work is still on screen; try again.");
    }
  };

  // ---------------------------------------------------------------- render
  const restate = route.instructionStyle === "plain_restated";
  const alternatives = alternativeProduceSteps(route);
  // Handoff 3A: the control stays visible once locked; the locked state is the message.
  // No control at all where there is nothing to change to, or the learner asked not to be offered one.
  const methodControl: MethodControl = route.visibility === "silent" || alternatives.length === 0
    ? "hidden"
    : !inQuestions && aState.index === 0 && !aState.produce ? "enabled" : "locked";
  const rail = hubRail({ route, aState, cState, atEnd, inQuestions, workload: session.workload });
  const tip = started ? visibleTip(tips, rail.tipStep, route, { ...happened, practiceOccurred: inQuestions || (atEnd && cState.rounds.length > 0) }) : null;
  const acknowledgeTimer = () => {
    setAcknowledgedLimit(timer.limitMinutes);
    dispatchA({ type: "acknowledge_timer" });
    dispatchC({ type: "acknowledge_timer" });
  };

  return <div className={styles.shell} data-shape={route.shape} data-method={route.methodId} data-rule-ids={route.ruleIds.join(" ")}>
    <HubHeader
      eyebrow={`${route.input.blockKind === "learn" ? "LEARN BLOCK" : "PRACTICE BLOCK"} · ${plan.title}`}
      topic={topicTitle}
      methodLine={`Method: ${route.methodName}`}
      onExit={exitSession}
      exitIcon={<X size={16} />}
    />

    <div className={hubStyles.page}>
      {checkpointIssue && <p className={styles.issue} role="status">Your work remains in this tab, but this browser could not save the draft. Keep this tab open to avoid losing it.</p>}
      <HubBriefing route={route} pills={pills} methodControl={methodControl} methodPanelOpen={methodPanelOpen} onToggleMethodPanel={() => setMethodPanelOpen((open) => !open)} />

      {timer.banner && route.pacePrompts && !atEnd && <div className={styles.nudge} role="status">
        <span><Clock3 size={16} /> Your {timer.limitMinutes}-minute timer is up. Stop at a natural break, or keep going.</span>
        <button type="button" className="button secondary" onClick={acknowledgeTimer}>Keep going</button>
      </div>}

      <div className={hubStyles.body}>
        <StepPosition.Provider value={`STEP ${rail.stepNumber} OF ${rail.stepCount}`}>
          <div className={hubStyles.work}>
            {(methodPanelOpen || !started) && route.visibility !== "silent" && <section className={styles.methodPanel} aria-label="Method choice">
              <span className="step-label">{route.visibility === "chooser" ? "CHOOSE HOW TO PROVE IT" : "CHANGE METHOD"}</span>
              <p>{note.sentence}</p>
              <div className={styles.methodOptions}>
                {route.produceStep && <button type="button" aria-pressed onClick={() => { setMethodPanelOpen(false); setStarted(true); }}><strong>{route.methodName}</strong> · {produceStepLabel(route.produceStep)} (YOVA&apos;s pick)</button>}
                {alternatives.map((step) => <button type="button" key={step} aria-pressed={false} onClick={() => { setMethodPanelOpen(false); setStarted(true); onChangeProduceStep(step); }}><strong>{methodNameForProduceStep(route, step)}</strong> · {produceStepLabel(step)}</button>)}
              </div>
              {!started && <button type="button" className="button primary" onClick={() => setStarted(true)}>Start with {route.methodName} <ArrowRight size={16} /></button>}
            </section>}

            {started && !atEnd && !inQuestions && route.shape === "A" && aStep && <ShapeAStepCard
              step={aStep.kind}
              sourceReadMinutes={session.workload?.sourceReadMinutes ?? route.timerMinutes}
              route={route}
              state={aState}
              restate={restate}
              why={note.sentence}
              whyRuleId={note.ruleId}
              direction={direction}
              learnBlock={learnBlock}
              learnStatus={studyLoading ? "loading" : learnStatus}
              learnError={learnError}
              compareStatus={compareStatus}
              compareError={compareError}
              onRetryStudy={retryStudySlot}
              onRetryCompare={retryCompare}
              onContinue={continueShapeA}
              onSubmitProduce={submitProduce}
              onSubmitRepair={submitRepair}
              repairError={repairError}
              onDraftChange={checkpointDraft}
              onSkipRepair={skipRepair}
              onExit={exitSession}
            />}

            {started && !atEnd && route.shape === "C" && cState.phase === "brief_study" && <section className={styles.card}>
              <StepHead>BRIEF STUDY</StepHead>
              <h2>{topicTitle}</h2>
              {restate && <p className={styles.restated}>Read this once, then answer questions without it.</p>}
              {studyLoading && <p className={styles.loading}><span className="button-spinner dark" /> Writing your explanation…</p>}
              {learnStatus === "error" && <HonestError message={learnError} onRetry={retryStudySlot} onExit={onExit} />}
              {route.learnPath === "source" && direction && <><p>{direction.whatToLookAt}</p><p>{direction.howToApproach}</p></>}
              {learnBlock && <><div className={styles.explanation}>{learnBlock.explanation}</div><Bullets items={learnBlock.keyPoints.map((keyPoint) => keyPoint.text)} /></>}
              {learnStatus === "ready" && <div className={styles.actions}><button type="button" className="button primary" onClick={() => { dispatchC({ type: "continue" }); enterQuestionsFromLearnBlock(); }}>Start the questions <ArrowRight size={16} /></button></div>}
            </section>}

            {started && !atEnd && inQuestions && <ShapeCCard
              state={cState}
              route={route}
              restate={restate}
              onAnswer={(choiceIndex) => dispatchC({ type: "answer", choiceIndex })}
              onNext={() => dispatchC({ type: "next" })}
              onStartNextRound={() => dispatchC({ type: "start_next_round" })}
              onRetry={retryPractice}
              planId={plan.id}
              onExit={exitSession}
            />}

            {route.stoppingPoints === "after_each_step" && !atEnd && <p className={styles.restated} data-testid="session-check-in">A stopping point: take a pause if you need one. {checkpointIssue ? "Keep this tab open while draft saving is unavailable." : "You can leave and resume from this point."}</p>}

            {atEnd && <section className={styles.card} aria-labelledby="baseline-session-end-title">
              <StepHead>SESSION COMPLETE</StepHead>
              <h2 id="baseline-session-end-title">{cState.phase === "escalate" ? "This one isn't sticking yet." : route.shape === "A" && !handoffToQuestions ? aState.comparisonUnavailable ? "Your work is saved for this session." : "You studied, produced and compared." : cState.phase === "done" ? "A full round passed clean." : "Practice complete."}</h2>
              {cState.phase === "escalate" && <div className={styles.feedback}><strong>{SHAPE_C_ESCALATION_MESSAGE}</strong><p>The points you passed stay recorded. Check the next activity in your plan, or finish here.</p></div>}
              <div className={styles.endGrid}>
                {totals.total > 0 && <div><span>Questions</span><strong>{totals.correct} of {totals.total} correct</strong><small>{cState.rounds.length} {cState.rounds.length === 1 ? "round" : "rounds"}, checked in code</small></div>}
                {aState.comparison && <ComparisonSummary state={aState} />}
                {aState.comparisonUnavailable && <div><span>Comparison</span><strong>Feedback unavailable</strong><small>Your submitted work was kept.</small></div>}
                <div><span>What&apos;s next</span><strong>{nextSession ? nextSession.title : "Nothing else queued in this plan"}</strong><small>{nextSession ? `${nextSession.learningMode === "learn" ? "Learn block" : "Practice block"} · ${nextSession.estimatedMinutes} min` : "Add a topic or open another plan"}</small></div>
              </div>
              <p className={styles.note} data-rule-id={note.ruleId}><Sparkles size={16} /> <span>{note.sentence}</span></p>
              <details className={styles.receipt} data-testid="session-receipt">
                <summary>Why this session ran this way</summary>
                <ul>{receipt.map((entry) => <li key={entry.ruleId} data-receipt-rule-id={entry.ruleId}>{entry.sentence}</li>)}</ul>
              </details>
              {finishIssue && <div className={styles.issue}><AlertCircle size={16} /><span>{finishIssue}</span></div>}
              {canOfferContinuation && continuationSession && <p>You finished the planned questions with time left in your session allowance. Continue to {continuationSession.title}, or finish here.</p>}
              <div className={styles.actions}>
                {canOfferContinuation && <button type="button" className="button secondary" disabled={finishing} onClick={() => void finish(true)}>Save and start next activity <ArrowRight size={16} /></button>}
                <button type="button" className="button primary large" disabled={finishing} onClick={() => void finish()}>{finishing ? "Saving…" : "Finish"} {!finishing && <ArrowRight size={16} />}</button>
              </div>
            </section>}
          </div>
        </StepPosition.Provider>

        <aside className={hubStyles.rail} aria-label="Session hub">
          {tip && <HubTipCard key={`${tip.step}:${tip.title}`} tip={tip} stepNumber={rail.stepNumber} planId={plan.id} topicTitle={topicTitle} />}
          <HubTimerCard
            clock={formatClock(elapsedSeconds)}
            limitMinutes={timer.limitMinutes}
            progress={timer.progress}
            over={timer.over}
            paused={timerPaused}
            hidden={timerHidden}
            onPause={pauseTimer}
            onResume={resumeTimer}
            onExtend={() => setTimerExtraMinutes((minutes) => minutes + 5)}
            onHide={() => setTimerHidden(true)}
            onShow={() => setTimerHidden(false)}
            clockIcon={<Clock3 size={11} />}
          />
          <HubShapeCard rail={rail} />
          <HubTargetCard target={session.objective} />
          <HubSourceCard source={source.description} />
        </aside>
      </div>
    </div>
  </div>;
}

/** The handoff's custom bullets: a small blue dot in an 18px column. */
function Bullets({ items }: { items: string[] }) {
  return <ul className={styles.bullets}>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function HonestError({ message, onRetry, onExit }: { message: string | null; onRetry: () => void; onExit: () => void }) {
  return <div className={styles.issue} role="alert">
    <AlertCircle size={18} />
    <div>
      <p>{message ?? SHAPE_SLOT_HONEST_ERROR}</p>
      <div className={styles.actions}>
        <button type="button" className="button secondary" onClick={onRetry}><RotateCcw size={14} /> Try again</button>
        <button type="button" className="button ghost" onClick={onExit}>Exit and add material</button>
      </div>
    </div>
  </div>;
}

function ShapeAStepCard({ step, sourceReadMinutes, repairError, onDraftChange, route, state, restate, why, whyRuleId, direction, learnBlock, learnStatus, learnError, compareStatus, compareError, onRetryStudy, onRetryCompare, onContinue, onSubmitProduce, onSubmitRepair, onSkipRepair, onExit }: {
  step: ShapeAState["steps"][number]["kind"];
  sourceReadMinutes: number;
  repairError: string | null;
  onDraftChange: (draft: ShapeADraft) => void;
  route: SessionRoute;
  why: string;
  whyRuleId: string;
  state: ShapeAState;
  restate: boolean;
  direction: DirectionResponse | null;
  learnBlock: LearnBlockResponse | null;
  learnStatus: SlotStatus;
  learnError: string | null;
  compareStatus: SlotStatus;
  compareError: string | null;
  onRetryStudy: () => void;
  onRetryCompare: () => void;
  onContinue: () => void;
  onSubmitProduce: (produce: ShapeAProduceInput) => void;
  onSubmitRepair: (text: string, produce?: ShapeAProduceInput) => void;
  onSkipRepair: () => void;
  onExit: () => void;
}) {
  const draft = state.draft ?? initialShapeADraft();
  const text = draft.text;
  const repair = draft.repairText;
  const setText = (text: string) => onDraftChange({ ...draft, text });
  const setRepair = (repairText: string) => onDraftChange({ ...draft, repairText });
  const numbered = route.instructionStyle === "numbered_steps";

  if (step === "direct" && route.learnPath === "outside") {
    // Brief 1.5 item 8: the directions card is the whole outside experience.
    const method = CORE_METHOD_CATALOG[route.methodId];
    return <section className={styles.card} data-testid="outside-directions">
      <StepHead>STUDY OUTSIDE YOVA</StepHead>
      <h2>{method.name}</h2>
      <div className={styles.keyPointBlock}><p>{method.what}</p><p className={styles.progressLine} data-rule-id-why={whyRuleId}>{why}</p></div>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Writing your directions…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {direction && <>
        <div><span className={styles.groupLabel}>WHAT TO STUDY</span><p>{direction.whatToLookAt}</p></div>
        <div><span className={styles.groupLabel}>HOW TO APPROACH IT</span><p>{direction.howToApproach}</p></div>
        <div><span className={styles.groupLabel}>SUGGESTED TIME</span><p>{sourceReadMinutes} minutes</p></div>
        {restate && <p className={styles.restated}>Task: study it outside YOVA, then press I&apos;m back.</p>}
        <div className={styles.actions}><button type="button" className="button primary large" onClick={onContinue}>I&apos;m back <ArrowRight size={16} /></button><small>Next: closed-book questions on it.</small></div>
      </>}
    </section>;
  }
  if (step === "direct") {
    return <section className={styles.card}>
      <StepHead>{route.entry === "brief_review" ? "BRIEF REVIEW" : "STUDY YOUR MATERIAL"}</StepHead>
      <h2>{direction?.whatToLookAt ?? "Open your material for this topic."}</h2>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Writing your directions…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {direction && <p>{direction.howToApproach}</p>}
      {restate && <p className={styles.restated}>Task: study the material, then come back and continue.</p>}
      <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>I&apos;m going to study it <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "away") {
    return <section className={styles.card}>
      <StepHead>WHEN YOU ARE BACK</StepHead>
      <h2>Take your time with the material.</h2>
      <p>Nothing is tracked while you are away. Continue when you have studied it.</p>
      {restate && <p className={styles.restated}>Task: come back and press Continue after studying.</p>}
      <div className={styles.actions}><button type="button" className="button primary large" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "explanation") {
    return <section className={styles.card}>
      <StepHead>{route.entry === "brief_review" ? "BRIEF REVIEW" : "READ THE EXPLANATION"}</StepHead>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Writing your explanation and questions…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {learnBlock && <>
        <div className={styles.explanation}>{learnBlock.explanation}</div>
        <div className={styles.keyPointBlock}><strong>Key points</strong><Bullets items={learnBlock.keyPoints.map((keyPoint) => keyPoint.text)} /></div>
        {restate && <p className={styles.restated}>Task: read this once. Next you will {route.produceStep ? produceStepLabel(route.produceStep).toLowerCase() : "continue"} with it hidden.</p>}
        <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
      </>}
    </section>;
  }
  if (step === "worked_structure") {
    // Brief 1.5 item 5: a real example from the explanation or the learner's
    // material, or an honest statement that there is none. Never a repeat of
    // the directions presented as an example.
    const example = learnBlock?.example ?? direction?.example ?? null;
    const settled = learnStatus === "ready";
    return <section className={styles.card} data-testid="baseline-worked-example" data-example-shown={example !== null}>
      <StepHead>{example ? "A WORKED EXAMPLE FIRST" : "BEFORE YOU PRODUCE"}</StepHead>
      {learnStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Writing your example…</p>}
      {learnStatus === "error" && <HonestError message={learnError} onRetry={onRetryStudy} onExit={onExit} />}
      {example && <>
        <h2>{example.title}</h2>
        <p className={styles.progressLine}>{learnBlock?.example ? "From the explanation." : "From your material."}</p>
        <ol className={styles.structure}>{example.steps.map((line, index) => <li key={index}>{line}</li>)}</ol>
      </>}
      {settled && !example && <>
        <h2>No worked example to show for this material.</h2>
        <p>YOVA could not find a worked example in your material, so produce straight from what you studied.</p>
      </>}
      <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (step === "produce") {
    const produceStep = route.produceStep ?? "typed_explanation";
    const label = produceStepLabel(produceStep);
    const problem = learnBlock?.practiceProblem ?? direction?.practiceProblem;
    return <section className={styles.card}>
      <StepHead>PRODUCE · SOURCE HIDDEN</StepHead>
      <h2>{label}</h2>
      {produceStep === "worked_solution" && problem && <p className={styles.keyPointBlock} data-testid="practice-problem">{problem.prompt}</p>}
      {produceStep === "worked_solution" && !problem && learnStatus === "loading" && <p className={styles.loading}>Writing your practice problem…</p>}
      {produceStep === "worked_solution" && !problem && learnStatus !== "loading" && <HonestError message="The concrete problem is unavailable. Your work is saved; retry the task or return to your plan." onRetry={onRetryStudy} onExit={onExit} />}
      {restate && <p className={styles.restated}>Task: {label.toLowerCase()}, without looking at the material.</p>}
      {numbered && <ol className={styles.structure}><li>Close the material.</li><li>{label}.</li><li>Submit it; YOVA names what is missing or wrong.</li></ol>}
      {produceStep === "concept_map" ? <div className={styles.mapGrid}>
        <GuidedConceptMap value={draft.map} onChange={(map) => onDraftChange({ ...draft, map })} />
        <div className={styles.actions}><button type="button" className="button primary" disabled={!conceptMapCanSubmit(draft.map)} onClick={() => onSubmitProduce(conceptMapAsProduce(draft.map))}>Compare my map <ArrowRight size={16} /></button><small>Connect two named concepts with a relationship.</small></div>
      </div> : <>
        <textarea className={styles.textarea} aria-label={label} maxLength={6_000} value={text} placeholder={produceStep === "worked_solution" ? "Work the comparable problem step by step." : produceStep === "outline" ? "Your claim, then the supporting reasons in order." : "Explain it in your own words."} onChange={(event) => setText(event.target.value)} />
        <div className={styles.actions}><button type="button" className="button primary" disabled={!text.trim() || (produceStep === "worked_solution" && !problem)} onClick={() => onSubmitProduce({ kind: produceStep === "outline" || produceStep === "worked_solution" ? produceStep : "typed_explanation", text })}>Compare with the source <ArrowRight size={16} /></button></div>
      </>}
    </section>;
  }
  if (step === "compare") {
    return <section className={styles.card}>
      <StepHead>COMPARE</StepHead>
      <h2>What is missing or wrong</h2>
      {compareStatus === "loading" && <p className={styles.loading}><span className="button-spinner dark" /> Comparing with the source…</p>}
      {compareStatus === "idle" && state.produce && !state.comparison && <div className={styles.actions}><button type="button" className="button primary" onClick={onRetryCompare}>Compare with the source <ArrowRight size={16} /></button><small>Your work was kept while you were away.</small></div>}
      {compareStatus === "error" && <div className={styles.issue} role="alert"><AlertCircle size={18} /><div><p>{compareError ?? SHAPE_SLOT_HONEST_ERROR}</p><div className={styles.actions}><button type="button" className="button secondary" onClick={onRetryCompare}><RotateCcw size={14} /> Try again</button><button type="button" className="button ghost" onClick={onSkipRepair}>Move on without feedback</button></div></div></div>}
      {state.produce?.kind === "concept_map" && state.produce.map && <GuidedConceptMap label="Submitted map" value={state.produce.map} feedback={state.comparison?.itemFeedback} />}
      {state.comparison && <div className={styles.feedback} data-testid="baseline-comparison">
        <p>{state.comparison.feedback}</p>
        {state.comparison.missing.length > 0 && <div><span className={styles.groupLabel}>MISSING</span><ul>{state.comparison.missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        {state.comparison.incorrect.length > 0 && <div><span className={styles.groupLabel}>TO CORRECT</span><ul>{state.comparison.incorrect.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <small>Feedback, not a verdict. Nothing here changes the topic&apos;s status.</small>
      </div>}
      {state.comparison && <div className={styles.actions}><button type="button" className="button primary" onClick={onContinue}>Continue <ArrowRight size={16} /></button></div>}
    </section>;
  }
  if (step === "repair") {
    const gaps = [...(state.comparison?.missing ?? []), ...(state.comparison?.incorrect ?? [])];
    const map = state.produce?.kind === "concept_map" ? draft.repairMap ?? state.produce.map : null;
    const checked = state.repairStatus === "checked";
    const pending = state.repairStatus === "pending";
    const comparison = state.repairComparison;
    return <section className={styles.card}>
      <StepHead>REPAIR · OPTIONAL</StepHead>
      <h2>{checked ? "Your correction was checked." : "Address the named gaps, or move on."}</h2>
      {!checked && (gaps.length > 0 ? <Bullets items={gaps} /> : <p>Nothing was named as missing. You can add anything you want to fix.</p>)}
      {map ? <GuidedConceptMap label={checked ? "Revised map" : "Revise your map"} value={map} onChange={checked || pending ? undefined : (repairMap) => onDraftChange({ ...draft, repairMap })} feedback={checked ? comparison?.itemFeedback : state.comparison?.itemFeedback} />
        : <textarea className={styles.textarea} aria-label="Repair" maxLength={6_000} disabled={checked || pending} value={repair} placeholder="Add or correct the parts named above." onChange={(event) => setRepair(event.target.value)} />}
      {pending && <p className={styles.loading} role="status"><span className="button-spinner dark" /> Checking your correction…</p>}
      {state.repairStatus === "error" && <p className={styles.issue} role="alert">{repairError ?? "Your correction is saved but has not been checked. Retry, or continue with it marked unchecked."}</p>}
      {checked && comparison && <div className={styles.feedback} data-testid="repair-comparison">
        <p>{comparison.feedback}</p>
        {comparison.missing.length > 0 && <><strong>Still missing</strong><Bullets items={comparison.missing} /></>}
        {comparison.incorrect.length > 0 && <><strong>Still to correct</strong><Bullets items={comparison.incorrect} /></>}
        {!comparison.missing.length && !comparison.incorrect.length && <p>No remaining gaps were named in this correction.</p>}
        <small>This feedback does not itself change topic status. You can finish without another correction.</small>
      </div>}
      <details><summary>Original answer and feedback</summary>
        {state.produce?.kind === "concept_map" && state.produce.map ? <GuidedConceptMap label="Original map" value={state.produce.map} feedback={state.comparison?.itemFeedback} /> : <p className={styles.explanation}>{state.produce ? produceAsText(state.produce) : ""}</p>}
        <p>{state.comparison?.feedback}</p>
      </details>
      <div className={styles.actions}>
        {!checked && <button type="button" className="button primary" disabled={pending || (map ? !conceptMapCanSubmit(map) : !repair.trim())} onClick={() => {
          const revised = map ? conceptMapAsProduce(map) : undefined;
          onSubmitRepair(revised ? produceAsText(revised) : repair, revised);
        }}>{state.repairStatus === "error" ? "Retry correction check" : "Check correction"} <ArrowRight size={16} /></button>}
        <button type="button" className={checked ? "button primary" : "button ghost"} disabled={pending} onClick={checked ? onContinue : onSkipRepair}>{checked ? "Continue" : state.repairStatus === "error" ? "Continue unchecked" : "Move on"}</button>
      </div>
    </section>;
  }
  return null;
}

function ComparisonSummary({ state }: { state: ShapeAState }) {
  const comparison = state.repairStatus === "checked" ? state.repairComparison : state.comparison;
  if (!comparison) return null;
  return <div><span>{state.repairStatus === "checked" ? "After correction" : "Original comparison"}</span><strong>{comparison.missing.length === 0 && comparison.incorrect.length === 0 ? "No gaps named" : `${comparison.missing.length} missing · ${comparison.incorrect.length} to correct`}</strong><small>{state.repair && state.repairStatus !== "checked" ? "Your correction remains unchecked" : "Feedback, not a verdict"}</small></div>;
}

function ShapeCCard({ state, route, restate, onAnswer, onNext, onStartNextRound, onRetry, planId, onExit }: {
  state: ShapeCState;
  route: SessionRoute;
  restate: boolean;
  onAnswer: (choiceIndex: number) => void;
  onNext: () => void;
  onStartNextRound: () => void;
  onRetry: () => void;
  planId: string;
  onExit: () => void;
}) {
  const round = currentShapeCRound(state);
  const answer = lastShapeCAnswer(state);
  // While an answer is revealed the card must show the question just
  // answered. currentShapeCQuestion points at the NEXT one, and on a round's
  // last question it points past the end, so reading it here skipped the
  // reveal entirely and blanked the card on the final question.
  const revealed = state.phase === "revealed";
  const pendingQuestion: PracticeQuestion | null = currentShapeCQuestion(state);
  const answered = round?.answers.length ?? 0;
  const shownQuestion = revealed ? round?.questions[answered - 1] ?? null : pendingQuestion;
  if (state.phase === "loading") {
    return <section className={styles.card}><StepHead>CLOSED-BOOK PRACTICE</StepHead><p className={styles.loading}><span className="button-spinner dark" /> Writing your questions…</p></section>;
  }
  if (state.phase === "failed") {
    return <section className={styles.card}><StepHead>CLOSED-BOOK PRACTICE</StepHead><HonestError message={state.error} onRetry={onRetry} onExit={onExit} /></section>;
  }
  if (state.phase === "round_complete") {
    return <section className={styles.card}>
      <StepHead>ROUND {round?.number} COMPLETE</StepHead>
      <h2>{state.outstandingKeyPointIds.length} {state.outstandingKeyPointIds.length === 1 ? "point" : "points"} still to pass.</h2>
      <p>Round {(round?.number ?? 0) + 1} of at most {state.roundCeiling} covers only what was missed, with fresh questions.</p>
      <div className={styles.actions}><button type="button" className="button primary" onClick={onStartNextRound}>Start round {(round?.number ?? 0) + 1} <ArrowRight size={16} /></button></div>
    </section>;
  }
  if (!round || !shownQuestion) return null;
  const shownAnswer = revealed ? answer : null;
  const roundKind = practiceRoundKind(route.firstPracticeRound, round.number);
  return <section className={styles.card} data-testid="baseline-question" data-practice-round={roundKind}>
    <StepHead>ROUND {round.number} · QUESTION {Math.min(revealed ? answered : answered + 1, round.questions.length)} OF {round.questions.length}</StepHead>
    <p className={styles.progressLine} data-question-kind={shownQuestion.kind}>{PRACTICE_ROUND_LABEL[roundKind]} round. {QUESTION_TYPE_LABEL[shownQuestion.kind]} question. No source shown.</p>
    <h2>{shownQuestion.prompt}</h2>
    {restate && !revealed && <p className={styles.restated}>Task: choose one answer.</p>}
    <div className={styles.choices} role="group" aria-label="Answer choices">
      {shownQuestion.choices.map((choice, index) => {
        const isCorrect = index === shownQuestion.correctChoiceIndex;
        const chosen = shownAnswer?.choiceIndex === index;
        const className = [styles.choice, revealed && isCorrect ? styles.choiceCorrect : "", revealed && chosen && !isCorrect ? styles.choiceWrong : ""].join(" ");
        return <button type="button" key={index} className={className} disabled={revealed} aria-pressed={chosen} onClick={() => onAnswer(index)}>
          <span className={styles.choiceKey}>
            {revealed && isCorrect ? <Check size={13} aria-label="Correct answer" /> : revealed && chosen ? <X size={13} aria-label="Your answer" /> : <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>}
          </span>
          <span>{choice}</span>
        </button>;
      })}
    </div>
    {revealed && shownAnswer && <div className={styles.feedback} data-testid="baseline-reveal" data-correct={shownAnswer.correct}>
      <strong>{shownAnswer.correct ? "Correct." : `Not quite. The answer is: ${shownQuestion.choices[shownQuestion.correctChoiceIndex]}`}</strong>
      <p>{shownQuestion.explanation}</p>
      <div className={styles.actions}>
        <button type="button" className="button primary" onClick={onNext}>{answered < round.questions.length ? "Next question" : "Finish round"} <ArrowRight size={16} /></button>
        {!shownAnswer.correct && <AskYova key={shownQuestion.id} planId={planId} question={`Why is "${shownQuestion.choices[shownQuestion.correctChoiceIndex]}" the right answer to: ${shownQuestion.prompt}`} idleLabel="Ask YOVA" buttonClassName="button ghost" answerClassName={styles.feedback} />}
      </div>
    </div>}
  </section>;
}

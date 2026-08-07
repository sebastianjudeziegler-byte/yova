"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Atom,
  BadgeDollarSign,
  BookOpen,
  BookMarked,
  CalendarDays,
  Calculator,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Code2,
  Dna,
  FileText,
  FlaskConical,
  Globe2,
  History,
  Home,
  Landmark,
  LibraryBig,
  LogOut,
  Mail,
  MessageCircleMore,
  MessageSquarePlus,
  Microscope,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LearningContent } from "@/components/learning-content";
import { MaterialLinkImporter } from "@/components/material-link-importer";
import { PlanCreator } from "@/components/plan-creator";
import { QuantitativeWorkpad } from "@/components/quantitative-workpad";
import { StudyNowCreator } from "@/components/study-now-creator";
import { TutorMessageContent } from "@/components/tutor-message-content";
import { trackProductEvent } from "@/lib/analytics/client";
import { describeAuthCallbackResult } from "@/lib/auth/callback-result";
import { AuthConnectionError, getAuthenticatedAccount, getAuthMode, requestEmailAuthentication, signOutAuthenticatedAccount, verifyEmailAuthenticationCode } from "@/lib/auth/client";
import { isCompleteEmailVerificationCode, normalizeEmailVerificationCode } from "@/lib/auth/verification-code";
import {
  makeId,
  makeUuid,
  type ConfidenceEvidence,
  type ConfidenceLevel,
  type LearningMaterial,
  type LearningPlan,
  type LearningPlanSession,
  type PreviewAccount,
  type SessionCompletion,
  type SessionCoverage,
  type SessionEvidenceSnapshot,
  type SessionInterruption,
  type SessionMethodBriefing,
  type SessionResource,
  type SessionResourceActivity,
  type SessionSourceGrounding,
} from "@/lib/domain";
import { summarizeConceptEvidence, type ConceptSignal } from "@/lib/learning/concept-evidence";
import {
  buildConceptReviewAgenda,
  buildConceptReviewSession,
  type ConceptReviewAgendaItem,
} from "@/lib/learning/concept-review-agenda";
import { buildConceptReviewSchedule } from "@/lib/learning/concept-review-scheduler";
import { confidenceResultMessage, summarizeConfidenceCalibration } from "@/lib/learning/confidence-calibration";
import { buildDelayedVerificationSession } from "@/lib/learning/delayed-verification";
import type { MethodPhase } from "@/lib/learning/method-fidelity";
import {
  buildMethodPhaseRoadmap,
  getMethodPhasePresentation,
  methodPhasePosition,
} from "@/lib/learning/method-phase-presentation";
import { buildFallbackMethodBriefing } from "@/lib/learning/fallback-method-briefing";
import {
  buildScaffoldProgressionSignals,
  buildSessionSupportPlan,
  type SessionSupportPlan,
} from "@/lib/learning/scaffold-progression";
import {
  buildImmediateRepairAfterMiss,
  mergeSessionEvidenceSummaries,
  summarizeCompletionConcepts,
  summarizeSessionEvidence,
  type GuidedSessionStep,
} from "@/lib/learning/session-evidence";
import { shouldRequestConfidence } from "@/lib/learning/session-interaction";
import { restoreInterruptedLesson, resumableSessionProgress } from "@/lib/learning/session-resume";
import { selectFreeResponseMode } from "@/lib/learning/response-mode";
import { clearPreviewSnapshot, loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";
import { buildPlanProfileSummary } from "@/lib/personalization/profile-summary";
import { createSessionAdaptationNote } from "@/lib/personalization/adaptation-note";
import { buildNextSessionAdaptation } from "@/lib/personalization/session-adaptation";
import { buildMethodSignals, type MethodSignal } from "@/lib/personalization/method-signals";
import {
  DEEP_PROFILE_QUESTIONS,
  FREEFORM_LEARNING_CONTEXT_INDEX,
  OBSERVATION_CORRECTION_INDEX,
  deepProfileAnswerCount,
} from "@/lib/personalization/learner-profile";
import {
  buildPersonalizationRecommendations,
  type PersonalizationRecommendation,
} from "@/lib/personalization/recommendations";
import { buildSessionDecisionSignals } from "@/lib/personalization/session-decision";
import { reportProductError } from "@/lib/monitoring/client";
import { onboardingQuestions } from "@/lib/sample-data";
import { PlanAdjustmentResponseSchema, type PlanAdjustmentRequest } from "@/lib/learning/adjustment-schema";
import { buildContentBasedReplacementSessions } from "@/lib/learning/content-based-plan-adjustment";
import { PlanArchiveResponseSchema } from "@/lib/learning/status-schema";
import { MaterialAttachmentResponseSchema } from "@/lib/materials/attachment-schema";
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import {
  activateAuthenticatedConceptReviewSession,
  completeAuthenticatedPlanSession,
  loadAuthenticatedLearningState,
  recordAuthenticatedSessionInterruption,
  saveAuthenticatedLearnerProfile,
} from "@/lib/supabase/learning-state-repository";
import {
  SessionGenerationResponseSchema,
  type SessionAdjustment,
} from "@/lib/session-generation/schema";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";
import { toSessionResource } from "@/lib/session-generation/resource";
import { polishActivityLabel } from "@/lib/session-generation/typography";
import {
  AnswerEvaluationResponseSchema,
  type AnswerEvaluationResponse,
} from "@/lib/session-evaluation/schema";
import { RescheduleSessionResponseSchema } from "@/lib/scheduling/schema";
import {
  buildAgendaBalanceSuggestion,
  buildAgendaDayGroups,
  buildDailyCapacityPlan,
  localDateKey,
  summarizeAgenda,
} from "@/lib/scheduling/agenda-insights";
import { isSessionOverdue, recoverySessionMinutes, tomorrowAtSessionTime } from "@/lib/scheduling/recovery";
import {
  applyAdvancedSchedule,
  buildAdvancedSchedule,
  isSessionAheadOfSchedule,
} from "@/lib/scheduling/advance";
import {
  clearQueuedSessionCompletions,
  flushQueuedSessionCompletions,
  queueSessionCompletion,
  removeQueuedSessionCompletion,
} from "@/lib/sync/session-completion-outbox";
import {
  clearQueuedSessionInterruptions,
  flushQueuedSessionInterruptions,
  queueSessionInterruption,
  removeQueuedSessionInterruption,
} from "@/lib/sync/session-interruption-outbox";
import {
  TutorHistoryResponseSchema,
  TutorResponseSchema,
  TutorThreadListResponseSchema,
  type TutorMessage,
  type TutorProposedAction,
  type TutorRequest,
  type TutorThreadSummary,
} from "@/lib/tutor/schema";

type Stage = "landing" | "account" | "onboarding-intro" | "onboarding" | "profile" | "paywall" | "app" | "plan-creator" | "study-now" | "session-setup" | "session-loading" | "session-error" | "session" | "complete";
type Tab = "Home" | "Learning" | "Agenda" | "Ask YOVA" | "You";
type AccountMode = "create" | "sign-in";
type LessonStep = GuidedSessionStep;
type AgendaEntry = { plan: LearningPlan; session: LearningPlanSession };

const navItems: Array<{ label: Tab; icon: typeof Home }> = [
  { label: "Home", icon: Home },
  { label: "Learning", icon: LibraryBig },
  { label: "Agenda", icon: CalendarDays },
  { label: "Ask YOVA", icon: MessageCircleMore },
  { label: "You", icon: CircleUserRound },
];

export function YovaPrototype({ emailCodeVerificationEnabled = false }: { emailCodeVerificationEnabled?: boolean }) {
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<Stage>("landing");
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [accountMode, setAccountMode] = useState<AccountMode>("create");
  const [account, setAccount] = useState<PreviewAccount | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [alphaEntered, setAlphaEntered] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [plans, setPlans] = useState<LearningPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [learningDetailPlanId, setLearningDetailPlanId] = useState<string | null>(null);
  const [sessionCompletions, setSessionCompletions] = useState<SessionCompletion[]>([]);
  const [sessionInterruptions, setSessionInterruptions] = useState<SessionInterruption[]>([]);
  const [sessionStep, setSessionStep] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [sessionOutcomes, setSessionOutcomes] = useState<Record<number, boolean>>({});
  const [sessionConfidence, setSessionConfidence] = useState<Record<number, ConfidenceLevel>>({});
  const [resumedSessionEvidence, setResumedSessionEvidence] = useState<SessionEvidenceSnapshot | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [generatedLessonSteps, setGeneratedLessonSteps] = useState<LessonStep[] | null>(null);
  const [sessionRationale, setSessionRationale] = useState<string | null>(null);
  const [sessionMethodBriefing, setSessionMethodBriefing] = useState<SessionMethodBriefing | null>(null);
  const [sessionCoverage, setSessionCoverage] = useState<SessionCoverage | null>(null);
  const [sessionSupportPlan, setSessionSupportPlan] = useState<SessionSupportPlan | null>(null);
  const [sessionSourceGrounding, setSessionSourceGrounding] = useState<SessionSourceGrounding | null>(null);
  const [sessionGenerationIssue, setSessionGenerationIssue] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionCompletedAt, setSessionCompletedAt] = useState<string | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [sessionCapacityMinutes, setSessionCapacityMinutes] = useState<number | null>(null);
  const [cloudSyncIssue, setCloudSyncIssue] = useState<string | null>(null);
  const [authStartupIssue, setAuthStartupIssue] = useState<string | null>(null);
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
  const [browserPreviewMode, setBrowserPreviewMode] = useState(false);
  const [tutorQuestion, setTutorQuestion] = useState("");
  const [tutorEntryKey, setTutorEntryKey] = useState(0);
  const [pendingSessionPlan, setPendingSessionPlan] = useState<LearningPlan | null>(null);
  const [earlySessionPlanId, setEarlySessionPlanId] = useState<string | null>(null);
  const [earlySchedulePending, setEarlySchedulePending] = useState(false);
  const [earlyScheduleIssue, setEarlyScheduleIssue] = useState<string | null>(null);
  const sessionGenerationAbortRef = useRef<AbortController | null>(null);
  const analyticsEnabled = account?.identityMode === "supabase";

  const activePlans = plans.filter((plan) => plan.status === "active");
  const activePlan = activePlans.find((plan) => plan.id === selectedPlanId) ?? activePlans[activePlans.length - 1] ?? null;
  const recommendedPlan = chooseRecommendedPlan(activePlans);
  const earlySessionPlan = earlySessionPlanId
    ? activePlans.find((plan) => plan.id === earlySessionPlanId) ?? null
    : null;
  const earlySession = earlySessionPlan?.sessions.find((session) => session.status === "ready") ?? null;
  const activeLessonSteps = generatedLessonSteps ?? lessonStepsFor(activePlan);
  const sessionEvidence = mergeSessionEvidenceSummaries(
    resumedSessionEvidence,
    summarizeSessionEvidence(activeLessonSteps, sessionOutcomes, sessionConfidence),
  );
  const capturedSessionSeconds = Math.max(1, sessionElapsedSeconds);
  const capturedSessionMinutes = Math.max(1, Math.ceil(capturedSessionSeconds / 60));

  const openAskYova = () => {
    setTutorEntryKey((value) => value + 1);
    setActiveTab("Ask YOVA");
  };

  const openTab = (tab: Tab) => {
    if (tab === "Learning") setLearningDetailPlanId(null);
    if (tab === "Ask YOVA" && activeTab !== "Ask YOVA") {
      setTutorEntryKey((value) => value + 1);
      if (activeTab !== "Home") setTutorQuestion("");
    }
    setActiveTab(tab);
  };

  useEffect(() => {
    let cancelled = false;

    async function openYova() {
      const callbackIssue = consumeAuthCallbackIssue();
      if (callbackIssue) setAuthStartupIssue(callbackIssue);
      const saved = loadPreviewSnapshot();
      const localPreviewMode = process.env.NODE_ENV === "development"
        && new URLSearchParams(window.location.search).get("qa") === "preview";
      setBrowserPreviewMode(localPreviewMode);
      const authMode = localPreviewMode ? "preview" : getAuthMode();
      if (saved && authMode === "preview") {
        setAccount(saved.account);
        setSignedIn(saved.signedIn);
        setAnswers(saved.onboardingAnswers);
        setOnboardingCompleted(saved.onboardingCompleted);
        setAlphaEntered(saved.alphaEntered);
        setPlans(saved.plans);
        setSelectedPlanId(saved.plans.filter((plan) => plan.status === "active").at(-1)?.id ?? null);
        setSessionCompletions(saved.sessionCompletions);
        setSessionInterruptions(saved.sessionInterruptions);
      }

      let cloudAccount: PreviewAccount | null = null;
      if (!localPreviewMode) {
        try {
          cloudAccount = await getAuthenticatedAccount();
        } catch (error) {
          if (cancelled) return;
          setAuthStartupIssue(error instanceof AuthConnectionError
            ? error.message
            : "YOVA could not check your account securely. Try again in a moment.");
          setStage("landing");
          setReady(true);
          return;
        }
      }
      if (cancelled) return;

      if (cloudAccount) {
        setAuthStartupIssue(null);
        const localAccountMatches = saved?.account?.id === cloudAccount.id;

        try {
          const retryResult = await flushQueuedSessionCompletions(cloudAccount.id);
          const interruptionRetryResult = await flushQueuedSessionInterruptions(cloudAccount.id);
          const cloudState = await loadAuthenticatedLearningState();
          if (cancelled) return;

          const restoredAccount = cloudState?.displayName
            ? { ...cloudAccount, displayName: cloudState.displayName }
            : cloudAccount;
          const cloudPlans = cloudState?.plans ?? [];
          const cloudOnboardingCompleted = cloudState?.onboardingCompleted ?? false;
          const restoredAlphaEntered = localAccountMatches ? Boolean(saved?.alphaEntered) : false;

          setAccount(restoredAccount);
          setSignedIn(true);
          setAnswers(cloudState?.onboardingAnswers ?? []);
          setOnboardingCompleted(cloudOnboardingCompleted);
          setAlphaEntered(restoredAlphaEntered);
          setPlans(cloudPlans);
          setSelectedPlanId(cloudPlans.filter((plan) => plan.status === "active").at(-1)?.id ?? null);
          setSessionCompletions(cloudState?.sessionCompletions ?? []);
          setSessionInterruptions(cloudState?.sessionInterruptions ?? []);
          const pendingEvents = retryResult.remaining + interruptionRetryResult.remaining;
          setCloudSyncIssue(pendingEvents > 0
            ? `${pendingEvents} session ${pendingEvents === 1 ? "event is" : "events are"} waiting to sync.`
            : null);

          if (cloudPlans.some((plan) => plan.status === "active")) setStage("app");
          else if (cloudOnboardingCompleted && restoredAlphaEntered) setStage("app");
          else if (cloudOnboardingCompleted) setStage("paywall");
          else setStage("onboarding-intro");
        } catch (error) {
          reportProductError({ surface: "cloud_sync", errorCode: "cloud_state_load_failed" });
          setAccount(cloudAccount);
          setSignedIn(true);
          setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not load your cloud data.");

          if (localAccountMatches && saved) {
            setAnswers(saved.onboardingAnswers);
            setOnboardingCompleted(saved.onboardingCompleted);
            setAlphaEntered(saved.alphaEntered);
            setPlans(saved.plans);
            setSelectedPlanId(saved.plans.filter((plan) => plan.status === "active").at(-1)?.id ?? null);
            setSessionCompletions(saved.sessionCompletions);
            setSessionInterruptions(saved.sessionInterruptions);
            if (saved.alphaEntered) setStage("app");
            else if (saved.onboardingCompleted) setStage("paywall");
            else setStage("onboarding-intro");
          } else {
            setAnswers([]);
            setOnboardingCompleted(false);
            setAlphaEntered(false);
            setPlans([]);
            setSelectedPlanId(null);
            setSessionCompletions([]);
            setSessionInterruptions([]);
            setStage("onboarding-intro");
          }
        }
      } else if (saved?.signedIn && saved.account && authMode === "preview") {
        if (saved.alphaEntered) setStage("app");
        else if (saved.onboardingCompleted) setStage("paywall");
        else setStage("onboarding-intro");
      } else if (authMode === "supabase") {
        clearPreviewSnapshot();
        setAccount(null);
        setSignedIn(false);
        setAnswers([]);
        setOnboardingCompleted(false);
        setAlphaEntered(false);
        setPlans([]);
        setSelectedPlanId(null);
        setLearningDetailPlanId(null);
        setSessionCompletions([]);
        setSessionInterruptions([]);
        setStage("landing");
      }

      setReady(true);
    }

    void openYova();
    return () => { cancelled = true; };
  }, [authCheckAttempt]);

  useEffect(() => {
    if (!ready || !account || !signedIn) return;
    savePreviewSnapshot({
      version: 1,
      account,
      signedIn,
      onboardingAnswers: answers,
      onboardingCompleted,
      alphaEntered,
      plans,
      sessionCompletions,
      sessionInterruptions,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, account, signedIn, answers, onboardingCompleted, alphaEntered, plans, sessionCompletions, sessionInterruptions]);

  useEffect(() => {
    if (account?.identityMode !== "supabase") return;

    const retryQueuedWork = () => {
      void syncPendingCloudWork(account, answers, onboardingCompleted).then(setCloudSyncIssue);
    };

    window.addEventListener("online", retryQueuedWork);
    return () => window.removeEventListener("online", retryQueuedWork);
  }, [account, answers, onboardingCompleted]);

  useEffect(() => {
    if (!ready || !onboardingCompleted || account?.identityMode !== "supabase") return;
    let cancelled = false;

    void saveAuthenticatedLearnerProfile({
      displayName: account.displayName,
      onboardingAnswers: answers,
    }).then(() => {
      if (!cancelled) setCloudSyncIssue(null);
    }).catch((error: unknown) => {
      if (!cancelled) {
        reportProductError({ surface: "cloud_sync", errorCode: "learner_profile_sync_failed" });
        setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not sync your learning profile.");
      }
    });

    return () => { cancelled = true; };
  }, [ready, onboardingCompleted, account, answers]);

  useEffect(() => {
    if (stage !== "session" || sessionStartedAt === null) return;

    const updateElapsedTime = () => {
      setSessionElapsedSeconds(Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1_000)));
    };
    updateElapsedTime();
    const intervalId = window.setInterval(updateElapsedTime, 1_000);
    return () => window.clearInterval(intervalId);
  }, [stage, sessionStartedAt]);

  const beginTimedSession = (plan: LearningPlan, resumed: boolean) => {
    trackProductEvent({
      eventName: "session_started",
      context: {
        sourceMode: plan.sourceMode,
        studyMode: plan.studyMode,
        learningApproach: plan.learningIntent,
        resumed,
      },
    }, analyticsEnabled);
    setSessionStartedAt(new Date().getTime());
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setStage("session");
  };

  const startSession = async (
    planId?: string,
    planOverride?: LearningPlan,
    adjustment?: SessionAdjustment | null,
  ) => {
    const requestedPlan = planOverride ?? activePlans.find((plan) => plan.id === planId) ?? activePlan;
    if (!requestedPlan) return;

    const requestedSession = requestedPlan.sessions.find((session) => session.status === "ready");
    if (!requestedSession) return;
    const resumePoint = resumableSessionProgress(requestedSession.id, sessionInterruptions);

    if (!resumePoint && adjustment === undefined) {
      setSelectedPlanId(requestedPlan.id);
      setPendingSessionPlan(requestedPlan);
      setStage("session-setup");
      return;
    }

    setSelectedPlanId(requestedPlan.id);
    setPendingSessionPlan(null);
    setSessionStep(0);
    setSelectedAnswer(null);
    setSessionOutcomes({});
    setSessionConfidence({});
    setResumedSessionEvidence(resumePoint?.evidence ?? null);
    setAnswerRevealed(false);
    setGeneratedLessonSteps(null);
    setSessionRationale(null);
    setSessionMethodBriefing(null);
    setSessionCoverage(null);
    setSessionSupportPlan(null);
    setSessionSourceGrounding(null);
    setSessionGenerationIssue(null);
    setSessionStartedAt(null);
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setSessionCapacityMinutes(adjustment?.availableMinutes ?? requestedSession.estimatedMinutes);
    setStage("session-loading");
    sessionGenerationAbortRef.current?.abort();
    const generationController = new AbortController();
    sessionGenerationAbortRef.current = generationController;
    let requestId: string | null = null;

    try {
      const response = await fetch("/api/sessions/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "guided-session" } : {}),
        },
        body: JSON.stringify({
          planId: requestedPlan.id,
          planSessionId: requestedSession.id,
          ...(adjustment ? { sessionAdjustment: adjustment } : {}),
          ...(account?.identityMode === "preview" ? {
            previewContext: buildPreviewSessionContext({
              plan: requestedPlan,
              session: requestedSession,
              onboardingAnswers: answers,
              completions: sessionCompletions,
              interruptions: sessionInterruptions,
            }),
          } : {}),
        }),
        signal: generationController.signal,
      });
      requestId = response.headers.get("X-Yova-Request-Id");
      const generationLatencyMs = readBoundedIntegerHeader(response, "X-Yova-Generation-Ms", 180_000);
      const generationAttempts = readBoundedIntegerHeader(response, "X-Yova-Generation-Attempts", 2);
      const promptCacheHit = response.headers.get("X-Yova-Prompt-Cache-Hit") === "true";
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not generate this guided session.";
        throw new Error(message);
      }

      const parsed = SessionGenerationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The generated session came back in an unsafe format.");
      trackProductEvent({
        eventName: "session_generated",
        context: {
          mode: parsed.data.generation.mode,
          latencyMs: generationLatencyMs,
          attempts: generationAttempts,
          promptCacheHit,
        },
      }, analyticsEnabled);

      const nextLessonSteps = parsed.data.session.activities.map((activity) => ({
        methodPhase: activity.methodPhase,
        estimatedMinutes: activity.estimatedMinutes,
        requiredForCompletion: activity.requiredForCompletion,
        type: activity.type,
        concept: activity.concept,
        label: activity.label,
        title: activity.title,
        body: activity.body,
        teaching: activity.teaching,
        question: activity.type === "multiple_choice" ? activity.choices : null,
        correctAnswer: activity.correctAnswer,
        feedback: activity.feedback,
      }));
      const supportPlan = parsed.data.session.supportPlan ?? buildSessionSupportPlan({
        signals: buildScaffoldProgressionSignals(
          sessionCompletions.filter((completion) => completion.planId === requestedPlan.id),
        ),
        activities: parsed.data.session.activities,
        learningMode: parsed.data.session.methodBriefing.learningMode,
      });
      const reusableResource = { ...toSessionResource(parsed.data.session), supportPlan };
      setPlans((current) => current.map((plan) => plan.id !== requestedPlan.id ? plan : {
        ...plan,
        sessions: plan.sessions.map((session) => session.id === requestedSession.id
          ? { ...session, resource: reusableResource }
          : session),
      }));
      const restoredLesson = restoreInterruptedLesson(nextLessonSteps, resumePoint);
      setGeneratedLessonSteps(restoredLesson.steps);
      setSessionStep(restoredLesson.step);
      setSessionRationale(parsed.data.session.rationale);
      setSessionCoverage(parsed.data.session.coverage);
      setSessionMethodBriefing(parsed.data.session.methodBriefing);
      setSessionSupportPlan(supportPlan);
      setSessionSourceGrounding(parsed.data.session.sourceGrounding);
      if (parsed.data.generation.persistence === "browser" && account?.identityMode === "supabase") {
        setSessionGenerationIssue("This session is ready, but YOVA could not cache it in your cloud account.");
      }
      beginTimedSession(requestedPlan, Boolean(resumePoint));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      reportProductError({
        surface: "session_generation",
        errorCode: "guided_session_generation_failed",
        requestId,
      });
      const message = error instanceof Error ? error.message : "YOVA could not generate this session.";
      const fallbackSteps = account?.identityMode === "preview"
        ? subjectSpecificLessonStepsFor(requestedPlan)
        : null;
      if (!fallbackSteps) {
        setSessionGenerationIssue(`${message} YOVA stopped instead of substituting generic content for ${requestedPlan.topic}.`);
        setStage("session-error");
        return;
      }
      const fallbackSupportPlan = buildSessionSupportPlan({
        signals: buildScaffoldProgressionSignals(
          sessionCompletions.filter((completion) => completion.planId === requestedPlan.id),
        ),
        activities: fallbackSteps.map((step) => ({
          methodPhase: step.methodPhase ?? "orient",
          type: step.type,
          concept: step.concept,
        })),
        learningMode: requestedSession.learningMode,
      });
      const fallbackCoverage = fallbackCoverageFor(requestedSession, fallbackSteps);
      const fallbackMethodBriefing = buildFallbackMethodBriefing(requestedPlan, requestedSession);
      const fallbackResource = {
        ...reusableResourceFromLessonSteps(fallbackSteps, requestedSession.methodReason),
        coverage: fallbackCoverage,
        methodBriefing: fallbackMethodBriefing,
        supportPlan: fallbackSupportPlan,
      };
      setPlans((current) => current.map((plan) => plan.id !== requestedPlan.id ? plan : {
        ...plan,
        sessions: plan.sessions.map((session) => session.id === requestedSession.id
          ? { ...session, resource: fallbackResource }
          : session),
      }));
      const restoredLesson = restoreInterruptedLesson(fallbackSteps, resumePoint);
      setGeneratedLessonSteps(restoredLesson.steps);
      setSessionStep(restoredLesson.step);
      setSessionRationale(requestedSession.methodReason);
      setSessionCoverage(fallbackCoverage);
      setSessionMethodBriefing(fallbackMethodBriefing);
      setSessionSupportPlan(fallbackSupportPlan);
      setSessionSourceGrounding(null);
      setSessionGenerationIssue(`${message} A safe built-in session was loaded instead.`);
      beginTimedSession(requestedPlan, Boolean(resumePoint));
    } finally {
      if (sessionGenerationAbortRef.current === generationController) {
        sessionGenerationAbortRef.current = null;
      }
    }
  };

  const requestSessionStart = (planId?: string) => {
    const requestedPlan = activePlans.find((plan) => plan.id === planId) ?? activePlan;
    const requestedSession = requestedPlan?.sessions.find((session) => session.status === "ready");
    if (!requestedPlan || !requestedSession) return;
    const resumePoint = resumableSessionProgress(requestedSession.id, sessionInterruptions);
    if (!resumePoint && isSessionAheadOfSchedule(requestedSession)) {
      setEarlySessionPlanId(requestedPlan.id);
      setEarlyScheduleIssue(null);
      return;
    }
    void startSession(requestedPlan.id);
  };

  const startEarlySession = async (shiftRemainingPlan: boolean) => {
    const requestedPlan = activePlans.find((plan) => plan.id === earlySessionPlanId);
    if (!requestedPlan || earlySchedulePending) return;

    if (!shiftRemainingPlan) {
      setEarlySessionPlanId(null);
      setEarlyScheduleIssue(null);
      await startSession(requestedPlan.id);
      return;
    }

    setEarlySchedulePending(true);
    setEarlyScheduleIssue(null);
    try {
      const updates = buildAdvancedSchedule(requestedPlan);
      if (account?.identityMode === "supabase") {
        await Promise.all(updates.map(async (update) => {
          const response = await fetch("/api/sessions/schedule", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              planSessionId: update.planSessionId,
              scheduledFor: update.scheduledFor,
            }),
          });
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
              ? body.error
              : "YOVA could not move the remaining agenda.";
            throw new Error(message);
          }
          if (!RescheduleSessionResponseSchema.safeParse(body).success) {
            throw new Error("YOVA changed a date but could not safely confirm it.");
          }
        }));
      }
      const advancedPlan = applyAdvancedSchedule(requestedPlan, updates);
      setPlans((current) => current.map((plan) => plan.id === advancedPlan.id ? advancedPlan : plan));
      setEarlySessionPlanId(null);
      await startSession(advancedPlan.id, advancedPlan);
    } catch (error) {
      setEarlyScheduleIssue(error instanceof Error ? error.message : "YOVA could not pull the plan forward.");
    } finally {
      setEarlySchedulePending(false);
    }
  };

  const activateConceptReview = async (item: ConceptReviewAgendaItem) => {
    const plan = plans.find((candidate) => candidate.id === item.planId);
    if (!plan) throw new Error("YOVA could not find the learning goal for this review.");

    if (item.action === "start_next_session") {
      await startSession(plan.id);
      return;
    }
    if (item.action !== "activate_review") return;

    const reviewSession = buildConceptReviewSession(plan, item);
    if (account?.identityMode === "supabase") {
      await activateAuthenticatedConceptReviewSession(plan.id, reviewSession);
    }

    const activatedPlan: LearningPlan = {
      ...plan,
      status: "active",
      sessions: [...plan.sessions, reviewSession],
    };
    setPlans((current) => current.map((candidate) => candidate.id === plan.id ? activatedPlan : candidate));
    setSelectedPlanId(plan.id);
    await startSession(plan.id, activatedPlan);
  };

  const completeActiveSession = (correctAnswers: number, totalAnswers: number, feedback: SessionCompletion["feedback"], actualMinutes: number) => {
    if (!activePlan) return;
    const currentSession = activePlan.sessions.find((session) => session.status === "ready");
    if (!currentSession) return;

    const completion: SessionCompletion = {
      id: makeUuid(),
      planId: activePlan.id,
      planSessionId: currentSession.id,
      startedAt: new Date(sessionStartedAt ?? new Date().getTime()).toISOString(),
      completedAt: sessionCompletedAt ?? new Date().toISOString(),
      plannedMinutes: sessionCapacityMinutes ?? currentSession.estimatedMinutes,
      actualMinutes,
      correctAnswers,
      totalAnswers,
      feedback,
      observedGap: sessionEvidence.observedGap,
      conceptEvidence: sessionEvidence.conceptEvidence,
      confidenceEvidence: sessionEvidence.confidenceEvidence,
    };
    const nextSession = activePlan.sessions.find((session) => session.sequence === currentSession.sequence + 1) ?? null;
    const adaptation = buildNextSessionAdaptation(nextSession, completion);
    const delayedVerification = nextSession
      ? null
      : buildDelayedVerificationSession(currentSession, completion);

    trackProductEvent({
      eventName: "session_completed",
      context: {
        plannedMinutes: completion.plannedMinutes,
        actualMinutes: completion.actualMinutes,
        correctAnswers: completion.correctAnswers,
        totalAnswers: completion.totalAnswers,
        feedback: completion.feedback,
        adaptedNextSession: adaptation !== null || delayedVerification !== null,
        calibrationPattern: summarizeConfidenceCalibration(completion.confidenceEvidence).pattern,
      },
    }, analyticsEnabled);

    setPlans((currentPlans) => currentPlans.map((plan) => {
      if (plan.id !== activePlan.id) return plan;
      const nextSequence = currentSession.sequence + 1;
      const updatedSessions = plan.sessions.map((session) => {
        if (session.id === currentSession.id) return { ...session, status: "complete" as const };
        if (session.sequence === nextSequence && session.status === "upcoming") {
          return adaptation?.planSessionId === session.id
            ? {
              ...session,
              title: adaptation.title,
              objective: adaptation.objective,
              method: adaptation.method,
              methodReason: adaptation.methodReason,
              estimatedMinutes: adaptation.estimatedMinutes,
              amountLabel: adaptation.amountLabel,
              learningMode: adaptation.learningMode,
              resource: undefined,
              adaptationNote: createSessionAdaptationNote(adaptation.explanation, completion.completedAt),
              status: "ready" as const,
            }
            : { ...session, status: "ready" as const };
        }
        return session;
      });
      const sessionsWithVerification = delayedVerification
        ? [...updatedSessions, delayedVerification]
        : updatedSessions;
      return {
        ...plan,
        status: sessionsWithVerification.some((session) => session.status === "ready" || session.status === "upcoming")
          ? plan.status
          : "completed",
        sessions: sessionsWithVerification,
      };
    }));

    setSessionCompletions((current) => [...current, completion]);

    if (account?.identityMode === "supabase") {
      queueSessionCompletion({
        userId: account.id,
        completion,
        adaptation,
        followUpSession: delayedVerification,
        queuedAt: new Date().toISOString(),
      });
      void completeAuthenticatedPlanSession(completion, adaptation, delayedVerification)
        .then(() => {
          removeQueuedSessionCompletion(completion.id);
          setCloudSyncIssue(null);
        })
        .catch((error: unknown) => {
          reportProductError({ surface: "session_completion", errorCode: "session_completion_sync_failed" });
          setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not sync this session.");
        });
    }
  };

  const interruptActiveSession = () => {
    if (!activePlan || sessionStartedAt === null) {
      setStage("app");
      return;
    }
    const currentSession = activePlan.sessions.find((session) => session.status === "ready");
    if (!currentSession) {
      setStage("app");
      return;
    }

    const interruptedAt = new Date();
    const actualMinutes = Math.max(1, Math.ceil((interruptedAt.getTime() - sessionStartedAt) / 60_000));
    const completedLessonSteps = activeLessonSteps.slice(0, sessionStep);
    const interruptionEvidence = mergeSessionEvidenceSummaries(
      resumedSessionEvidence,
      summarizeSessionEvidence(completedLessonSteps, sessionOutcomes, sessionConfidence),
    );
    const resumeStep = completedLessonSteps.filter((step) => step.evidenceRole !== "immediate_repair").length;
    const currentStep = activeLessonSteps[sessionStep];
    const pendingRepair = currentStep?.evidenceRole === "immediate_repair"
      && currentStep.concept
      && currentStep.correctAnswer
      ? {
        concept: currentStep.concept,
        title: currentStep.title,
        body: currentStep.body,
        correctAnswer: currentStep.correctAnswer,
        feedback: currentStep.feedback,
      }
      : undefined;
    const interruption: SessionInterruption = {
      id: makeUuid(),
      planId: activePlan.id,
      planSessionId: currentSession.id,
      startedAt: new Date(sessionStartedAt).toISOString(),
      interruptedAt: interruptedAt.toISOString(),
      plannedMinutes: sessionCapacityMinutes ?? currentSession.estimatedMinutes,
      actualMinutes,
      completedSteps: Math.min(sessionStep, activeLessonSteps.length),
      totalSteps: activeLessonSteps.length,
      resumeStep,
      evidence: interruptionEvidence,
      pendingRepair,
    };

    trackProductEvent({
      eventName: "session_interrupted",
      context: {
        actualMinutes: interruption.actualMinutes,
        completedSteps: interruption.completedSteps,
        totalSteps: interruption.totalSteps,
      },
    }, analyticsEnabled);

    setSessionInterruptions((current) => [...current, interruption]);
    setSessionStartedAt(null);
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setResumedSessionEvidence(null);
    setStage("app");
    setActiveTab("Home");

    if (account?.identityMode === "supabase") {
      queueSessionInterruption({
        userId: account.id,
        interruption,
        queuedAt: interruptedAt.toISOString(),
      });
      void recordAuthenticatedSessionInterruption(interruption)
        .then(() => {
          removeQueuedSessionInterruption(interruption.id);
          setCloudSyncIssue(null);
        })
        .catch((error: unknown) => {
          reportProductError({ surface: "session_completion", errorCode: "session_interruption_sync_failed" });
          setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not sync the interrupted session.");
        });
    }
  };

  const resetYovaData = async () => {
    const isCloudAccount = account?.identityMode === "supabase";
    if (isCloudAccount) {
      const response = await fetch("/api/account/learning-data", {
        method: "DELETE",
        headers: { "X-Yova-Confirm": "reset-learning-data" },
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not reset your cloud learning data.";
        throw new Error(message);
      }
      clearQueuedSessionCompletions(account.id);
      clearQueuedSessionInterruptions(account.id);
    }
    clearPreviewSnapshot();
    setOnboardingCompleted(false);
    setAlphaEntered(false);
    setQuestionIndex(0);
    setAnswers([]);
    setPlans([]);
    setSelectedPlanId(null);
    setSessionCompletions([]);
    setSessionInterruptions([]);
    setSessionStep(0);
    setSelectedAnswer(null);
    setSessionOutcomes({});
    setSessionConfidence({});
    setResumedSessionEvidence(null);
    setAnswerRevealed(false);
    setGeneratedLessonSteps(null);
    setSessionRationale(null);
    setSessionSupportPlan(null);
    setSessionGenerationIssue(null);
    setSessionStartedAt(null);
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setCloudSyncIssue(null);
    setEarlySessionPlanId(null);
    setEarlyScheduleIssue(null);
    setActiveTab("Home");
    setAccountMode("create");
    if (isCloudAccount) {
      setSignedIn(true);
      setStage("onboarding-intro");
    } else {
      setAccount(null);
      setSignedIn(false);
      setStage("landing");
    }
  };

  const rescheduleSession = (planId: string, planSessionId: string, scheduledFor: string) => {
    setPlans((current) => current.map((plan) => plan.id !== planId ? plan : {
      ...plan,
      sessions: plan.sessions.map((session) => session.id === planSessionId
        ? { ...session, scheduledFor }
        : session),
    }));
  };

  const changePlanArchiveState = async (planId: string, action: "archive" | "restore") => {
    const response = await fetch("/api/plans/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, action }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "YOVA could not update that learning goal.";
      throw new Error(message);
    }
    const parsed = PlanArchiveResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The learning goal came back in an unsafe format.");
    setPlans((current) => current.map((plan) => plan.id === parsed.data.planId ? { ...plan, status: parsed.data.status } : plan));
    if (parsed.data.status !== "active" && selectedPlanId === parsed.data.planId) {
      setSelectedPlanId(null);
    }
    return parsed.data.status;
  };

  const adjustPlan = async (input: PlanAdjustmentRequest) => {
    if (account?.identityMode === "preview") {
      const plan = plans.find((candidate) => candidate.id === input.planId);
      if (!plan) throw new Error("YOVA could not find that plan.");
      const settledSessions = plan.sessions.filter((session) => session.status === "complete" || session.status === "skipped");
      const unfinishedSessions = plan.sessions.filter((session) => session.status === "ready" || session.status === "upcoming");
      const replacements = buildContentBasedReplacementSessions(
        unfinishedSessions.map((session) => ({
          id: session.id,
          sequence: session.sequence,
          title: session.title,
          objective: session.objective,
          method: session.method,
          method_rationale: session.methodReason,
          scheduled_for: session.scheduledFor,
          estimated_minutes: session.estimatedMinutes,
          status: session.status as "ready" | "upcoming",
          step_data: {
            learningMode: session.learningMode,
            contentTargets: session.contentTargets ?? [],
            completionEvidence: session.completionEvidence ?? [],
          },
        })),
        input.futureSessionMinutes,
        Math.max(0, ...settledSessions.map((session) => session.sequence)) + 1,
      );
      if (!replacements.length) throw new Error("This plan has no unfinished content to adjust.");
      setPlans((current) => current.map((candidate) => candidate.id === input.planId ? {
        ...candidate,
        deadline: input.deadline,
        studyMode: input.studyMode,
        sessions: [...settledSessions, ...replacements].sort((left, right) => left.sequence - right.sequence),
      } : candidate));
      return;
    }

    const response = await fetch("/api/plans/adjust", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "YOVA could not adjust that plan.";
      throw new Error(message);
    }
    const parsed = PlanAdjustmentResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The adjusted plan came back in an unsafe format.");
    setPlans((current) => current.map((plan) => {
      if (plan.id !== parsed.data.planId) return plan;
      const settledSessions = plan.sessions.filter((session) => session.status === "complete" || session.status === "skipped");
      return {
        ...plan,
        deadline: parsed.data.deadline,
        studyMode: parsed.data.studyMode,
        sessions: [...settledSessions, ...parsed.data.sessions].sort((left, right) => left.sequence - right.sequence),
      };
    }));
  };

  const attachMaterials = async (planId: string, materialIds: string[]) => {
    const response = await fetch("/api/materials/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, materialIds }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "YOVA could not attach those materials.";
      throw new Error(message);
    }
    const parsed = MaterialAttachmentResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The attached materials came back in an unsafe format.");
    setPlans((current) => current.map((plan) => plan.id === parsed.data.planId ? {
      ...plan,
      sourceMode: parsed.data.sourceMode,
      materials: parsed.data.materials,
      sessions: plan.sessions.map((session) => session.status === "ready" || session.status === "upcoming"
        ? { ...session, resource: undefined }
        : session),
    } : plan));
  };

  const adjustSessionDuration = async (planSessionId: string, estimatedMinutes: number) => {
    const plan = plans.find((candidate) => candidate.sessions.some((session) => session.id === planSessionId));
    if (!plan) throw new Error("YOVA could not find the plan behind that session.");

    await adjustPlan({
      planId: plan.id,
      deadline: plan.deadline,
      studyMode: plan.studyMode,
      futureSessionMinutes: estimatedMinutes,
    });
  };

  const applyTutorAction = async (action: TutorProposedAction) => {
    await adjustSessionDuration(action.planSessionId, action.minutes);
  };

  const retryCloudSync = async () => {
    if (account?.identityMode !== "supabase") return;

    const issue = await syncPendingCloudWork(account, answers, onboardingCompleted);
    setCloudSyncIssue(issue);
    if (issue) throw new Error(issue);
  };

  if (!ready) return <LoadingAccount />;

  if (stage === "landing") return <Landing authIssue={authStartupIssue} onRetryAuth={() => { setReady(false); setAuthCheckAttempt((attempt) => attempt + 1); }} onCreate={() => { setAccountMode("create"); setStage("account"); }} onSignIn={() => { setAccountMode("sign-in"); setStage("account"); }} />;
  if (stage === "account") {
    return <AccountEntry mode={accountMode} existingAccount={account} emailCodeVerificationEnabled={emailCodeVerificationEnabled} browserPreviewMode={browserPreviewMode} onBack={() => setStage("landing")} onContinue={(nextAccount) => {
      if (accountMode === "create") {
        clearPreviewSnapshot();
        setAnswers([]);
        setOnboardingCompleted(false);
        setAlphaEntered(false);
        setPlans([]);
        setSessionCompletions([]);
        setSessionInterruptions([]);
        setQuestionIndex(0);
      }
      setAccount(nextAccount);
      setSignedIn(true);
      if (accountMode === "sign-in" && onboardingCompleted) setStage(alphaEntered ? "app" : "paywall");
      else setStage("onboarding-intro");
    }} />;
  }
  if (stage === "onboarding-intro") return <OnboardingIntro onStart={() => {
    trackProductEvent({ eventName: "onboarding_started", context: {} }, analyticsEnabled);
    setStage("onboarding");
  }} />;
  if (stage === "onboarding") {
    return (
      <OnboardingQuestion
        index={questionIndex}
        answer={answers[questionIndex]}
        onBack={() => setQuestionIndex((value) => Math.max(0, value - 1))}
        onAnswer={(answer) => {
          const next = [...answers];
          next[questionIndex] = answer;
          setAnswers(next);
        }}
        onNext={() => {
          if (questionIndex === onboardingQuestions.length - 1) {
            trackProductEvent({
              eventName: "onboarding_completed",
              context: { answeredQuestionCount: answers.filter(Boolean).length },
            }, analyticsEnabled);
            setOnboardingCompleted(true);
            setStage("profile");
          }
          else setQuestionIndex((value) => value + 1);
        }}
      />
    );
  }
  if (stage === "profile") return <ProfileSummary answers={answers} onContinue={() => setStage("paywall")} />;
  if (stage === "paywall") return <PaywallPreview onContinue={() => {
    trackProductEvent({ eventName: "alpha_entered", context: {} }, analyticsEnabled);
    setAlphaEntered(true);
    setStage("app");
  }} />;
  if (stage === "plan-creator") return <PlanCreator profileSummary={buildPlanProfileSummary(answers)} onExit={() => setStage("app")} onFinish={(plan) => {
    trackProductEvent({
      eventName: "plan_created",
      context: {
        intent: "build_plan",
        sourceMode: plan.sourceMode,
        studyMode: plan.studyMode,
        learningApproach: plan.learningIntent,
        sessionCount: plan.sessions.length,
      },
    }, analyticsEnabled);
    setPlans((current) => [...current, plan]);
    setSelectedPlanId(plan.id);
    setLearningDetailPlanId(plan.id);
    setStage("app");
    setActiveTab("Learning");
  }} />;
  if (stage === "study-now") return <StudyNowCreator profileSummary={buildPlanProfileSummary(answers)} onExit={() => setStage("app")} onFinish={(plan) => {
    trackProductEvent({
      eventName: "plan_created",
      context: {
        intent: "study_now",
        sourceMode: plan.sourceMode,
        studyMode: plan.studyMode,
        learningApproach: plan.learningIntent,
        sessionCount: plan.sessions.length,
      },
    }, analyticsEnabled);
    setPlans((current) => [...current, plan]);
    setSelectedPlanId(plan.id);
    void startSession(plan.id, plan);
  }} />;
  if (stage === "session-setup") return <SessionSetup plan={pendingSessionPlan ?? activePlan} answers={answers} completions={sessionCompletions} interruptions={sessionInterruptions} onExit={() => {
    setPendingSessionPlan(null);
    setStage("app");
  }} onStart={(adjustment) => {
    const plan = pendingSessionPlan ?? activePlan;
    if (plan) void startSession(plan.id, plan, adjustment);
  }} />;
  if (stage === "session-loading") return <SessionLoading plan={activePlan} onExit={() => {
    sessionGenerationAbortRef.current?.abort();
    sessionGenerationAbortRef.current = null;
    setStage("app");
  }} />;
  if (stage === "session-error") return <SessionGenerationError plan={activePlan} issue={sessionGenerationIssue} onExit={() => setStage("app")} onRetry={() => void startSession(activePlan?.id)} />;
  if (stage === "session") {
    return (
      <GuidedSession
        key={`${activePlan?.id ?? "session"}-${sessionStep}`}
        plan={activePlan}
        steps={activeLessonSteps}
        step={sessionStep}
        selectedAnswer={selectedAnswer}
        outcome={sessionOutcomes[sessionStep]}
        confidence={sessionConfidence[sessionStep]}
        priorConfidenceCaptured={Object.keys(sessionConfidence).some((key) => Number(key) < sessionStep)}
        answerRevealed={answerRevealed}
        elapsedSeconds={sessionElapsedSeconds}
        capacityMinutes={sessionCapacityMinutes}
        rationale={sessionRationale}
        coverage={sessionCoverage}
        methodBriefing={sessionMethodBriefing}
        supportPlan={sessionSupportPlan}
        sourceGrounding={sessionSourceGrounding}
        issue={sessionGenerationIssue}
        analyticsEnabled={analyticsEnabled}
        browserPreviewMode={browserPreviewMode || account?.identityMode === "preview"}
        onSelect={(answer) => {
          setSelectedAnswer(answer);
        }}
        onEvaluate={(correct) => {
          setSessionOutcomes((current) => ({ ...current, [sessionStep]: correct }));
        }}
        onConfidence={(confidence) => {
          setSessionConfidence((current) => ({ ...current, [sessionStep]: confidence }));
        }}
        onReveal={() => setAnswerRevealed(true)}
        onExit={interruptActiveSession}
        onNext={(evaluation) => {
          const immediateRepair = buildImmediateRepairAfterMiss(
            activeLessonSteps,
            sessionStep,
            sessionOutcomes,
            2,
            evaluation?.missingIdeas ?? [],
          );
          if (immediateRepair) {
            setGeneratedLessonSteps([
              ...activeLessonSteps.slice(0, sessionStep + 1),
              immediateRepair,
              ...activeLessonSteps.slice(sessionStep + 1),
            ]);
            setSessionStep((value) => value + 1);
            setSelectedAnswer(null);
            setAnswerRevealed(false);
            return;
          }

          if (sessionStep === activeLessonSteps.length - 1) {
            const finishedAt = Date.now();
            if (sessionStartedAt) setSessionElapsedSeconds(Math.max(1, Math.round((finishedAt - sessionStartedAt) / 1_000)));
            setSessionCompletedAt(new Date(finishedAt).toISOString());
            setStage("complete");
          }
          else {
            setSessionStep((value) => value + 1);
            setSelectedAnswer(null);
            setAnswerRevealed(false);
          }
        }}
      />
    );
  }
  if (stage === "complete") {
    const currentSession = activePlan?.sessions.find((session) => session.status === "ready") ?? null;
    const nextSession = currentSession
      ? activePlan?.sessions.find((session) => session.sequence === currentSession.sequence + 1) ?? null
      : null;
    return <SessionComplete requiredContentCount={activeLessonSteps.filter((step) => step.requiredForCompletion !== false).length} repairCount={sessionEvidence.completedImmediateRepairs} elapsedSeconds={capturedSessionSeconds} actualMinutes={capturedSessionMinutes} correctAnswers={sessionEvidence.correctAnswers} totalAnswers={sessionEvidence.totalAnswers} observedGap={sessionEvidence.observedGap} conceptEvidence={sessionEvidence.conceptEvidence} confidenceEvidence={sessionEvidence.confidenceEvidence} nextSession={nextSession} onFinish={(feedback) => { completeActiveSession(sessionEvidence.correctAnswers, sessionEvidence.totalAnswers, feedback, capturedSessionMinutes); setStage("app"); setActiveTab("Home"); }} />;
  }

  return <>
    <AppShell activeTab={activeTab} onTab={openTab} account={account} cloudSyncIssue={cloudSyncIssue} onRetryCloudSync={retryCloudSync} onCreatePlan={() => setStage("plan-creator")} onSignOut={() => {
      void signOutAuthenticatedAccount().finally(() => {
        clearPreviewSnapshot();
        setAccount(null);
        setSignedIn(false);
        setAnswers([]);
        setOnboardingCompleted(false);
        setAlphaEntered(false);
        setPlans([]);
        setSelectedPlanId(null);
        setSessionCompletions([]);
        setSessionInterruptions([]);
        setActiveTab("Home");
        setStage("landing");
      });
    }}>
      {activeTab === "Home" && <HomeScreen account={account} answers={answers} plans={activePlans} plan={recommendedPlan} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} tutorQuestion={tutorQuestion} onTutorQuestion={setTutorQuestion} onOpenTutor={openAskYova} onOpenYou={() => setActiveTab("You")} onStart={() => requestSessionStart(recommendedPlan?.id)} onOpenPlan={(planId) => { setSelectedPlanId(planId); setLearningDetailPlanId(planId); setActiveTab("Learning"); }} onCreatePlan={() => setStage("plan-creator")} onStudyNow={() => setStage("study-now")} />}
      {activeTab === "Learning" && <LearningScreen plans={plans} detailPlanId={learningDetailPlanId} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} onOpenPlan={(planId) => { setSelectedPlanId(planId); setLearningDetailPlanId(planId); }} onClosePlan={() => setLearningDetailPlanId(null)} onStart={requestSessionStart} onCreatePlan={() => setStage("plan-creator")} onArchiveStateChange={changePlanArchiveState} onAdjustPlan={adjustPlan} onAttachMaterials={attachMaterials} />}
      {activeTab === "Agenda" && <AgendaScreen plans={plans.filter((plan) => plan.status !== "archived")} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} previewMode={account?.identityMode === "preview"} onStart={requestSessionStart} onActivateReview={activateConceptReview} onReschedule={rescheduleSession} onAdjustDuration={adjustSessionDuration} />}
      {activeTab === "Ask YOVA" && <AskScreen key={tutorEntryKey} plans={plans} question={tutorQuestion} onQuestion={setTutorQuestion} onApplyAction={applyTutorAction} analyticsEnabled={analyticsEnabled} />}
      {activeTab === "You" && <YouScreen account={account} answers={answers} plans={plans} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} onAnswersChange={setAnswers} onStart={() => requestSessionStart(recommendedPlan?.id)} onOpenLearning={() => { if (recommendedPlan) { setSelectedPlanId(recommendedPlan.id); setLearningDetailPlanId(recommendedPlan.id); } setActiveTab("Learning"); }} onReset={resetYovaData} />}
    </AppShell>
    {earlySessionPlan && earlySession && <EarlySessionDialog plan={earlySessionPlan} session={earlySession} pending={earlySchedulePending} issue={earlyScheduleIssue} onCancel={() => { setEarlySessionPlanId(null); setEarlyScheduleIssue(null); }} onStart={(shiftRemainingPlan) => void startEarlySession(shiftRemainingPlan)} />}
  </>;
}

async function syncPendingCloudWork(account: PreviewAccount, answers: string[], onboardingCompleted: boolean) {
  let profileIssue: string | null = null;
  if (onboardingCompleted) {
    try {
      await saveAuthenticatedLearnerProfile({
        displayName: account.displayName,
        onboardingAnswers: answers,
      });
    } catch (error) {
      profileIssue = error instanceof Error ? error.message : "YOVA could not sync your learning profile.";
    }
  }

  const result = await flushQueuedSessionCompletions(account.id);
  const interruptionResult = await flushQueuedSessionInterruptions(account.id);
  const pendingEvents = result.remaining + interruptionResult.remaining;
  if (pendingEvents > 0) {
    return `${pendingEvents} session ${pendingEvents === 1 ? "event is" : "events are"} still waiting to sync.`;
  }
  return profileIssue;
}

function LoadingAccount() {
  return <main className="centered-shell"><BrandMark /><p className="muted">Opening your YOVA…</p></main>;
}

function Landing({ authIssue, onRetryAuth, onCreate, onSignIn }: { authIssue: string | null; onRetryAuth: () => void; onCreate: () => void; onSignIn: () => void }) {
  return (
    <main className="entry-shell">
      <header className="entry-nav"><BrandMark /><button className="button ghost" onClick={onSignIn}>Sign in</button></header>
      {authIssue && <section className="auth-startup-warning" role="alert"><AlertCircle size={19} /><div><strong>Account connection interrupted</strong><span>{authIssue}</span></div><button className="button secondary" onClick={onRetryAuth}>Try again</button></section>}
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={15} /> A study plan built around you</span>
          <h1>Know what to study next.</h1>
          <p>Bring your notes, or just name the topic. YOVA builds the plan, chooses the learning method, and guides you through the work.</p>
          <div className="hero-actions"><button className="button primary large" onClick={onCreate}>Build my plan <ArrowRight size={18} /></button><a className="button secondary large" href="#how-yova-works">See how it works</a></div>
          <div className="hero-trust"><Check size={16} /><span>No upload required</span><Check size={16} /><span>Methods explained as you study</span></div>
        </div>
        <div className="hero-product-preview" aria-label="Example personalized YOVA session">
          <div className="preview-window-bar"><span /><span /><span /><em>Today in YOVA</em></div>
          <div className="preview-session-head">
            <div><small>RECOMMENDED NEXT</small><h2>Cellular respiration</h2><p>25 min · Active recall + targeted repair</p></div>
            <span className="preview-progress">1 / 4</span>
          </div>
          <div className="preview-why"><Sparkles size={16} /><p><strong>Why this fits:</strong> Your test is soon and your last check showed confident recall with one important gap.</p></div>
          <div className="preview-steps">
            <div className="complete"><Check size={15} /><span><strong>Attempt from memory</strong><small>5 minutes</small></span></div>
            <div className="current"><Target size={15} /><span><strong>Repair the weak point</strong><small>12 minutes</small></span></div>
            <div><RotateCcw size={15} /><span><strong>Verify without support</strong><small>8 minutes</small></span></div>
          </div>
          <button className="preview-start" onClick={onCreate}>Start session <ArrowRight size={16} /></button>
        </div>
      </section>
      <section className="how-yova-works" id="how-yova-works">
        <div><span className="step-label">HOW YOVA WORKS</span><h2>From a goal to a guided session.</h2><p>The setup stays simple. YOVA uses your starting point, schedule, materials, and completed work to decide what happens inside each session.</p></div>
        <div className="how-steps"><article><span>1</span><h3>Tell YOVA the goal</h3><p>Prepare for a test, understand a topic, or build a longer learning plan.</p></article><article><span>2</span><h3>Add materials, or do not</h3><p>Use notes, slides, PDFs, AI-created lessons, or outside resources you already trust.</p></article><article><span>3</span><h3>Follow one clear next step</h3><p>YOVA chooses and explains the method, guides the work, then updates what comes next.</p></article></div>
        <button className="button primary large" onClick={onCreate}>Build my YOVA <ArrowRight size={18} /></button>
      </section>
      <footer className="entry-trust-links"><span>YOVA private alpha</span><nav aria-label="Trust and support"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link></nav></footer>
    </main>
  );
}

function AccountEntry({ mode, existingAccount, emailCodeVerificationEnabled, browserPreviewMode, onBack, onContinue }: { mode: AccountMode; existingAccount: PreviewAccount | null; emailCodeVerificationEnabled: boolean; browserPreviewMode: boolean; onBack: () => void; onContinue: (account: PreviewAccount) => void }) {
  const [displayName, setDisplayName] = useState(existingAccount?.displayName ?? "");
  const [email, setEmail] = useState(existingAccount?.email ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const isCreate = mode === "create";
  const authMode = browserPreviewMode ? "preview" : getAuthMode();

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (isCreate && !displayName.trim()) {
      setError("Enter your first name.");
      return;
    }
    if (authMode === "preview" && !isCreate && (!existingAccount || existingAccount.email !== normalizedEmail)) {
      setError("No private-alpha account is saved for this email in this browser yet.");
      return;
    }

    setPending(true);
    setError("");
    try {
      if (authMode === "preview") {
        onContinue(existingAccount && !isCreate ? existingAccount : {
          id: makeId("preview_user"),
          email: normalizedEmail,
          displayName: displayName.trim(),
          createdAt: new Date().toISOString(),
          identityMode: "preview",
        });
        return;
      }

      const result = await requestEmailAuthentication({
        email: normalizedEmail,
        displayName: displayName.trim(),
        shouldCreateUser: isCreate,
      });

      if (result.mode === "supabase") {
        setEmailSent(true);
        return;
      }

      throw new Error("YOVA could not start secure sign-in.");
    } catch (authenticationError) {
      setError(authenticationError instanceof Error ? authenticationError.message : "YOVA could not start sign-in. Try again.");
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async () => {
    setPending(true);
    setError("");
    try {
      const verifiedAccount = await verifyEmailAuthenticationCode(email, verificationCode);
      onContinue(verifiedAccount);
    } catch (authenticationError) {
      setError(authenticationError instanceof Error ? authenticationError.message : "YOVA could not verify that code. Try again.");
    } finally {
      setPending(false);
    }
  };

  if (emailSent) {
    return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card email-sent"><div className="mail-check"><Mail size={24} /></div><span className="step-label">CHECK YOUR EMAIL</span><h1>Your secure sign-in email is on its way.</h1><p>We sent it to <strong>{email.trim().toLowerCase()}</strong>.</p>{emailCodeVerificationEnabled && <div className="email-code-entry"><span className="step-label">EASIEST OPTION</span><p>Enter the 6-digit code from the newest YOVA email.</p><label><span>Verification code</span><input value={verificationCode} onChange={(event) => { setVerificationCode(normalizeEmailVerificationCode(event.target.value)); setError(""); }} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" aria-label="6-digit verification code" disabled={pending} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary large full" onClick={() => void verifyCode()} disabled={pending || !isCompleteEmailVerificationCode(verificationCode)}>{pending ? "Verifying…" : "Verify and continue"} {!pending && <ArrowRight size={18} />}</button></div>}<div className="email-link-option"><strong>{emailCodeVerificationEnabled ? "Or use the secure link" : "Open the secure link"}</strong><span>Open the newest email link in the browser where you requested it, then return here.</span></div><button className={emailCodeVerificationEnabled ? "button secondary large full" : "button primary large full"} onClick={() => window.location.reload()}>I opened the link. Check sign-in</button><button className="button ghost large full" onClick={() => { setEmailSent(false); setVerificationCode(""); setError(""); }}>Use a different email</button><div className="preview-notice"><strong>{emailCodeVerificationEnabled ? "The code works across browsers" : "Use the same browser"}</strong><span>{emailCodeVerificationEnabled ? "If the link opens somewhere else, enter the email code here instead." : "For this private alpha, the secure link must open in the browser where you requested it."}</span></div></section></main>;
  }

  return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card"><span className="step-label">{isCreate ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span><h1>{isCreate ? "Start building your YOVA." : "Continue your learning."}</h1><p>{isCreate ? "Your account keeps your profile, plans, sessions, and progress together." : authMode === "supabase" ? emailCodeVerificationEnabled ? "Enter your email and YOVA will send you a secure code and sign-in link." : "Enter your email and YOVA will send you a secure sign-in link." : "Use the email attached to this browser’s private-alpha account."}</p>{isCreate && <label><span>First name</span><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} autoComplete="given-name" disabled={pending} /></label>}<label><span>Email address</span><div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" disabled={pending} /></div></label>{error && <p className="form-error">{error}</p>}<button className="button primary large full" onClick={() => void submit()} disabled={pending}>{pending ? "Sending secure email…" : isCreate ? "Continue" : "Sign in"} {!pending && <ArrowRight size={18} />}</button>{isCreate && <p className="account-consent">By continuing, you agree to the <Link href="/terms">Private Alpha Terms</Link> and acknowledge the <Link href="/privacy">Privacy Notice</Link>.</p>}<div className="preview-notice"><strong>{authMode === "supabase" ? "Secure cloud account" : "Private-alpha storage"}</strong><span>{authMode === "supabase" ? emailCodeVerificationEnabled ? "YOVA verifies a temporary email code or link instead of storing a password." : "YOVA uses a temporary email link instead of storing a password." : "For now, this browser remembers the prototype. Real email verification activates when the cloud project is connected."}</span></div></section></main>;
}

function consumeAuthCallbackIssue() {
  const url = new URL(window.location.href);
  const issue = describeAuthCallbackResult(url.searchParams.get("auth"));
  if (!issue) return null;

  url.searchParams.delete("auth");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return issue;
}

function OnboardingIntro({ onStart }: { onStart: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card"><span className="step-label">SET UP YOUR YOVA</span><h1>Make YOVA fit how you actually study.</h1><p>Ten short questions help YOVA build realistic plans, choose useful methods, and guide you at the right level. About two minutes.</p><div className="info-strip"><Sparkles size={20} /><span>This creates starting preferences, not a brain type. YOVA will update carefully based on what you actually do.</span></div><button className="button primary large full" onClick={onStart}>Personalize YOVA <ArrowRight size={18} /></button></section></main>;
}

function OnboardingQuestion({ index, answer, onAnswer, onNext, onBack }: { index: number; answer?: string; onAnswer: (answer: string) => void; onNext: () => void; onBack: () => void }) {
  const question = onboardingQuestions[index];
  return <main className="onboarding-shell"><header><BrandMark /><span>{index + 1} of {onboardingQuestions.length}</span></header><div className="progress-track"><div style={{ width: `${((index + 1) / onboardingQuestions.length) * 100}%` }} /></div><section className="question-wrap"><span className="step-label">YOUR STARTING PROFILE</span><h2>{question.prompt}</h2>{question.optional && <p className="muted">Optional: you can skip this or change it later.</p>}<div className="option-list">{question.options.map((option) => <button key={option} className={`option ${answer === option ? "selected" : ""}`} onClick={() => onAnswer(option)}><span>{option}</span>{answer === option && <Check size={18} />}</button>)}</div><footer className="question-footer"><button className="button ghost" onClick={onBack} disabled={index === 0}><ArrowLeft size={17} /> Back</button><button className="button primary" onClick={onNext} disabled={!answer && !question.optional}>{index === onboardingQuestions.length - 1 ? "Build my setup" : "Continue"} <ArrowRight size={17} /></button></footer></section></main>;
}

function ProfileSummary({ answers, onContinue }: { answers: string[]; onContinue: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card wide"><span className="eyebrow"><Sparkles size={15} /> Your starting setup</span><h1>YOVA will begin like this.</h1><p>This is a transparent starting point based on your answers. It can change as you update your preferences and complete sessions.</p><div className="profile-grid"><ProfileItem title="Guidance" value={answers[1] || "Not answered yet"} note="Controls how much YOVA decides for you" /><ProfileItem title="Session size" value={answers[2] || "Not answered yet"} note="Used as a starting estimate" /><ProfileItem title="Explanations" value={answers[3] || "Not answered yet"} note="Shapes how difficult material is introduced" /><ProfileItem title="Focus pattern" value={answers[4] || "Not answered yet"} note="Helps YOVA keep sessions manageable" /></div><button className="button primary large full" onClick={onContinue}>Continue <ArrowRight size={18} /></button></section></main>;
}

function ProfileItem({ title, value, note }: { title: string; value: string; note: string }) { return <div className="profile-item"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>; }

function PaywallPreview({ onContinue }: { onContinue: () => void }) {
  return <main className="centered-shell dark"><BrandMark /><section className="setup-card paywall"><span className="step-label">YOVA LITE</span><h1>A study system built around you.</h1><p>Plans, method selection, guided sessions, progress memory, and adjustments based on what happens next.</p><ul className="check-list"><li><Check /> Determine what you already know</li><li><Check /> Choose methods that fit the task and your tendencies</li><li><Check /> Tell you exactly how to perform each method</li><li><Check /> Adjust the next session using your results</li></ul><button className="button primary large full" onClick={onContinue}>Continue to private alpha</button><small>Payments will be connected after the core experience is validated.</small></section></main>;
}

function EarlySessionDialog({ plan, session, pending, issue, onCancel, onStart }: { plan: LearningPlan; session: LearningPlanSession; pending: boolean; issue: string | null; onCancel: () => void; onStart: (shiftRemainingPlan: boolean) => void }) {
  const unfinishedCount = plan.sessions.filter((item) => item.status === "ready" || item.status === "upcoming").length;
  return <div className="early-session-backdrop"><section className="early-session-dialog" role="dialog" aria-modal="true" aria-labelledby="early-session-title"><span className="early-session-icon"><CalendarDays size={22} /></span><span className="step-label">YOU ARE AHEAD OF SCHEDULE</span><h2 id="early-session-title">Start {session.title} now?</h2><p>This session is planned for {formatAgendaTime(session.scheduledFor)}. You can move forward now without skipping any unfinished content.</p><div className="early-schedule-choice"><Sparkles size={18} /><div><strong>Recommended: pull the agenda forward</strong><p>YOVA will move this session to now and shift the remaining {Math.max(0, unfinishedCount - 1)} {unfinishedCount - 1 === 1 ? "session" : "sessions"} by the same amount. The learning order and spacing stay intact.</p></div></div>{issue && <div className="chat-error"><AlertCircle size={16} /><span>{issue}</span></div>}<div className="early-session-actions"><button className="button ghost" disabled={pending} onClick={onCancel}>Cancel</button><button className="button secondary" disabled={pending} onClick={() => onStart(false)}>Start now, keep dates</button><button className="button primary" disabled={pending} onClick={() => onStart(true)}>{pending ? <span className="button-spinner" /> : <CalendarDays size={16} />} Start and adjust agenda</button></div></section></div>;
}

function AppShell({ activeTab, onTab, account, cloudSyncIssue, onRetryCloudSync, onCreatePlan, onSignOut, children }: { activeTab: Tab; onTab: (tab: Tab) => void; account: PreviewAccount | null; cloudSyncIssue: string | null; onRetryCloudSync: () => Promise<void>; onCreatePlan: () => void; onSignOut: () => void; children: React.ReactNode }) {
  const initial = account?.displayName.trim().charAt(0).toUpperCase() || "Y";
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetryCloudSync();
    } catch {
      // The parent keeps the most useful user-facing sync message visible.
    } finally {
      setRetrying(false);
    }
  };
  return <div className="app-shell"><aside className="sidebar"><BrandMark /><button className="sidebar-create" onClick={onCreatePlan}><Plus size={18} /><span>New plan</span></button><nav aria-label="Main navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? "active" : ""} onClick={() => onTab(label)}><Icon size={19} /><span>{label}</span></button>)}</nav><nav className="sidebar-trust-links" aria-label="Trust and support"><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav><div className="sidebar-bottom"><div className="account-dot">{initial}</div><div><strong>{account?.displayName || "YOVA user"}</strong><span>{account?.identityMode === "supabase" ? "Cloud account" : "Private alpha"}</span></div><button aria-label="Sign out" title="Sign out" onClick={onSignOut}><LogOut size={17} /></button></div></aside><main className="app-content">{cloudSyncIssue && <div className="cloud-sync-warning"><strong>Cloud sync needs attention.</strong><span>{cloudSyncIssue} Your latest work is still saved in this browser.</span><button disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Retry now"}</button></div>}{children}</main></div>;
}

function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <header className="page-header">{eyebrow && <span className="step-label">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</header>; }

function HomeScreen({ account, answers, plans, plan, sessionCompletions, sessionInterruptions, tutorQuestion, onTutorQuestion, onOpenTutor, onOpenYou, onStart, onOpenPlan, onCreatePlan, onStudyNow }: { account: PreviewAccount | null; answers: string[]; plans: LearningPlan[]; plan: LearningPlan | null; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; tutorQuestion: string; onTutorQuestion: (question: string) => void; onOpenTutor: () => void; onOpenYou: () => void; onStart: () => void; onOpenPlan: (planId: string) => void; onCreatePlan: () => void; onStudyNow: () => void }) {
  const readySession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  const resumePoint = readySession ? resumableSessionProgress(readySession.id, sessionInterruptions) : null;
  const completedCount = plan?.sessions.filter((session) => session.status === "complete").length ?? 0;
  const personalizationRecommendation = buildPersonalizationRecommendations({
    answers,
    plans,
    completions: sessionCompletions,
    interruptions: sessionInterruptions,
  })[0] ?? null;
  const firstName = account?.displayName.split(" ")[0] || "there";
  const now = new Date();

  return <div className="page home-page"><header className="home-header"><div><span className="step-label">{formatHomeDate(now)}</span><h1>{greetingFor(now)}, {firstName}.</h1><p>{plan && readySession ? "Your next learning step is ready." : "What would you like to learn or prepare for?"}</p></div><button className="button secondary" onClick={onCreatePlan}><Plus size={17} /> New plan</button></header>{plan && readySession ? <section className="recommendation-card"><div className="rec-top"><span><Sparkles size={15} /> {resumePoint ? "Continue where you left off" : "Recommended next"}</span><span>{completedCount} of {plan.sessions.length} sessions complete</span></div><div className="rec-body"><div className="rec-copy"><span className="subject-label">{plan.title.toUpperCase()}</span>{readySession.adaptationNote && <span className="adaptation-proof"><Sparkles size={13} /> Adjusted using your last session</span>}<h2>{readySession.title}</h2><div className="meta-row"><span>{readySession.learningMode === "learn" ? <BookOpen size={16} /> : <Target size={16} />}{readySession.learningMode === "learn" ? "Teaching first" : "Practice first"}</span><span><Target size={16} /> {readySession.method}</span><span><Clock3 size={16} /> {readySession.amountLabel}</span>{resumePoint && <span><Check size={16} /> {resumePoint.completedSteps} {resumePoint.completedSteps === 1 ? "section" : "sections"} saved</span>}</div></div><button className="button white large" onClick={onStart}>{resumePoint ? "Continue session" : "Start session"} <ArrowRight size={18} /></button></div><div className="reason-grid"><div><strong>{resumePoint ? "Resume point" : "Why this is next"}</strong><p>{resumePoint ? `YOVA saved your first ${resumePoint.completedSteps} ${resumePoint.completedSteps === 1 ? "section" : "sections"}. You will continue with the next unfinished activity.` : recommendationReason(plan, readySession, now)}</p></div><div><strong>{readySession.adaptationNote ? "What changed" : "How you will study"}</strong><p>{readySession.adaptationNote?.explanation ?? readySession.methodReason}</p></div></div></section> : <section className="empty-home"><div className="empty-home-copy"><span className="eyebrow"><Sparkles size={15} /> Start here</span><h2>Turn any goal into a clear next step.</h2><p>Use your own materials, let YOVA create the content, or get a plan for studying somewhere else.</p></div><div className="empty-home-actions"><button className="button primary large" onClick={onCreatePlan}>Create a learning plan <ArrowRight size={18} /></button><button className="button secondary large" onClick={onStudyNow}>Study something now</button></div></section>}{personalizationRecommendation && <section className="home-personalization-recommendation"><div className="home-personalization-icon"><Sparkles size={18} /></div><div><span>YOVA RECOMMENDS</span><strong>{personalizationRecommendation.title}</strong><p>{personalizationRecommendation.explanation}</p><small>{personalizationRecommendation.evidence}</small></div>{personalizationRecommendation.action === "improve_profile" ? <button onClick={onOpenYou}>{personalizationRecommendation.actionLabel}</button> : personalizationRecommendation.action === "open_learning" && plan ? <button onClick={() => onOpenPlan(plan.id)}>{personalizationRecommendation.actionLabel}</button> : personalizationRecommendation.action === "start_session" ? <button onClick={onStart}>{personalizationRecommendation.actionLabel}</button> : null}</section>}<section className="home-command"><span>Ask YOVA</span><AskBar value={tutorQuestion} onChange={onTutorQuestion} onSubmit={onOpenTutor} /></section><section className="home-section"><div className="section-title"><div><h3>Start something</h3><p>Choose the amount of structure you need.</p></div></div><div className="quick-actions"><button onClick={onCreatePlan}><span className="quick-action-icon"><BookOpen size={19} /></span><span><strong>{plan ? "Create another plan" : "Create a plan"}</strong><small>For a test, course unit, book, or longer goal</small></span><ArrowRight size={17} /></button><button onClick={onStudyNow}><span className="quick-action-icon"><Target size={19} /></span><span><strong>Study something now</strong><small>Build one focused session around what you need today</small></span><ArrowRight size={17} /></button></div></section>{plans.length > 0 && <section className="section-block active-learning-block"><div className="section-title"><div><h3>Your learning</h3><p>Open a goal to see its plan, sources, and progress.</p></div><span>{plans.length} active</span></div><div className="compact-items">{plans.map((item) => { const next = item.sessions.find((session) => session.status === "ready"); const saved = next ? resumableSessionProgress(next.id, sessionInterruptions) : null; return <button className={item.id === plan?.id ? "selected" : ""} key={item.id} onClick={() => onOpenPlan(item.id)}><SubjectIcon plan={item} compact /><span><strong>{item.title}</strong><small>{next ? saved ? `Continue at section ${saved.completedSteps + 1}` : `${next.learningMode === "learn" ? "Teaching first" : "Practice first"} · ${formatSessionTime(next.scheduledFor)}` : "Plan complete"}</small></span><ChevronRight /></button>; })}</div></section>}</div>;
}

function SubjectIcon({ plan, compact = false }: { plan: LearningPlan; compact?: boolean }) {
  const text = `${plan.title} ${plan.topic}`.toLocaleLowerCase();
  const subject = /bio|cell|anatom|health|nutrition|photosynth|respirat/.test(text)
    ? { Icon: Dna, theme: "life" }
    : /chem|molecule|reaction|organic/.test(text)
      ? { Icon: FlaskConical, theme: "chemistry" }
      : /calc|math|algebra|geometry|derivative|statistic/.test(text)
        ? { Icon: Calculator, theme: "math" }
        : /physics|force|motion|energy|electric/.test(text)
          ? { Icon: Atom, theme: "physics" }
          : /history|government|politic|civic|law/.test(text)
            ? { Icon: Landmark, theme: "humanities" }
            : /finance|business|economic|invest|account/.test(text)
              ? { Icon: BadgeDollarSign, theme: "finance" }
              : /code|program|software|computer|javascript|python/.test(text)
                ? { Icon: Code2, theme: "computing" }
                : /geograph|world|environment/.test(text)
                  ? { Icon: Globe2, theme: "world" }
                  : /science|research|lab/.test(text)
                    ? { Icon: Microscope, theme: "life" }
                    : { Icon: BookMarked, theme: "general" };
  const SubjectGlyph = subject.Icon;
  return <span className={`subject-icon ${subject.theme} ${compact ? "compact" : ""}`} aria-hidden="true"><SubjectGlyph size={compact ? 18 : 20} /></span>;
}

function chooseRecommendedPlan(plans: LearningPlan[]) {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const candidates = plans.flatMap((plan) => {
    const session = plan.sessions.find((item) => item.status === "ready");
    return session ? [{ plan, session }] : [];
  });

  candidates.sort((left, right) => {
    const leftScheduled = new Date(left.session.scheduledFor).getTime();
    const rightScheduled = new Date(right.session.scheduledFor).getTime();
    const leftOverdue = leftScheduled <= now;
    const rightOverdue = rightScheduled <= now;
    if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;

    const leftDeadline = left.plan.deadline ? new Date(left.plan.deadline).getTime() : Number.POSITIVE_INFINITY;
    const rightDeadline = right.plan.deadline ? new Date(right.plan.deadline).getTime() : Number.POSITIVE_INFINITY;
    const leftUrgent = leftDeadline - now <= threeDays;
    const rightUrgent = rightDeadline - now <= threeDays;
    if (leftUrgent !== rightUrgent) return leftUrgent ? -1 : 1;
    if (leftUrgent && leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
    return leftScheduled - rightScheduled;
  });

  return candidates[0]?.plan ?? null;
}

function recommendationReason(plan: LearningPlan, session: LearningPlanSession, now: Date) {
  const scheduled = new Date(session.scheduledFor);
  const scheduledDay = scheduled.toDateString();
  if (scheduled.getTime() <= now.getTime()) {
    return `This is your earliest ready session and it is due ${formatRelativeSchedule(scheduled, now)}.`;
  }

  if (plan.deadline) {
    const deadline = new Date(plan.deadline);
    const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    if (daysRemaining <= 0) return "This goal’s deadline has arrived, so its next ready session takes priority.";
    if (daysRemaining <= 3) return `This goal is due in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}, so its next ready session takes priority.`;
  }

  if (scheduledDay === now.toDateString()) return "This is the earliest ready session scheduled for today across your active goals.";
  return `This is the earliest ready session across your active goals, scheduled for ${formatSessionTime(session.scheduledFor)}.`;
}

function formatRelativeSchedule(scheduled: Date, now: Date) {
  if (scheduled.toDateString() === now.toDateString()) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (scheduled.toDateString() === yesterday.toDateString()) return "yesterday";
  return formatSessionTime(scheduled.toISOString());
}

function formatHomeDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date).toUpperCase();
}

function greetingFor(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function AskBar({ value, onChange, onSubmit, pending = false }: { value: string; onChange: (value: string) => void; onSubmit: () => void; pending?: boolean }) {
  return <form className="ask-bar" onSubmit={(event) => { event.preventDefault(); if (value.trim() && !pending) onSubmit(); }}><Sparkles size={20} /><input aria-label="Ask YOVA" placeholder="Ask YOVA anything or describe what you need…" value={value} disabled={pending} onChange={(event) => onChange(event.target.value)} /><button aria-label="Send" type="submit" disabled={!value.trim() || pending}>{pending ? <span className="button-spinner" /> : <Send size={18} />}</button></form>;
}

function LearningScreen({ plans, detailPlanId, sessionCompletions, sessionInterruptions, onOpenPlan, onClosePlan, onStart, onCreatePlan, onArchiveStateChange, onAdjustPlan, onAttachMaterials }: { plans: LearningPlan[]; detailPlanId: string | null; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; onOpenPlan: (planId: string) => void; onClosePlan: () => void; onStart: (planId: string) => void; onCreatePlan: () => void; onArchiveStateChange: (planId: string, action: "archive" | "restore") => Promise<LearningPlan["status"]>; onAdjustPlan: (input: PlanAdjustmentRequest) => Promise<void>; onAttachMaterials: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [view, setView] = useState<"active" | "recent" | "archive">("active");
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const visiblePlans = plans.filter((plan) => {
    if (view === "active") return plan.status === "active";
    if (view === "recent") return plan.status === "completed";
    return plan.status === "archived";
  });
  const plan = visiblePlans.find((item) => item.id === detailPlanId) ?? null;
  const viewLabels = {
    active: { empty: "No active learning yet.", description: "Start one focused session or create a plan for a larger goal." },
    recent: { empty: "No completed studies yet.", description: "Finished sessions and plans will remain here so you can review what happened." },
    archive: { empty: "Nothing is archived.", description: "Learning items you intentionally put away will appear here." },
  };

  const changeArchiveState = async (planId: string, action: "archive" | "restore") => {
    setChangingPlanId(planId);
    setStatusError(null);
    try {
      const status = await onArchiveStateChange(planId, action);
      onClosePlan();
      if (status === "archived") setView("archive");
      else setView(status === "completed" ? "recent" : "active");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "YOVA could not update that learning goal.");
    } finally {
      setChangingPlanId(null);
    }
  };

  const changeView = (nextView: "active" | "recent" | "archive") => {
    setView(nextView);
    onClosePlan();
  };

  return <div className="page learning-page">
    <div className="learning-index-header"><PageHeader eyebrow="LEARNING" title="What you’re working toward" description="Every goal keeps its plan, materials, sessions, and progress in one place." /><button className="button primary" onClick={onCreatePlan}><Plus size={17} /> New plan</button></div>
    <div className="tabs">
      <button className={view === "active" ? "active" : ""} onClick={() => changeView("active")}>Active <span>{plans.filter((item) => item.status === "active").length}</span></button>
      <button className={view === "recent" ? "active" : ""} onClick={() => changeView("recent")}>Completed <span>{plans.filter((item) => item.status === "completed").length}</span></button>
      <button className={view === "archive" ? "active" : ""} onClick={() => changeView("archive")}>Archive <span>{plans.filter((item) => item.status === "archived").length}</span></button>
    </div>
    {statusError && <div className="chat-error"><AlertCircle size={16} /><span>{statusError}</span></div>}
    {plan ? <LearningPlanDetail plan={plan} view={view} completions={sessionCompletions.filter((completion) => completion.planId === plan.id)} interruptions={sessionInterruptions.filter((interruption) => interruption.planId === plan.id)} changingStatus={changingPlanId === plan.id} onBack={onClosePlan} onStart={() => onStart(plan.id)} onArchiveStateChange={(action) => void changeArchiveState(plan.id, action)} onAdjustPlan={onAdjustPlan} onAttachMaterials={onAttachMaterials} /> : visiblePlans.length ? <LearningOverview plans={visiblePlans} allPlans={plans} view={view} interruptions={sessionInterruptions} onOpenPlan={onOpenPlan} onStart={onStart} /> : <section className="learning-empty"><span className="learning-empty-icon"><LibraryBig size={22} /></span><h2>{viewLabels[view].empty}</h2><p>{viewLabels[view].description}</p>{view === "active" && <button className="button primary" onClick={onCreatePlan}>Create your first plan <ArrowRight size={17} /></button>}</section>}
  </div>;
}

function LearningOverview({ plans, allPlans, view, interruptions, onOpenPlan, onStart }: { plans: LearningPlan[]; allPlans: LearningPlan[]; view: "active" | "recent" | "archive"; interruptions: SessionInterruption[]; onOpenPlan: (planId: string) => void; onStart: (planId: string) => void }) {
  const activeCount = allPlans.filter((plan) => plan.status === "active").length;
  const sessionsAhead = allPlans.filter((plan) => plan.status === "active").reduce((count, plan) => count + plan.sessions.filter((session) => session.status === "ready" || session.status === "upcoming").length, 0);
  const completedCount = allPlans.filter((plan) => plan.status === "completed").length;

  return <>
    <section className="learning-summary" aria-label="Learning overview"><div><span>Active goals</span><strong>{activeCount}</strong></div><div><span>Sessions ahead</span><strong>{sessionsAhead}</strong></div><div><span>Completed goals</span><strong>{completedCount}</strong></div></section>
    <section className="learning-card-grid">{plans.map((plan) => {
      const done = plan.sessions.filter((session) => session.status === "complete").length;
      const readySession = plan.sessions.find((session) => session.status === "ready");
      const resumePoint = readySession ? resumableSessionProgress(readySession.id, interruptions.filter((interruption) => interruption.planId === plan.id)) : null;
      const progress = plan.sessions.length ? Math.round((done / plan.sessions.length) * 100) : 0;
      return <article className="learning-goal-card" key={plan.id}>
        <div className="learning-card-top"><SubjectIcon plan={plan} /><span className="learning-card-kind">{plan.kind}</span><span className={`learning-card-status ${plan.status}`}>{plan.status === "active" ? formatPlanDeadline(plan.deadline) : plan.status}</span></div>
        <div className="learning-card-copy"><h2>{plan.title}</h2><p>{plan.topic}</p></div>
        <div className="learning-card-progress"><div><span style={{ width: `${progress}%` }} /></div><small>{done} of {plan.sessions.length} sessions complete</small></div>
        <div className="learning-card-next"><span>{view === "active" ? "NEXT SESSION" : "PLAN SUMMARY"}</span><strong>{readySession ? readySession.title : plan.status === "completed" ? "Goal completed" : "Saved learning goal"}</strong><small>{readySession ? `${resumePoint ? `Continue at section ${resumePoint.completedSteps + 1}` : formatSessionTime(readySession.scheduledFor)} · ${readySession.estimatedMinutes} min` : `${plan.sessions.length} planned sessions`}</small></div>
        <footer><button className="button secondary" onClick={() => onOpenPlan(plan.id)}>Open goal <ChevronRight size={16} /></button>{view === "active" && readySession && <button className="button primary" onClick={() => onStart(plan.id)}>{resumePoint ? "Continue" : "Start next"}</button>}</footer>
      </article>;
    })}</section>
  </>;
}

function LearningPlanDetail({ plan, view, completions, interruptions, changingStatus, onBack, onStart, onArchiveStateChange, onAdjustPlan, onAttachMaterials }: { plan: LearningPlan; view: "active" | "recent" | "archive"; completions: SessionCompletion[]; interruptions: SessionInterruption[]; changingStatus: boolean; onBack: () => void; onStart: () => void; onArchiveStateChange: (action: "archive" | "restore") => void; onAdjustPlan: (input: PlanAdjustmentRequest) => Promise<void>; onAttachMaterials: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [showAdjustments, setShowAdjustments] = useState(false);
  const completeCount = plan.sessions.filter((session) => session.status === "complete").length;
  const readySession = plan.sessions.find((session) => session.status === "ready");
  const resumePoint = readySession ? resumableSessionProgress(readySession.id, interruptions) : null;
  const totalCorrect = completions.reduce((sum, completion) => sum + completion.correctAnswers, 0);
  const totalChecks = completions.reduce((sum, completion) => sum + completion.totalAnswers, 0);
  const accuracy = totalChecks ? `${Math.round((totalCorrect / totalChecks) * 100)}%` : "No data";
  const conceptSignals = summarizeConceptEvidence(completions);

  return <>
    <button className="learning-back" onClick={onBack}><ArrowLeft size={16} /> All {view === "recent" ? "completed learning" : view === "archive" ? "archived learning" : "active learning"}</button>
    <section className="learning-hero"><div><span className="subject-label">{plan.kind.toUpperCase()} · {formatPlanDeadline(plan.deadline)}</span><h2>{plan.title}</h2><p>{plan.topic}</p><span className="learning-approach-badge">{plan.learningIntent === "learn" ? <BookOpen size={14} /> : <Target size={14} />}{plan.learningIntent === "learn" ? "Building understanding, then practice" : "Practice, diagnose, and repair"}</span><div className="progress-line"><div style={{ width: `${(completeCount / plan.sessions.length) * 100}%` }} /></div><small>{resumePoint ? `${resumePoint.completedSteps} of ${resumePoint.totalSteps} sections saved in the current session` : `${completeCount} of ${plan.sessions.length} sessions complete`}</small></div><div className="learning-hero-actions">{view === "active" && readySession && <button className="button primary" onClick={onStart}>{resumePoint ? "Continue session" : "Start next session"}</button>}{view === "active" && <button className="button hero-secondary" onClick={() => setShowAdjustments((value) => !value)}><Settings2 size={16} /> {showAdjustments ? "Close" : "Adjust"}</button>}<button className="button hero-secondary" disabled={changingStatus} onClick={() => onArchiveStateChange(view === "archive" ? "restore" : "archive")}>{changingStatus ? <span className="button-spinner" /> : view === "archive" ? <><RotateCcw size={16} /> Restore</> : <><Archive size={16} /> Archive</>}</button></div></section>
    {view === "active" && showAdjustments && <PlanAdjustmentPanel plan={plan} onCancel={() => setShowAdjustments(false)} onSave={async (input) => { await onAdjustPlan(input); setShowAdjustments(false); }} />}
    {view === "recent" && <section className="learning-history-summary"><div><span>Completed</span><strong>{formatCompletionDate(completions.at(-1)?.completedAt ?? plan.createdAt)}</strong></div><div><span>Knowledge-check accuracy</span><strong>{accuracy}</strong></div><div><span>Last session felt</span><strong>{formatFeedback(completions.at(-1)?.feedback)}</strong></div></section>}
    <section className="section-block plan-timeline"><div className="section-title"><div><h3>{view === "recent" ? "What you completed" : "Your plan"}</h3><p>The sequence YOVA will guide you through, one session at a time.</p></div><span>{plan.sessions.length} sessions</span></div><div className="timeline">{plan.sessions.map((session) => <div className={`timeline-row ${session.status}`} key={session.id}><span className="timeline-node">{session.status === "complete" ? <Check size={15} /> : null}</span><div><strong>{session.title}</strong><small><b>{session.learningMode === "learn" ? "Teaching first" : "Practice first"}</b> · {session.method} · {formatSessionTime(session.scheduledFor)}</small></div><span>{session.estimatedMinutes} min</span></div>)}</div></section>
    <PlanAdaptations plan={plan} />
    <PlanSources plan={plan} editable={view === "active"} onAttach={onAttachMaterials} />
    <PlanResources plan={plan} />
    <ConceptSignalsPanel signals={conceptSignals} />
  </>;
}

function PlanAdaptations({ plan }: { plan: LearningPlan }) {
  const adaptedSessions = plan.sessions.filter((session) => session.adaptationNote);
  if (!adaptedSessions.length) return null;

  return <section className="section-block plan-adaptations"><div className="section-title"><div><h3>How YOVA adapted this plan</h3><p>Only changes supported by a completed session appear here.</p></div><span>{adaptedSessions.length} evidence-based {adaptedSessions.length === 1 ? "change" : "changes"}</span></div><div className="adaptation-list">{adaptedSessions.map((session) => <article key={session.id}><span><Sparkles size={16} /></span><div><strong>{session.title}</strong><p>{session.adaptationNote?.explanation}</p><small>Adjusted {formatCompletionDate(session.adaptationNote?.adaptedAt ?? session.scheduledFor)}</small></div></article>)}</div></section>;
}

function PlanResources({ plan }: { plan: LearningPlan }) {
  const available = plan.sessions.filter((session) => session.resource && session.resource.activities.some((activity) => activity.type !== "reflection"));

  if (!available.length) {
    return <section className="section-block plan-resources"><div className="section-title"><div><h3>Study resources</h3><p>Reusable explanations and practice, attached to the session that needed them.</p></div><span>Created when relevant</span></div><div className="resource-empty"><Sparkles size={18} /><div><strong>Nothing extra to browse yet</strong><p>YOVA creates the teaching and practice needed for a session when you first start it. Those resources will stay here afterward.</p></div></div></section>;
  }

  return <section className="section-block plan-resources"><div className="section-title"><div><h3>Study resources</h3><p>These came from the sessions YOVA selected for this goal, not from a generic tool list.</p></div><span>{available.length} {available.length === 1 ? "pack" : "packs"} ready</span></div><div className="resource-pack-list">{available.map((session) => {
    const resource = session.resource as SessionResource;
    const teachingCount = resource.activities.filter((activity) => activity.type === "instruction").length;
    const practiceCount = resource.activities.filter((activity) => activity.type === "multiple_choice" || activity.type === "free_response").length;
    return <details className="resource-pack" key={session.id}><summary><div><span>{session.method}</span><strong>{session.title}</strong></div><small>{teachingCount ? `${teachingCount} teaching` : ""}{teachingCount && practiceCount ? " · " : ""}{practiceCount ? `${practiceCount} practice` : ""}</small></summary><div className="resource-pack-content"><p className="resource-rationale">{resource.rationale}</p>{resource.activities.filter((activity) => activity.type !== "reflection").map((activity, index) => <ResourceActivityCard activity={activity} key={`${activity.title}-${index}`} />)}</div></details>;
  })}</div></section>;
}

function ResourceActivityCard({ activity }: { activity: SessionResourceActivity }) {
  const isQuestion = activity.type === "multiple_choice" || activity.type === "free_response";
  const phase = activity.methodPhase ? getMethodPhasePresentation(activity.methodPhase) : null;
  return <article className={isQuestion ? "resource-activity resource-practice" : "resource-activity resource-note"}><span className="resource-activity-label">{phase?.label ?? (isQuestion ? activity.type === "multiple_choice" ? "Knowledge check" : "Active recall" : activity.label)}</span><h4><LearningContent content={activity.title} inline /></h4>{activity.teaching ? <TeachingLessonCard teaching={activity.teaching} /> : <LearningContent content={activity.body} className="resource-activity-body" />}{phase && <small className="resource-phase-purpose">{phase.instruction}</small>}{activity.choices.length > 0 && <ol className="resource-choices">{activity.choices.map((choice) => <li key={choice}><LearningContent content={choice} inline /></li>)}</ol>}{isQuestion && activity.correctAnswer && <details className="resource-answer"><summary>Show answer</summary><LearningContent content={activity.correctAnswer} />{activity.feedback && <LearningContent content={activity.feedback} className="resource-answer-feedback" />}</details>}</article>;
}

function ConceptSignalsPanel({ signals }: { signals: ConceptSignal[] }) {
  if (!signals.length) return null;
  const visibleSignals = signals.slice(0, 8);
  const reviewByConcept = new Map(buildConceptReviewSchedule(signals).map((review) => [
    review.concept.toLocaleLowerCase(),
    review,
  ]));
  return <section className="section-block concept-signals"><div className="section-title"><div><h3>Concept review schedule</h3><p>YOVA uses completed checks to decide what should return sooner, later, or only briefly.</p></div><span>{signals.length} observed</span></div><div className="concept-signal-list">{visibleSignals.map((signal) => { const review = reviewByConcept.get(signal.concept.toLocaleLowerCase()); return <div className={signal.status} key={signal.concept.toLocaleLowerCase()}><span>{signal.status === "needs_review" ? <AlertCircle size={16} /> : <Check size={16} />}</span><div><strong>{signal.concept}</strong><small>{formatConceptSignal(signal)}</small></div><em className={review?.timing === "due" ? "review-due" : ""}>{review?.timingLabel ?? "Collecting evidence"}</em></div>; })}</div>{signals.length > visibleSignals.length && <small className="concept-signal-overflow">{signals.length - visibleSignals.length} more signals will be considered when YOVA builds future sessions.</small>}<small className="concept-review-note">These are transparent review intervals, not predictions that a concept is permanently mastered. Another completed check can move the next return.</small></section>;
}

function formatConceptSignal(signal: ConceptSignal) {
  if (signal.attempts === 1) return signal.lastOutcome === "secure" ? "Secure in the first observed check" : "Needs another attempt after the first check";
  return `${signal.secureAttempts} secure ${signal.secureAttempts === 1 ? "check" : "checks"} across ${signal.attempts} attempts`;
}

function PlanSources({ plan, editable, onAttach }: { plan: LearningPlan; editable: boolean; onAttach: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const materials = plan.materials ?? [];
  const atLimit = materials.length >= 5;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    const { accepted, errors } = await uploadMaterialFiles(Array.from(files), materials);

    if (accepted.length) {
      try {
        await onAttach(plan.id, accepted.map((material) => material.id));
      } catch (attachError) {
        await Promise.allSettled(accepted.map((material) => deleteUploadedMaterial(material.id)));
        setError(attachError instanceof Error ? attachError.message : "YOVA could not attach those materials.");
      }
    }
    if (errors.length) setError(errors[0]);
    setAdding(false);
  };

  const addLinkedSource = async (material: LearningMaterial, materialNotice: string | null) => {
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      await onAttach(plan.id, [material.id]);
      setNotice(materialNotice);
    } catch (attachError) {
      await deleteUploadedMaterial(material.id).catch(() => undefined);
      setError(attachError instanceof Error ? attachError.message : "YOVA could not attach that source.");
    } finally {
      setAdding(false);
    }
  };

  return <section className="section-block plan-sources"><div className="section-title"><h3>Learning source</h3><div className="source-heading-actions"><span>{plan.sourceMode === "user_materials" ? `${materials.length} uploaded` : "Created by YOVA"}</span>{editable && !atLimit && <label className={`button source-upload ${adding ? "disabled" : ""}`}><Upload size={15} /> {adding ? "Processing…" : "Add files"}<input aria-label="Add source materials" type="file" multiple accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" disabled={adding} onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label>}</div></div>{materials.length ? <div className="source-material-list">{materials.map((material) => <div key={material.id}><FileText size={18} /><span><strong>{material.name}</strong><small>{formatFileSize(material.sizeBytes)} · Private source for this goal</small></span><span className="data-badge">Ready</span></div>)}</div> : plan.sourceMode === "user_materials" ? <div className="source-empty"><AlertCircle size={17} /><p>This goal expects uploaded sources, but their metadata could not be loaded. Guided sessions will stop rather than silently inventing source content.</p></div> : <div className="source-created"><Sparkles size={18} /><div><strong>YOVA-generated learning content</strong><p>Explanations, questions, and practice are created from the goal. You can add private sources later.</p></div></div>}{editable && !atLimit && <MaterialLinkImporter existingCount={materials.length} disabled={adding} onImported={(material, materialNotice) => { void addLinkedSource(material, materialNotice); }} />}{atLimit && editable && <p className="source-limit">This goal has reached the five-material limit for the private alpha.</p>}{notice && <p className="material-notice"><AlertCircle size={15} /> {notice}</p>}{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}</section>;
}

function PlanAdjustmentPanel({ plan, onCancel, onSave }: { plan: LearningPlan; onCancel: () => void; onSave: (input: PlanAdjustmentRequest) => Promise<void> }) {
  const firstUnfinished = plan.sessions.find((session) => session.status === "ready" || session.status === "upcoming");
  const [deadlineDate, setDeadlineDate] = useState(plan.deadline ? localDateInput(plan.deadline) : "");
  const [minutes, setMinutes] = useState(firstUnfinished?.estimatedMinutes ?? 25);
  const [studyMode, setStudyMode] = useState(plan.studyMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unfinishedCount = plan.sessions.filter((session) => session.status === "ready" || session.status === "upcoming").length;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        planId: plan.id,
        deadline: deadlineDate ? new Date(`${deadlineDate}T23:59:00`).toISOString() : null,
        studyMode,
        futureSessionMinutes: minutes,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "YOVA could not adjust this plan.");
      setSaving(false);
    }
  };

  return <section className="plan-adjustment-panel"><div className="plan-adjustment-heading"><div><span className="step-label">ADJUST UNFINISHED WORK</span><h3>Change the plan without losing content</h3><p>YOVA will re-slice the unfinished content to fit the new window. Shorter windows can create more sessions; finished sessions stay exactly as they are.</p></div></div><div className="plan-adjustment-grid"><label><span>Target date</span><input type="date" min={localDateInput(new Date().toISOString())} value={deadlineDate} disabled={saving} onChange={(event) => setDeadlineDate(event.target.value)} /><small>Optional. Agenda times are changed separately.</small></label><label><span>Future session window</span><select value={minutes} disabled={saving} onChange={(event) => setMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={25}>25 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select><small>Time controls the size of each content slice, not whether it counts as complete.</small></label></div><div className="adjustment-content-rule"><Target size={18} /><div><strong>Content stays primary</strong><p>The current {unfinishedCount} unfinished {unfinishedCount === 1 ? "session" : "sessions"} may become a different number of focused sessions. A session finishes only after its required content checks are attempted.</p></div></div><div className="adjustment-mode"><span>Where should future sessions happen?</span><div><button className={studyMode === "inside_yova" ? "selected" : ""} disabled={saving} onClick={() => setStudyMode("inside_yova")}><BookOpen size={17} /><strong>Inside YOVA</strong><small>Teaching, questions, and feedback in the app</small></button><button className={studyMode === "outside_yova" ? "selected" : ""} disabled={saving} onClick={() => setStudyMode("outside_yova")}><LibraryBig size={17} /><strong>Outside YOVA</strong><small>Exact instructions for another source or workspace</small></button></div></div>{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}<footer><button className="button ghost" disabled={saving} onClick={onCancel}>Cancel</button><button className="button primary" disabled={saving || unfinishedCount === 0} onClick={() => void save()}>{saving ? <span className="button-spinner" /> : <><Check size={16} /> Rebuild unfinished plan</>}</button></footer></section>;
}

function AgendaScreen({ plans, sessionCompletions, sessionInterruptions, previewMode, onStart, onActivateReview, onReschedule, onAdjustDuration }: { plans: LearningPlan[]; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; previewMode: boolean; onStart: (planId?: string) => void; onActivateReview: (item: ConceptReviewAgendaItem) => Promise<void>; onReschedule: (planId: string, planSessionId: string, scheduledFor: string) => void; onAdjustDuration: (planSessionId: string, estimatedMinutes: number) => Promise<void> }) {
  const [moving, setMoving] = useState<{ planId: string; sessionId: string } | null>(null);
  const [customTime, setCustomTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<"shorten" | "move" | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [reviewAction, setReviewAction] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [balanceAction, setBalanceAction] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [todayCapacity, setTodayCapacity] = useState<number | null>(null);
  const [capacityAction, setCapacityAction] = useState<"move" | "split" | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const conceptReviews = buildConceptReviewAgenda(plans, sessionCompletions);
  const availableSessions = plans
    .flatMap((plan) => plan.sessions.filter((session) => session.status !== "complete" && session.status !== "skipped").map((session) => ({ plan, session })))
    .sort((a, b) => new Date(a.session.scheduledFor).getTime() - new Date(b.session.scheduledFor).getTime());
  const overdueEntry = availableSessions.find(({ session }) => session.status === "ready" && isSessionOverdue(session.scheduledFor)) ?? null;
  const recoveryMinutes = overdueEntry ? recoverySessionMinutes(overdueEntry.session.estimatedMinutes) : null;
  const movingEntry = moving
    ? availableSessions.find(({ plan, session }) => plan.id === moving.planId && session.id === moving.sessionId) ?? null
    : null;
  const agendaSummary = summarizeAgenda(availableSessions, plans);
  const dayGroups = buildAgendaDayGroups(availableSessions);
  const balanceSuggestion = buildAgendaBalanceSuggestion(availableSessions);
  const capacityPlan = todayCapacity === null ? null : buildDailyCapacityPlan(availableSessions, todayCapacity);
  const showBalanceSuggestion = balanceSuggestion
    && (todayCapacity === null || balanceSuggestion.fromDateKey !== localDateKey(new Date()));

  const openMove = (planId: string, sessionId: string, scheduledFor: string) => {
    setMoving({ planId, sessionId });
    setCustomTime(toLocalDateTimeInput(scheduledFor));
    setError(null);
  };

  const rescheduleEntry = async (entry: AgendaEntry, scheduledFor: string) => {
    if (previewMode) {
      onReschedule(entry.plan.id, entry.session.id, scheduledFor);
      return;
    }
    const response = await fetch("/api/sessions/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSessionId: entry.session.id, scheduledFor }),
      });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "YOVA could not move that session.";
      throw new Error(message);
    }
    const parsed = RescheduleSessionResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The new session time came back in an unsafe format.");
    onReschedule(entry.plan.id, parsed.data.planSessionId, parsed.data.scheduledFor);
  };

  const saveMove = async (scheduledFor: string) => {
    if (!movingEntry || saving) return;
    setSaving(true);
    setError(null);
    try {
      await rescheduleEntry(movingEntry, scheduledFor);
      setMoving(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "YOVA could not move that session.");
    } finally {
      setSaving(false);
    }
  };

  const shortenAndStart = async () => {
    if (!overdueEntry || recoveryMinutes === null || recoveryAction) return;
    setRecoveryAction("shorten");
    setRecoveryError(null);
    try {
      await onAdjustDuration(overdueEntry.session.id, recoveryMinutes);
      onStart(overdueEntry.plan.id);
    } catch (requestError) {
      setRecoveryError(requestError instanceof Error ? requestError.message : "YOVA could not shorten that session.");
      setRecoveryAction(null);
    }
  };

  const moveOverdueToTomorrow = async () => {
    if (!overdueEntry || recoveryAction) return;
    setRecoveryAction("move");
    setRecoveryError(null);
    try {
      await rescheduleEntry(overdueEntry, tomorrowAtSessionTime(overdueEntry.session.scheduledFor));
    } catch (requestError) {
      setRecoveryError(requestError instanceof Error ? requestError.message : "YOVA could not move that session.");
    } finally {
      setRecoveryAction(null);
    }
  };

  const beginConceptReview = async (item: ConceptReviewAgendaItem) => {
    if (item.action === "scheduled" || reviewAction) return;
    setReviewAction(`${item.planId}:${item.concept.toLocaleLowerCase()}`);
    setReviewError(null);
    try {
      await onActivateReview(item);
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "YOVA could not start that concept review.");
      setReviewAction(null);
    }
  };

  const applyBalanceSuggestion = async () => {
    if (!balanceSuggestion || balanceAction) return;
    setBalanceAction(true);
    setBalanceError(null);
    try {
      await rescheduleEntry(balanceSuggestion.entry, balanceSuggestion.scheduledFor);
    } catch (requestError) {
      setBalanceError(requestError instanceof Error ? requestError.message : "YOVA could not rebalance that session.");
    } finally {
      setBalanceAction(false);
    }
  };

  const applyCapacityMove = async () => {
    if (capacityPlan?.status !== "move" || !capacityPlan.entry || !capacityPlan.scheduledFor || capacityAction) return;
    setCapacityAction("move");
    setCapacityError(null);
    try {
      await rescheduleEntry(capacityPlan.entry, capacityPlan.scheduledFor);
    } catch (requestError) {
      setCapacityError(requestError instanceof Error ? requestError.message : "YOVA could not adjust today's schedule.");
    } finally {
      setCapacityAction(null);
    }
  };

  const applyCapacitySplit = async () => {
    if (capacityPlan?.status !== "split" || !capacityPlan.entry || capacityPlan.splitMinutes === null || capacityAction) return;
    setCapacityAction("split");
    setCapacityError(null);
    try {
      await onAdjustDuration(capacityPlan.entry.session.id, capacityPlan.splitMinutes);
    } catch (requestError) {
      setCapacityError(requestError instanceof Error ? requestError.message : "YOVA could not split that learning content.");
    } finally {
      setCapacityAction(null);
    }
  };

  return <div className="page">
    <PageHeader eyebrow="AGENDA" title="A realistic learning week" description="See the work across every goal, protect your deadlines, and let YOVA flag a schedule that is becoming unrealistic." />
    <section className="agenda-overview" aria-label="Agenda overview">
      <article className={agendaSummary.todayMinutes > 75 || agendaSummary.todaySessions >= 3 ? "attention" : "primary"}><span><Clock3 size={18} /> Today</span><strong>{agendaSummary.todayMinutes} min</strong><small>{agendaSummary.todaySessions ? `${agendaSummary.todaySessions} planned ${agendaSummary.todaySessions === 1 ? "session" : "sessions"}` : "No session scheduled"}</small></article>
      <article><span><CalendarDays size={18} /> Next 7 days</span><strong>{agendaSummary.weekMinutes} min</strong><small>{agendaSummary.weekSessions} planned {agendaSummary.weekSessions === 1 ? "session" : "sessions"}</small></article>
      <article><span><Target size={18} /> Next deadline</span><strong>{agendaSummary.nextDeadline ? shortDeadlineDate(agendaSummary.nextDeadline.date) : "Flexible"}</strong><small>{agendaSummary.nextDeadline?.plan.title ?? "No fixed deadline"}</small></article>
      <article><span><BookOpen size={18} /> Active goals</span><strong>{agendaSummary.activeGoals}</strong><small>Combined into one agenda</small></article>
    </section>
    <section className="agenda-planning-basis"><Sparkles size={18} /><div><strong>What YOVA is planning around</strong><p>Session order, selected availability, deadlines, unfinished work, and concept reviews. You stay in control of every proposed move.</p></div></section>
    <section className="agenda-capacity-planner" aria-label="Plan around today's available time">
      <div className="agenda-capacity-heading"><span className="agenda-capacity-icon"><Clock3 size={20} /></span><div><span className="step-label">TODAY’S REALITY</span><h2>How much time do you actually have today?</h2><p>YOVA will protect urgent work, preserve the learning sequence, and carry unfinished content forward. Time changes the shape of the plan, not what you still need to learn.</p></div></div>
      <div className="agenda-capacity-options" role="group" aria-label="Available learning time today">{[15, 30, 45, 60, 90].map((minutes) => <button key={minutes} type="button" aria-pressed={todayCapacity === minutes} aria-label={`I have ${minutes} minutes today`} onClick={() => { setTodayCapacity(minutes); setCapacityError(null); }}>{minutes}<small>min</small></button>)}</div>
      {capacityPlan && <div className={`agenda-capacity-result ${capacityPlan.status}`} aria-live="polite">
        <div>
          <span>{capacityPlan.status === "fits" ? "TODAY ALREADY FITS" : capacityPlan.status === "empty" ? "NO CHANGE NEEDED" : capacityPlan.status === "blocked" ? "YOUR CHOICE IS NEEDED" : "YOVA RECOMMENDS"}</span>
          {capacityPlan.status === "move" && capacityPlan.entry && capacityPlan.toDateKey && <><strong>Move {capacityPlan.entry.session.title} to {agendaDateLabel(capacityPlan.toDateKey)}</strong><p>Today drops from {capacityPlan.todayMinutes} to {capacityPlan.projectedMinutes} minutes. {capacityPlan.reason}</p></>}
          {capacityPlan.status === "split" && capacityPlan.entry && capacityPlan.splitMinutes !== null && <><strong>Split {capacityPlan.entry.plan.title} into {capacityPlan.splitMinutes}-minute content blocks</strong><p>Today drops from {capacityPlan.todayMinutes} to {capacityPlan.projectedMinutes} minutes. No content is marked complete or deleted. {capacityPlan.reason}</p></>}
          {(capacityPlan.status === "fits" || capacityPlan.status === "empty" || capacityPlan.status === "blocked") && <><strong>{capacityPlan.status === "fits" ? `${capacityPlan.todayMinutes} minutes of content fits your ${capacityPlan.capacityMinutes}-minute window` : capacityPlan.status === "empty" ? "Your day is open for learning" : "YOVA will not make an unsafe automatic change"}</strong><p>{capacityPlan.reason}</p></>}
        </div>
        {capacityPlan.status === "move" && <button className="button primary" disabled={Boolean(capacityAction)} onClick={() => void applyCapacityMove()}>{capacityAction === "move" ? <><span className="button-spinner" /> Moving</> : "Approve move"}</button>}
        {capacityPlan.status === "split" && <button className="button primary" disabled={Boolean(capacityAction)} onClick={() => void applyCapacitySplit()}>{capacityAction === "split" ? <><span className="button-spinner" /> Rebuilding</> : "Approve content split"}</button>}
      </div>}
      {capacityError && <div className="chat-error"><AlertCircle size={16} /><span>{capacityError}</span></div>}
    </section>
    {showBalanceSuggestion && <section className="agenda-balance-card" aria-live="polite"><span className="agenda-balance-icon"><Sparkles size={20} /></span><div><span className="step-label">YOVA RECOMMENDS</span><h2>Make {agendaDateLabel(balanceSuggestion.fromDateKey)} more realistic</h2><p>Move <strong>{balanceSuggestion.entry.session.title}</strong> to {agendaDateLabel(balanceSuggestion.toDateKey)}. The original day drops from {balanceSuggestion.beforeMinutes} to {balanceSuggestion.afterMinutes} minutes, and the new day becomes {balanceSuggestion.targetMinutes} minutes.</p><small>{balanceSuggestion.reason}</small></div><button className="button primary" disabled={balanceAction} onClick={() => void applyBalanceSuggestion()}>{balanceAction ? <><span className="button-spinner" /> Rebalancing</> : "Approve move"}</button>{balanceError && <div className="chat-error"><AlertCircle size={16} /><span>{balanceError}</span></div>}</section>}
    {overdueEntry && <section className="agenda-recovery" aria-live="polite"><div className="agenda-recovery-copy"><span className="step-label">PLAN NEEDS A RESET</span><h2>You missed a session. The plan is still recoverable.</h2><p><strong>{overdueEntry.session.title}</strong> for {overdueEntry.plan.title} was scheduled for {formatAgendaTime(overdueEntry.session.scheduledFor)}. Choose the smallest useful next move. YOVA will not punish the rest of the plan.</p></div><div className="agenda-recovery-actions"><button className="button primary" disabled={Boolean(recoveryAction)} onClick={() => onStart(overdueEntry.plan.id)}>Start it now</button>{recoveryMinutes !== null && recoveryMinutes < overdueEntry.session.estimatedMinutes && <button className="button secondary" disabled={Boolean(recoveryAction)} onClick={() => void shortenAndStart()}>{recoveryAction === "shorten" ? <span className="button-spinner dark" /> : null} Split remaining work into {recoveryMinutes}-min sessions</button>}<button className="button ghost" disabled={Boolean(recoveryAction)} onClick={() => void moveOverdueToTomorrow()}>{recoveryAction === "move" ? <span className="button-spinner dark" /> : null} Move to tomorrow</button></div>{recoveryError && <div className="chat-error"><AlertCircle size={16} /><span>{recoveryError}</span></div>}</section>}
    <section className="section-block agenda-schedule">
      <div className="section-title"><div><h3>Your learning schedule</h3><p>Each day shows the actual amount of planned work, not just calendar events.</p></div><span>Next 14 days</span></div>
      {dayGroups.length ? <div className="agenda-day-groups">{dayGroups.map((group) => <section className={`agenda-day ${group.load}`} key={group.dateKey}><header><div><span>{agendaDayEyebrow(group.date)}</span><h4>{agendaFullDate(group.date)}</h4></div><span className="agenda-load"><strong>{group.totalMinutes} min</strong><small>{group.entries.length} {group.entries.length === 1 ? "session" : "sessions"}</small></span></header><div>{group.entries.map(({ plan, session }) => { const resumePoint = resumableSessionProgress(session.id, sessionInterruptions); const overdue = session.status === "ready" && isSessionOverdue(session.scheduledFor); return <article className={`${session.status === "ready" ? "ready" : ""} ${overdue ? "overdue" : ""}`} key={session.id}><SubjectIcon plan={plan} compact /><div className="agenda-session-copy"><span>{overdue ? "Overdue" : formatAgendaClock(session.scheduledFor)} · {session.learningMode === "learn" ? "Learn" : "Practice"}</span><strong>{session.title}</strong><small>{plan.title} · {session.method} · {session.estimatedMinutes} min{resumePoint ? ` · Continue at section ${resumePoint.completedSteps + 1}` : ""}</small></div><div className="agenda-session-actions">{session.status === "ready" && <button className="button primary" onClick={() => onStart(plan.id)}>{resumePoint ? "Continue" : "Start"}</button>}<button className="button ghost" onClick={() => openMove(plan.id, session.id, session.scheduledFor)}>Move</button></div></article>; })}</div></section>)}</div> : <div className="agenda-empty"><CalendarDays size={22} /><strong>Your schedule is clear</strong><p>Create a plan or focused session and YOVA will organize the work here.</p></div>}
    </section>
    {movingEntry && <section className="agenda-move-panel" aria-live="polite"><div><span className="step-label">MOVE SESSION</span><h3>{movingEntry.session.title}</h3><p>Choose a new time. The learning order and session content will stay the same.</p></div><div className="agenda-quick-times"><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 1))} disabled={saving}>Tomorrow</button><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 2))} disabled={saving}>In two days</button><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 7))} disabled={saving}>Next week</button></div><label><span>Custom date and time</span><input type="datetime-local" min={toLocalDateTimeInput(new Date().toISOString())} value={customTime} disabled={saving} onChange={(event) => setCustomTime(event.target.value)} /></label>{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}<footer><button className="button ghost" onClick={() => { setMoving(null); setError(null); }} disabled={saving}>Cancel</button><button className="button primary" onClick={() => { const date = new Date(customTime); if (Number.isNaN(date.getTime())) { setError("Choose a valid date and time."); return; } void saveMove(date.toISOString()); }} disabled={!customTime || saving}>{saving ? <span className="button-spinner" /> : "Save new time"}</button></footer></section>}
    {conceptReviews.length > 0 && <section className="section-block review-agenda"><div className="section-title"><div><h3>Retrieval queue</h3><p>Concepts return when completed checks show that another attempt would be useful.</p></div><span>{conceptReviews.filter((item) => item.timing === "due").length} due</span></div><div className="review-agenda-list">{conceptReviews.slice(0, 6).map((item) => { const actionKey = `${item.planId}:${item.concept.toLocaleLowerCase()}`; const loading = reviewAction === actionKey; return <article className={`${item.priority} ${item.timing}`} key={actionKey}><span className="review-agenda-icon">{item.reviewType === "repair_and_retrieve" ? <RotateCcw size={17} /> : <Target size={17} />}</span><div><span>{formatReviewType(item.reviewType)} · {item.timingLabel}</span><strong>{item.concept}</strong><small>{item.planTitle} · {item.instruction}</small></div>{item.action === "scheduled" ? <em>Scheduled</em> : <button className={item.action === "activate_review" ? "button primary" : "button secondary"} disabled={Boolean(reviewAction)} onClick={() => void beginConceptReview(item)}>{loading ? <span className="button-spinner dark" /> : null}{item.action === "activate_review" ? "Start short check" : "Start next session"}</button>}</article>; })}</div><small className="concept-review-note">These return dates are transparent review heuristics. A new completed check can move the next return sooner or later.</small>{reviewError && <div className="chat-error"><AlertCircle size={16} /><span>{reviewError}</span></div>}</section>}
  </div>;
}

function AskScreen({ plans, question, onQuestion, onApplyAction, analyticsEnabled }: { plans: LearningPlan[]; question: string; onQuestion: (question: string) => void; onApplyAction: (action: TutorProposedAction) => Promise<void>; analyticsEnabled: boolean }) {
  const [contextPlanId, setContextPlanId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [threads, setThreads] = useState<TutorThreadSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [outgoingQuestion, setOutgoingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposedAction, setProposedAction] = useState<TutorProposedAction | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "applying" | "applied">("idle");
  const plan = contextPlanId ? plans.find((item) => item.id === contextPlanId) ?? null : null;
  const selectablePlans = plans.filter((item) => item.status !== "archived");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/tutor?mode=threads", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
            ? body.error
            : "YOVA could not load your previous conversations.";
          throw new Error(message);
        }
        const parsed = TutorThreadListResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("The saved conversation list was not in a safe format.");
        setThreads(parsed.data.threads);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setHistoryError(requestError instanceof Error ? requestError.message : "YOVA could not load your previous conversations.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, []);

  const resetConversation = (nextPlanId: string | null = contextPlanId) => {
    setContextPlanId(nextPlanId);
    setThreadId(null);
    setMessages([]);
    setOutgoingQuestion(null);
    setError(null);
    setProposedAction(null);
    setActionStatus("idle");
    onQuestion("");
  };

  const refreshThreadHistory = async () => {
    try {
      const response = await fetch("/api/tutor?mode=threads", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error("YOVA could not refresh your previous conversations.");
      const parsed = TutorThreadListResponseSchema.safeParse(body);
      if (parsed.success) setThreads(parsed.data.threads);
    } catch {
      // The open conversation is still usable if the history index cannot refresh.
    }
  };

  const openSavedThread = async (thread: TutorThreadSummary) => {
    if (threadLoading || sending) return;
    setThreadLoading(true);
    setHistoryError(null);
    setError(null);
    try {
      const response = await fetch(`/api/tutor?threadId=${encodeURIComponent(thread.id)}`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not open that conversation.";
        throw new Error(message);
      }
      const parsed = TutorHistoryResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The saved tutor conversation was not in a safe format.");
      const linkedPlan = thread.learningItemId
        ? plans.find((item) => item.learningItemId === thread.learningItemId) ?? null
        : null;
      setContextPlanId(linkedPlan?.id ?? null);
      setThreadId(parsed.data.threadId);
      setMessages(parsed.data.messages);
      setProposedAction(null);
      setActionStatus("idle");
      onQuestion("");
      setHistoryOpen(false);
    } catch (requestError) {
      setHistoryError(requestError instanceof Error ? requestError.message : "YOVA could not open that conversation.");
    } finally {
      setThreadLoading(false);
    }
  };

  const sendQuestion = async (suggestedQuestion?: string) => {
    const nextQuestion = (suggestedQuestion ?? question).trim();
    if (!nextQuestion || sending || threadLoading) return;

    setSending(true);
    setOutgoingQuestion(nextQuestion);
    setError(null);
    setProposedAction(null);
    setActionStatus("idle");
    onQuestion("");
    trackProductEvent({
      eventName: "tutor_message_sent",
      context: { linkedToPlan: Boolean(plan), surface: "ask_yova" },
    }, analyticsEnabled);

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: nextQuestion,
          planId: plan?.id ?? null,
          threadId,
          history: messages.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "Ask YOVA could not answer right now.";
        throw new Error(message);
      }

      const parsed = TutorResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The tutor answer came back in an unsafe format.");
      setThreadId(parsed.data.persistence === "supabase" ? parsed.data.threadId : null);
      setMessages((current) => [...current, ...parsed.data.messages]);
      setProposedAction(parsed.data.proposedAction);
      void refreshThreadHistory();
      if (parsed.data.persistence === "browser") {
        setError("The answer worked, but this exchange did not reach cloud storage. Keep this page open if you need it.");
      }
    } catch (requestError) {
      reportProductError({ surface: "tutor", errorCode: "tutor_request_failed" });
      onQuestion(nextQuestion);
      setError(requestError instanceof Error ? requestError.message : "Ask YOVA could not answer right now.");
    } finally {
      setOutgoingQuestion(null);
      setSending(false);
    }
  };

  const approveAction = async () => {
    if (!proposedAction || actionStatus !== "idle") return;
    setActionStatus("applying");
    setError(null);
    try {
      await onApplyAction(proposedAction);
      setActionStatus("applied");
    } catch (requestError) {
      setActionStatus("idle");
      setError(requestError instanceof Error ? requestError.message : "YOVA could not apply that change.");
    }
  };

  const suggestedPrompts = plan
    ? ["Explain the current topic simply", "Quiz me on my weakest area", "Why is this method next?", "I only have 15 minutes today"]
    : ["Help me understand a difficult topic", "Quiz me on something I am learning", "Which study method should I use?", "Help me start a 20-minute study session"];

  return <div className="page ask-page"><PageHeader eyebrow="ASK YOVA" title="Get help in context" description="Start general, or connect a learning goal when YOVA needs its materials and progress." /><div className="ask-toolbar"><label className="tutor-context-select"><span>Context</span><div><BookOpen size={16} /><select aria-label="Ask YOVA context" value={contextPlanId ?? "general"} disabled={sending || threadLoading} onChange={(event) => resetConversation(event.target.value === "general" ? null : event.target.value)}><option value="general">General</option>{selectablePlans.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div></label><div className="ask-toolbar-actions"><button className="button secondary" disabled={sending || threadLoading} onClick={() => resetConversation()}><MessageSquarePlus size={16} /> New chat</button><button className="button secondary" aria-expanded={historyOpen} onClick={() => setHistoryOpen(true)}><History size={16} /> History{threads.length > 0 ? <span>{threads.length}</span> : null}</button></div></div><section className="ask-context-banner">{plan ? <><SubjectIcon plan={plan} compact /><div><span>Using learning context</span><strong>{plan.title}</strong><small>YOVA can use this goal&apos;s materials, next session, and learner evidence.</small></div></> : <><span className="general-context-icon"><Sparkles size={18} /></span><div><span>General conversation</span><strong>No learning goal attached</strong><small>Choose a goal above only when its specific context would help.</small></div></>}</section><div className="chat-space">{threadLoading ? <div className="chat-loading"><span className="button-spinner dark" /> Opening conversation…</div> : <div className="chat-thread">{messages.length === 0 && <div className="yova-message welcome"><BrandMark compact /><div><strong>YOVA</strong><p>{plan ? `What would you like help with in ${plan.title}? I can use its learning context without changing the plan unless you approve it.` : "What would you like help with? This is a fresh general conversation. You can attach a learning goal at any time."}</p></div></div>}{messages.map((message) => message.role === "assistant" ? <div className="yova-message" key={message.id}><BrandMark compact /><div><strong>YOVA</strong><TutorMessageContent content={message.content} /></div></div> : <div className="user-message" key={message.id}><strong>You</strong><p>{message.content}</p></div>)}{outgoingQuestion && <div className="user-message pending" aria-live="polite"><strong>You</strong><p>{outgoingQuestion}</p></div>}</div>}{proposedAction && <section className={`tutor-action-card ${actionStatus === "applied" ? "applied" : ""}`} aria-live="polite"><div className="tutor-action-icon">{actionStatus === "applied" ? <Check size={18} /> : <Clock3 size={18} />}</div><div><span className="step-label">{actionStatus === "applied" ? "CHANGE APPLIED" : "PROPOSED CHANGE"}</span><h3>{proposedAction.title}</h3><p>{actionStatus === "applied" ? `Your unfinished content is now divided into ${proposedAction.minutes}-minute windows. YOVA may add sessions so none of the required content disappears.` : proposedAction.explanation}</p></div><button className="button primary" disabled={actionStatus !== "idle"} onClick={() => void approveAction()}>{actionStatus === "applying" ? <><span className="button-spinner" /> Applying</> : actionStatus === "applied" ? <><Check size={16} /> Applied</> : "Approve change"}</button></section>}{messages.length === 0 && !outgoingQuestion && !threadLoading && <div className="prompt-grid">{suggestedPrompts.map((prompt) => <button key={prompt} disabled={sending} onClick={() => void sendQuestion(prompt)}>{prompt}</button>)}</div>}{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}</div><div className="ask-composer"><AskBar value={question} onChange={onQuestion} onSubmit={() => void sendQuestion()} pending={sending || threadLoading} /><small>{plan ? `YOVA will answer using ${plan.title}.` : "General mode does not use a specific plan or its materials."}</small></div>{historyOpen && <><button className="tutor-history-backdrop" aria-label="Close conversation history" onClick={() => setHistoryOpen(false)} /><aside className="tutor-history-panel" role="dialog" aria-modal="true" aria-labelledby="tutor-history-title"><header><div><span className="step-label">ASK YOVA</span><h2 id="tutor-history-title">Previous chats</h2></div><button aria-label="Close conversation history" onClick={() => setHistoryOpen(false)}><X size={19} /></button></header>{historyLoading || threadLoading ? <div className="chat-loading"><span className="button-spinner dark" /> Loading chats…</div> : historyError ? <div className="chat-error"><AlertCircle size={16} /><span>{historyError}</span></div> : threads.length === 0 ? <div className="tutor-history-empty"><History size={21} /><strong>No saved chats yet</strong><p>Your finished Ask YOVA conversations will appear here.</p></div> : <div className="tutor-history-list">{threads.map((thread) => <button key={thread.id} className={thread.id === threadId ? "selected" : ""} onClick={() => void openSavedThread(thread)}><span>{thread.contextTitle ?? "General"}</span><strong>{thread.title}</strong><small>{formatTutorThreadDate(thread.updatedAt)}</small></button>)}</div>}</aside></>}</div>;
}

function formatTutorThreadDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved conversation";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const editablePreferenceIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 9] as const;

function observedLearningInsight(sessionCompletions: SessionCompletion[], sessionInterruptions: SessionInterruption[], accuracyPercent: number | null) {
  if (sessionCompletions.length === 0 && sessionInterruptions.length === 0) {
    return "YOVA needs real session activity before it can responsibly show observed patterns.";
  }

  const recentInterruptions = sessionInterruptions.slice(-4);
  if (recentInterruptions.length >= 2) {
    return "You have left multiple recent sessions before finishing. YOVA will treat that as a scheduling signal and cautiously reduce or restructure future session scope, not as evidence about your ability.";
  }

  const calibration = summarizeConfidenceCalibration(
    sessionCompletions.flatMap((completion) => completion.confidenceEvidence),
  );
  if (calibration.pattern === "possible_misconception" || calibration.pattern === "mixed") {
    return "At least one answer felt very certain but did not hold up. YOVA will treat that as a possible misconception, rebuild the idea briefly, and check it through a different application.";
  }
  if (calibration.pattern === "underestimated_knowledge") {
    return "You have answered correctly while feeling unsure. YOVA will use independent confirmation to build evidence-based confidence instead of reteaching material you can already produce.";
  }

  const difficultRatings = sessionCompletions.filter((completion) => completion.feedback === "too_difficult").length;
  const easyRatings = sessionCompletions.filter((completion) => completion.feedback === "too_easy").length;

  if (sessionCompletions.length >= 2 && difficultRatings > sessionCompletions.length / 2) {
    return "Most of your recent sessions felt too difficult. YOVA will use that signal to add more explanation and smaller steps, then keep checking whether it helps.";
  }

  if (sessionCompletions.length >= 2 && easyRatings > sessionCompletions.length / 2 && accuracyPercent !== null && accuracyPercent >= 80) {
    return "Your recent checks were accurate and often felt easy. YOVA can cautiously increase the challenge with more application and less review.";
  }

  if (accuracyPercent !== null && accuracyPercent < 60) {
    return "Your recent checks revealed knowledge gaps. YOVA will prioritize repairing missed ideas before adding harder practice.";
  }

  const timedCompletions = sessionCompletions.filter((completion) => Number.isFinite(completion.actualMinutes) && Number.isFinite(completion.plannedMinutes));
  if (timedCompletions.length >= 3) {
    const actualMinutes = timedCompletions.reduce((sum, completion) => sum + completion.actualMinutes, 0);
    const plannedMinutes = timedCompletions.reduce((sum, completion) => sum + completion.plannedMinutes, 0);
    const timingRatio = plannedMinutes > 0 ? actualMinutes / plannedMinutes : 1;
    if (timingRatio > 1.35) {
      return "Your recent sessions have taken longer than their original estimates. YOVA will treat that as a scheduling signal and compare it with difficulty feedback before changing future session scope.";
    }
    if (timingRatio < 0.65) {
      return "You have finished recent sessions earlier than their original estimates. YOVA will compare that pattern with accuracy and difficulty before cautiously increasing pace or challenge.";
    }
  }

  return "You are beginning to build a real learning history. YOVA will compare completion, quiz results, and your feedback before changing future sessions.";
}

function MethodEvidencePanel({ signals }: { signals: MethodSignal[] }) {
  const statusLabel: Record<MethodSignal["status"], string> = {
    early_signal: "Early evidence",
    promising: "Promising signal",
    needs_support: "Needs support",
  };

  return <section className="section-block method-evidence-card"><div className="section-title"><div><h3>Method evidence</h3><p>YOVA compares outcomes, not learning-style labels.</p></div><span className="data-badge">{signals.length} observed</span></div>{signals.length === 0 ? <div className="method-evidence-empty"><Sparkles size={18} /><p>Complete sessions with knowledge checks to begin comparing how different methods are working.</p></div> : <div className="method-signal-grid">{signals.slice(0, 4).map((signal) => <article className={`method-signal ${signal.status}`} key={signal.family}><div><strong>{signal.label}</strong><span>{statusLabel[signal.status]}</span></div><p>{signal.summary}</p><small>{signal.sessions} completed {signal.sessions === 1 ? "session" : "sessions"}{signal.averageAccuracy === null ? " · checks still building" : ` · ${signal.averageAccuracy}% check accuracy`}{signal.interruptions > 0 ? ` · ${signal.interruptions} ${signal.interruptions === 1 ? "interruption" : "interruptions"}` : ""}</small></article>)}</div>}<footer>YOVA waits for repeated evidence before changing plans confidently.</footer></section>;
}

function YouScreen({ account, answers, plans, sessionCompletions, sessionInterruptions, onAnswersChange, onStart, onOpenLearning, onReset }: { account: PreviewAccount | null; answers: string[]; plans: LearningPlan[]; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; onAnswersChange: (answers: string[]) => void; onStart: () => void; onOpenLearning: () => void; onReset: () => Promise<void> }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<string[]>(answers);
  const totalCorrect = sessionCompletions.reduce((sum, completion) => sum + completion.correctAnswers, 0);
  const totalAnswers = sessionCompletions.reduce((sum, completion) => sum + completion.totalAnswers, 0);
  const accuracyPercent = totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : null;
  const accuracy = accuracyPercent === null ? "No data" : `${accuracyPercent}%`;
  const totalStudyMinutes = sessionCompletions.reduce((sum, completion) => sum + (Number.isFinite(completion.actualMinutes) ? completion.actualMinutes : 0), 0)
    + sessionInterruptions.reduce((sum, interruption) => sum + (Number.isFinite(interruption.actualMinutes) ? interruption.actualMinutes : 0), 0);
  const observedEventCount = sessionCompletions.length + sessionInterruptions.length;
  const methodSignals = buildMethodSignals(plans, sessionCompletions, sessionInterruptions);
  const recommendations = buildPersonalizationRecommendations({
    answers,
    plans,
    completions: sessionCompletions,
    interruptions: sessionInterruptions,
  });
  const deepAnswerCount = deepProfileAnswerCount(answers);
  const isCloudAccount = account?.identityMode === "supabase";
  const startEditing = () => {
    setDraftAnswers([...answers]);
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraftAnswers([...answers]);
    setEditing(false);
  };
  const savePreferences = () => {
    onAnswersChange(draftAnswers);
    setEditing(false);
  };
  const updateDraftAnswer = (index: number, answer: string) => {
    setDraftAnswers((current) => {
      const next = [...current];
      next[index] = answer;
      return next;
    });
  };

  const confirmDataReset = async () => {
    if (resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      await onReset();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "YOVA could not reset your learning data.");
      setResetting(false);
    }
  };

  return <div className="page"><PageHeader eyebrow="YOU" title="Your learning, in one place" description="Tell YOVA what tends to help, inspect what it has cautiously noticed, and correct it when context is missing." /><section className="personalization-principle"><Sparkles size={20} /><div><strong>Your profile is a starting hypothesis, not a brain type.</strong><p>The task chooses the learning method. Your context changes how the method begins, how support fades, and what YOVA checks before moving on.</p></div><span>{deepAnswerCount} of 5 deeper signals</span></section><div className="you-grid"><section className={`section-block preference-card ${editing ? "editing" : ""}`}><div className="section-title"><div><h3>Your learning context</h3><p>More specific context gives YOVA better starting decisions.</p></div>{editing ? <span className="data-badge">Editing</span> : <button onClick={startEditing}>Add or change context</button>}</div>{editing ? <div className="preference-editor"><div className="profile-editor-group"><strong>Core preferences</strong>{editablePreferenceIndexes.map((index) => { const question = onboardingQuestions[index]; return <label key={question.prompt}><span>{question.prompt}</span><select value={draftAnswers[index] ?? ""} onChange={(event) => updateDraftAnswer(index, event.target.value)}><option value="">Not answered</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; })}</div><div className="profile-editor-group deep-profile-editor"><strong>How information tends to work for you</strong><p>These answers adjust delivery. YOVA still checks them against task-specific results.</p>{DEEP_PROFILE_QUESTIONS.map((question) => <label key={question.answerIndex}><span>{question.prompt}</span><small>{question.description}</small><select value={draftAnswers[question.answerIndex] ?? ""} onChange={(event) => updateDraftAnswer(question.answerIndex, event.target.value)}><option value="">Not answered</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>)}</div><div className="profile-editor-group"><strong>Tell YOVA what a form cannot capture</strong><label><span>Anything else about how you learn, study, or get stuck?</span><textarea rows={4} maxLength={800} value={draftAnswers[FREEFORM_LEARNING_CONTEXT_INDEX] ?? ""} placeholder="Example: I understand a process when I can see one real example, but I tend to copy procedures without knowing when to use them." onChange={(event) => updateDraftAnswer(FREEFORM_LEARNING_CONTEXT_INDEX, event.target.value)} /><small>{draftAnswers[FREEFORM_LEARNING_CONTEXT_INDEX]?.length ?? 0}/800</small></label><label><span>Correct or qualify what YOVA has noticed</span><textarea rows={3} maxLength={500} value={draftAnswers[OBSERVATION_CORRECTION_INDEX] ?? ""} placeholder="Example: I left those sessions because I was interrupted, not because the work was too long." onChange={(event) => updateDraftAnswer(OBSERVATION_CORRECTION_INDEX, event.target.value)} /><small>YOVA will treat this as learner-provided context, not unquestionable fact.</small></label></div><div className="preference-actions"><button className="button ghost" onClick={cancelEditing}>Cancel</button><button className="button primary" onClick={savePreferences}><Check size={16} /> Save learning context</button></div><small>For signed-in accounts, saved context is also synced to YOVA’s database.</small></div> : <><ProfileItem title="Account" value={account?.email || "Not connected"} note="Your signed-in identity" /><ProfileItem title="Main blocker" value={answers[0] || "Not answered yet"} note="Shapes how YOVA helps you begin" /><ProfileItem title="Guidance" value={answers[1] || "Not answered yet"} note="Controls how much YOVA decides for you" /><ProfileItem title="New information" value={answers[10] || answers[3] || "Not answered yet"} note="Changes how teaching begins" /><ProfileItem title="Likely breakdown" value={answers[11] || "Not answered yet"} note="Changes what YOVA verifies before moving on" /><ProfileItem title="Support after a miss" value={answers[12] || "Not answered yet"} note="Changes the first repair step" />{answers[14] && <div className="profile-freeform-summary"><span>In your own words</span><p>{answers[14]}</p></div>}<button className="button secondary full" onClick={startEditing}>Deepen your profile</button></>}</section><section className="section-block recommendation-center"><div className="section-title"><div><h3>What YOVA recommends</h3><p>Recommendations connect your context and recent evidence to a concrete next improvement.</p></div><span className="data-badge">{recommendations.length} current</span></div><div className="personalization-recommendation-list">{recommendations.length ? recommendations.slice(0, 3).map((recommendation) => <PersonalizationRecommendationCard key={recommendation.id} recommendation={recommendation} onImproveProfile={startEditing} onStart={onStart} onOpenLearning={onOpenLearning} />) : <div className="method-evidence-empty"><Check size={18} /><p>No additional profile recommendation is needed right now. YOVA will keep learning from completed sessions.</p></div>}</div></section><section className="section-block observed-pattern-card"><div className="section-title"><div><h3>What YOVA has noticed</h3><p>Working observations remain cautious and correctable.</p></div><span className="data-badge">{observedEventCount < 3 ? "Early signal" : "Observed pattern"}</span></div><div className="insight"><Sparkles size={18} /><p>{observedLearningInsight(sessionCompletions, sessionInterruptions, accuracyPercent)}</p></div>{answers[OBSERVATION_CORRECTION_INDEX] ? <div className="learner-correction"><MessageCircleMore size={17} /><div><strong>Your correction</strong><p>{answers[OBSERVATION_CORRECTION_INDEX]}</p></div><button onClick={startEditing}>Edit</button></div> : <button className="observation-correction-button" onClick={startEditing}>Not quite right? Add context or correct YOVA.</button>}<div className="metric-row"><div><strong>{sessionCompletions.length}</strong><span>sessions completed</span></div><div><strong>{formatStudyMinutes(totalStudyMinutes)}</strong><span>time studied</span></div><div><strong>{accuracy}</strong><span>recent check accuracy</span></div></div></section><MethodEvidencePanel signals={methodSignals} /><section className="section-block alpha-data-card"><div><h3>{isCloudAccount ? "Cloud learning data" : "Private-alpha data"}</h3><p>{isCloudAccount ? "Remove your learning profile, plans, tutor conversations, results, and private uploaded materials. Your login identity will remain available." : "Reset the account, onboarding answers, plans, and session results stored in this browser."}</p></div>{confirmReset ? <div className="reset-confirm"><strong>This cannot be undone.</strong><span>{isCloudAccount ? "YOVA will permanently remove your cloud learning data and uploaded files." : "Only this browser’s private-alpha data will be removed."}</span>{resetError && <span className="reset-error">{resetError}</span>}<div><button className="button ghost" disabled={resetting} onClick={() => { setConfirmReset(false); setResetError(null); }}>Cancel</button><button className="button danger" disabled={resetting} onClick={() => void confirmDataReset()}>{resetting ? <span className="button-spinner" /> : <Trash2 size={16} />} {resetting ? "Resetting…" : isCloudAccount ? "Reset learning data" : "Reset everything"}</button></div></div> : <button className="button ghost danger-outline" onClick={() => setConfirmReset(true)}><Trash2 size={16} /> {isCloudAccount ? "Reset learning data" : "Reset private-alpha data"}</button>}</section></div></div>;
}

function PersonalizationRecommendationCard({ recommendation, onImproveProfile, onStart, onOpenLearning }: { recommendation: PersonalizationRecommendation; onImproveProfile: () => void; onStart: () => void; onOpenLearning: () => void }) {
  const action = recommendation.action === "improve_profile"
    ? onImproveProfile
    : recommendation.action === "start_session"
      ? onStart
      : recommendation.action === "open_learning"
        ? onOpenLearning
        : null;
  return <article className="personalization-recommendation"><span><Sparkles size={17} /></span><div><strong>{recommendation.title}</strong><p>{recommendation.explanation}</p><small>{recommendation.evidence}</small></div>{action && recommendation.actionLabel ? <button onClick={action}>{recommendation.actionLabel}</button> : null}</article>;
}

function formatStudyMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) return "No data";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function reusableResourceFromLessonSteps(steps: LessonStep[], rationale: string): SessionResource {
  return {
    rationale,
    coverage: undefined,
    generatedAt: new Date().toISOString(),
    origin: "built_in",
    activities: steps.map((step) => ({
      methodPhase: step.methodPhase,
      estimatedMinutes: step.estimatedMinutes,
      requiredForCompletion: step.requiredForCompletion,
      type: step.type,
      concept: step.concept,
      label: step.label,
      title: step.title,
      body: step.body,
      teaching: step.teaching,
      choices: step.question ?? [],
      correctAnswer: step.correctAnswer,
      feedback: step.feedback,
    })),
  };
}

function fallbackCoverageFor(session: LearningPlanSession, steps: LessonStep[]): SessionCoverage {
  const ideas = session.contentTargets?.length
    ? session.contentTargets.slice(0, session.estimatedMinutes <= 15 ? 2 : 4)
    : [session.objective];
  const checkConcepts = [...new Set(steps
    .filter((step) => step.type === "multiple_choice" || step.type === "free_response")
    .map((step) => step.concept)
    .filter((concept): concept is string => Boolean(concept)))];
  return {
    focus: session.objective,
    essentialIdeas: ideas,
    completionEvidence: session.completionEvidence?.length
      ? session.completionEvidence.slice(0, 3)
      : ["Complete the independent check and identify any idea that still needs review."],
    evidenceMap: ideas.map((idea, index) => ({
      essentialIdea: idea,
      activityConcept: checkConcepts[index] ?? checkConcepts[0] ?? session.objective,
    })),
    deferredContent: [],
  };
}

function lessonStepsFor(plan: LearningPlan | null): LessonStep[] {
  return subjectSpecificLessonStepsFor(plan) ?? [{
    type: "instruction",
    concept: null,
    label: "Content needed",
    title: "YOVA needs the actual topic before this session can begin",
    body: "Return to the learning goal and name the concept or add material that identifies what should be taught.",
    question: null,
    correctAnswer: null,
    feedback: null,
  }];
}

function subjectSpecificLessonStepsFor(plan: LearningPlan | null): LessonStep[] | null {
  if (!plan) return null;

  const current = plan.sessions.find((session) => session.status === "ready") ?? plan.sessions.find((session) => session.status === "upcoming");

  if (plan.studyMode === "outside_yova") {
    return [
      lessonInstruction("Set up", "Prepare your outside study block", `Open the material you use for ${plan.topic}. Keep only that source and a place to work visible.`, "orient"),
      lessonInstruction("Your task", current?.title ?? "Complete the planned work", `${current?.objective ?? "Work through the next planned objective."} Use ${current?.method.toLowerCase() ?? "the selected method"} for about ${current?.estimatedMinutes ?? 20} minutes.`, "independent_practice"),
      lessonQuestion("Method check", "What should happen before you check the source?", "The method works only if you make a real attempt before looking for the answer.", ["Attempt the task from memory", "Reread everything first", "Copy the source wording", "Switch topics"], "Attempt the task from memory", "Active retrieval requires a genuine attempt before looking at the source.", "Retrieval before review", "retrieve"),
      lessonFreeResponse("Recall check", "Write the main idea without reopening the source", "Explain the most important idea or step you just practiced. Use your own words and include one detail that makes the explanation specific.", "A strong response states the central idea or step accurately, explains it in the learner's own words, and includes one relevant supporting detail from the source.", "Compare the meaning, not the exact wording. If the central idea or supporting detail is missing, mark it as needing another pass.", plan.topic, "retrieve"),
      lessonInstruction("Return to YOVA", "Record what needs another pass", "Note the one idea or step that felt least stable. YOVA will use that signal when the session result is saved.", "reflect"),
    ];
  }

  if (current?.learningMode === "learn") {
    return teachingFirstLessonStepsFor(plan);
  }

  if (/biology|photosynthesis|cellular respiration/i.test(plan.topic)) {
    return [
      lessonInstruction("Set up", "Closed-note retrieval", "Try to produce each answer before looking. Review only what you miss, then retry the missed item later.", "orient"),
      lessonQuestion("Question 1 of 2", "Which stage of cellular respiration happens first?", "Answer from memory. Familiarity is not the same as being able to retrieve it.", ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"], "Glycolysis", "Glycolysis is the first stage and begins breaking glucose down before the Krebs cycle and electron transport chain.", "Cellular respiration sequence", "retrieve"),
      lessonQuestion("Question 2 of 2", "Where does glycolysis occur?", "Choose the location without opening your notes.", ["Cytoplasm", "Mitochondrial matrix", "Nucleus", "Cell membrane"], "Cytoplasm", "Glycolysis occurs in the cytoplasm; later aerobic stages occur in the mitochondrion.", "Glycolysis location", "retrieve"),
      lessonFreeResponse("Explain from memory", "Why can glycolysis begin without oxygen?", "Answer without reopening the explanation. Focus on what glycolysis directly requires and where it happens.", "Glycolysis does not directly require oxygen and occurs in the cytoplasm, so it can begin before the oxygen-dependent stages of aerobic respiration.", "A strong answer mentions that glycolysis does not directly require oxygen. Mentioning that it occurs in the cytoplasm makes the explanation more complete.", "Glycolysis oxygen requirement", "retrieve"),
      lessonInstruction("Repair the gap", "Compare before moving on", "Glycolysis occurs in the cytoplasm. Most later stages occur in the mitochondrion. Keep that contrast available for the next mixed-practice session.", "repair"),
    ];
  }

  if (/product rule/i.test(plan.topic)) {
    return [
      lessonInstruction("Set up", "Recall the product-rule structure", "Try each step before looking back at the rule. The goal is to choose and apply both terms, not only recognize the formula.", "orient"),
      lessonQuestion("Structure check", "Which expression correctly applies the product rule?", "Differentiate each factor once while the other factor stays in place.", ["$f'g + fg'$", "$f'g'$", "$fg'$", "$f'g$"], "$f'g + fg'$", "The product rule adds two terms: first $f'g$, then $fg'$.", "Product rule structure", "retrieve"),
      lessonQuestion("Application check", "What is the derivative of $x^2\\sin(x)$?", "Apply the two-term structure before choosing.", ["$2x\\sin(x) + x^2\\cos(x)$", "$2x\\cos(x)$", "$x^2\\cos(x)$", "$2x\\sin(x)$"], "$2x\\sin(x) + x^2\\cos(x)$", "Differentiate $x^2$ while keeping $\\sin(x)$, then keep $x^2$ while differentiating $\\sin(x)$, and add the terms.", "Applying the product rule", "independent_practice"),
      lessonFreeResponse("Show your work", "Differentiate $x^3e^x$", "Show the two product-rule terms before giving the final derivative.", "$3x^2e^x + x^3e^x$", "A strong response differentiates $x^3$ while keeping $e^x$, then keeps $x^3$ while differentiating $e^x$, and adds both terms.", "Applying the product rule", "independent_practice"),
      lessonInstruction("Wrap up", "Use a new product next", "Apply the same structure to a different pair of functions without the example visible. That transfer is stronger evidence than repeating the original problem.", "transfer"),
    ];
  }

  if (/finance|investing|budget|credit|interest/i.test(plan.topic)) {
    return [
      lessonInstruction("Set up", "Build the decision framework", "Start with the practical purpose of each concept. The goal is to make a sound decision, not merely recognize vocabulary.", "orient"),
      lessonQuestion("Question 1 of 2", "What is the main purpose of a budget?", "Choose the answer that describes an active decision tool.", ["Direct money toward priorities and constraints", "Predict every future expense perfectly", "Eliminate all optional spending", "Track only large purchases"], "Direct money toward priorities and constraints", "A budget is a decision tool for directing limited money toward priorities and known constraints.", "Purpose of a budget", "retrieve"),
      lessonQuestion("Question 2 of 2", "Which example shows compound growth?", "Look for growth that earns additional growth over time.", ["Interest earning interest", "A one-time discount", "A fixed monthly fee", "Cash kept at zero interest"], "Interest earning interest", "Compound growth happens when previous growth is included in the base that produces future growth.", "Compound growth", "retrieve"),
      lessonFreeResponse("Explain from memory", "How does compound growth build over time?", "Describe the mechanism in your own words rather than repeating a definition.", "Compound growth occurs when earlier gains become part of the base, allowing later gains to earn additional growth too.", "A strong answer explains that prior gains remain in the base and can themselves produce future gains.", "Compound growth", "retrieve"),
      lessonInstruction("Apply", "Connect the ideas to one real decision", "Choose one current spending, saving, debt, or investing decision and name the concept that should guide it.", "transfer"),
    ];
  }

  return null;
}

function teachingFirstLessonStepsFor(plan: LearningPlan): LessonStep[] | null {
  if (/biology|photosynthesis|cellular respiration/i.test(plan.topic)) {
    return [
      lessonInstruction("Learn", "Build the cellular-respiration map", "Cellular respiration transfers energy from glucose into ATP across linked stages. Glycolysis begins in the cytoplasm. The Krebs cycle and electron transport chain follow in the mitochondrion.", "model"),
      lessonInstruction("Worked example", "Trace one glucose molecule", "Start with glycolysis splitting glucose into pyruvate. A bridging step converts pyruvate to acetyl-CoA, which enters the Krebs cycle. The cycle supplies high-energy carriers to the electron transport chain, where their energy supports most ATP production.", "model"),
      lessonQuestion("Guided check", "Which sequence matches the model you just learned?", "Use the stage map above rather than guessing from vocabulary.", ["Glycolysis → Krebs cycle → electron transport chain", "Krebs cycle → glycolysis → electron transport chain", "Electron transport chain → glycolysis → Krebs cycle", "Fermentation → Krebs cycle → glycolysis"], "Glycolysis → Krebs cycle → electron transport chain", "Glycolysis begins the process, the Krebs cycle continues extracting energy, and the electron transport chain follows using high-energy carriers.", "Cellular respiration sequence", "guided_practice"),
      lessonFreeResponse("Independent explanation", "Explain how the three stages connect", "Rebuild the sequence in your own words without reopening the model. State where glycolysis begins and what passes from one stage toward the next.", "Glycolysis begins in the cytoplasm and starts breaking down glucose. Its products feed later mitochondrial stages; the Krebs cycle produces high-energy carriers that support the electron transport chain and ATP production.", "A strong answer gives the correct order, places glycolysis in the cytoplasm, and explains at least one connection between stages.", "Cellular respiration sequence", "independent_practice"),
      lessonInstruction("Wrap up", "Keep the map, not isolated labels", "The next useful step is retrieving the sequence after a delay and applying it to a new question. One guided success is a starting point, not proof of durable mastery.", "schedule_return"),
    ];
  }

  if (/product rule/i.test(plan.topic)) {
    return [
      lessonInstruction("Learn", "See the product rule before using it", "When two functions are multiplied, differentiate one while leaving the other unchanged. Then switch their roles and add the results: $\\frac{d}{dx}[f(x)g(x)] = f'(x)g(x) + f(x)g'(x)$.", "model"),
      lessonInstruction("Worked example", "Differentiate $x^2\\sin(x)$", "Differentiate $x^2$ and keep $\\sin(x)$: $2x\\sin(x)$. Then keep $x^2$ and differentiate $\\sin(x)$: $x^2\\cos(x)$. Add them: $2x\\sin(x) + x^2\\cos(x)$.", "model"),
      lessonQuestion("Guided check", "Which expression correctly applies the product rule?", "Match the two-part structure from the example.", ["$f'g + fg'$", "$f'g'$", "$fg'$", "$f'g$"], "$f'g + fg'$", "The product rule adds two terms so each factor is differentiated once while the other is held unchanged.", "Product rule structure", "guided_practice"),
      lessonFreeResponse("Independent work", "Differentiate $x^3e^x$", "Use the model with less support. Show the two product-rule terms before giving the final derivative.", "$3x^2e^x + x^3e^x$", "A strong response differentiates $x^3$ while keeping $e^x$, then keeps $x^3$ while differentiating $e^x$, and adds both terms.", "Applying the product rule", "independent_practice"),
      lessonInstruction("Wrap up", "Fade the example next", "The next attempt should use a new product with less support so YOVA can see whether the procedure transfers.", "transfer"),
    ];
  }

  if (/finance|investing|budget|credit|interest/i.test(plan.topic)) {
    return [
      lessonInstruction("Learn", "Use money concepts as decision tools", "A budget directs limited income toward priorities and constraints. Compound growth describes gains becoming part of the base that can produce future gains. Both concepts help compare choices over time.", "model"),
      lessonInstruction("Worked example", "Trace one financial choice", "If $100 earns 10%, it becomes $110. A second 10% gain is calculated from $110, not the original $100, producing $121. The earlier $10 gain joined the base and produced an additional gain.", "model"),
      lessonQuestion("Guided check", "What makes the second year compound growth?", "Use the example you just followed.", ["The earlier gain remains in the base", "The rate must increase every year", "A fee is added to the balance", "The original amount is ignored"], "The earlier gain remains in the base", "Compounding occurs because prior gains remain invested and can themselves produce later gains.", "Compound growth mechanism", "guided_practice"),
      lessonFreeResponse("Independent explanation", "Explain compound growth in your own words", "Describe why later gains can become larger even when the rate stays the same.", "Earlier gains remain in the base, so future percentage gains apply to the original amount plus accumulated growth.", "A strong answer explains that prior gains stay in the base and can produce additional growth.", "Compound growth mechanism", "independent_practice"),
      lessonInstruction("Apply next", "Connect the model to a real decision", "The next useful step is comparing two saving, debt, or investing choices using the time horizon and compounding, not merely repeating the definition.", "transfer"),
    ];
  }

  return null;
}

function lessonInstruction(label: string, title: string, body: string, methodPhase?: MethodPhase): LessonStep {
  const teaching = methodPhase === "model" ? {
    keyIdea: title,
    explanation: body,
    example: null,
    commonMistake: null,
  } : null;
  return { methodPhase, estimatedMinutes: 3, requiredForCompletion: true, type: "instruction", concept: null, label, title, body: teaching ? "Study the explanation for meaning. You will use it without support in the next step." : body, teaching, question: null, correctAnswer: null, feedback: null };
}

function lessonQuestion(label: string, title: string, body: string, choices: string[], correctAnswer: string, feedback: string, concept = title, methodPhase?: MethodPhase): LessonStep {
  return { methodPhase, estimatedMinutes: 3, requiredForCompletion: true, type: "multiple_choice", concept: normalizeConceptName(concept), label, title, body, teaching: null, question: choices, correctAnswer, feedback };
}

function lessonFreeResponse(label: string, title: string, body: string, referenceAnswer: string, feedback: string, concept = title, methodPhase?: MethodPhase): LessonStep {
  return { methodPhase, estimatedMinutes: 5, requiredForCompletion: true, type: "free_response", concept: normalizeConceptName(concept), label, title, body, teaching: null, question: null, correctAnswer: referenceAnswer, feedback };
}

function normalizeConceptName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || "Session concept";
}

function isVerifiableKnownTarget(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) return false;
  return ![
    /^the (?:current|first|next) (?:starting )?(?:gap|gaps|concept|content|target)/i,
    /\b(?:gaps? revealed|starting gaps?|first concept listed|current starting point)\b/i,
    /\bwhat (?:you|the learner) (?:already )?(?:know|remember)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function SessionSetup({ plan, answers, completions, interruptions, onExit, onStart }: { plan: LearningPlan | null; answers: string[]; completions: SessionCompletion[]; interruptions: SessionInterruption[]; onExit: () => void; onStart: (adjustment: SessionAdjustment | null) => void }) {
  const session = plan?.sessions.find((item) => item.status === "ready") ?? null;
  const [familiarity, setFamiliarity] = useState<SessionAdjustment["familiarity"]>("as_planned");
  const [availableMinutes, setAvailableMinutes] = useState<number | null>(null);
  const [selectedKnownTargets, setSelectedKnownTargets] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const options: Array<{
    value: SessionAdjustment["familiarity"];
    title: string;
    description: string;
  }> = [
    {
      value: "as_planned",
      title: "The plan still fits",
      description: "Use the current teaching or practice starting point.",
    },
    {
      value: "already_know",
      title: "I already know some of this",
      description: "Start with a quick unsupported check and skip only what you demonstrate.",
    },
    {
      value: "need_teaching",
      title: "I need this taught first",
      description: "Build the idea accurately before reducing support.",
    },
    {
      value: "challenge_me",
      title: "Give me a harder check",
      description: "Reduce introductory review and emphasize application or transfer.",
    },
  ];

  if (!plan || !session) {
    return <main className="centered-shell"><BrandMark /><section className="plan-error-state"><span><AlertCircle /></span><h1>No unfinished session was found.</h1><p>Return to Learning and choose an active goal with unfinished content.</p><button className="button primary" onClick={onExit}>Return to YOVA</button></section></main>;
  }

  const targetChoices = (session.contentTargets ?? [])
    .filter(isVerifiableKnownTarget)
    .filter((target, index, targets) => targets.indexOf(target) === index)
    .slice(0, 4);
  const decisionSignals = buildSessionDecisionSignals({
    plan,
    session,
    answers,
    completions: completions.filter((completion) => completion.planId === plan.id),
    interruptions: interruptions.filter((interruption) => interruption.planId === plan.id),
  });

  const toggleKnownTarget = (target: string) => {
    setSelectedKnownTargets((current) => current.includes(target)
      ? current.filter((item) => item !== target)
      : current.length < 4 ? [...current, target] : current);
  };

  const start = () => {
    const trimmedNote = note.trim();
    if (familiarity === "as_planned" && availableMinutes === null && !trimmedNote) {
      onStart(null);
      return;
    }
    onStart({
      familiarity,
      availableMinutes,
      knownTargets: familiarity === "already_know" ? selectedKnownTargets : [],
      note: trimmedNote,
    });
  };

  const adjustmentExplanation = familiarity === "already_know"
    ? selectedKnownTargets.length
      ? `YOVA will verify ${selectedKnownTargets.length === 1 ? "the concept you selected" : `the ${selectedKnownTargets.length} concepts you selected`} without support, then avoid reteaching only what you demonstrate.`
      : "YOVA will begin with evidence, then avoid reteaching anything you can demonstrate."
    : familiarity === "need_teaching"
      ? "YOVA will build a subject explanation or model before asking for unsupported performance."
      : familiarity === "challenge_me"
        ? "YOVA will emphasize independent application and transfer rather than introductory review."
        : "YOVA will keep the plan's current starting point and still adapt future sessions from the result.";

  return <main className="session-setup-shell">
    <header><BrandMark /><button className="button ghost" onClick={onExit}>Cancel</button></header>
    <section className="session-setup-card">
      <div className="session-setup-copy"><span className="step-label">QUICK SESSION UPDATE</span><h1>Make sure YOVA starts in the right place.</h1><p>This is optional context, not another test. YOVA will verify what you know through the session rather than trusting a confidence rating.</p></div>
      <section className="session-current-assumption"><div><span>CURRENT TARGET</span><strong>{session.title}</strong><p>{session.objective}</p></div><div><span>PLANNED APPROACH</span><strong>{session.learningMode === "learn" ? "Teaching before independent work" : "Independent attempt before repair"}</strong><p>{session.method} · about {session.estimatedMinutes} minutes</p></div></section>
      <section className="session-decision-map" aria-label="What YOVA is using for this session"><div className="session-decision-heading"><div><span className="step-label">YOVA&apos;S CURRENT READ</span><h2>Why this session is different for you</h2><p>Task requirements choose the method. Your context and actual results change how YOVA delivers it.</p></div><span>{decisionSignals.filter((signal) => signal.strength === "observed").length ? "Uses observed evidence" : "Starting hypothesis"}</span></div><div className="session-decision-grid">{decisionSignals.map((signal) => <article className={signal.strength} key={signal.kind}><span>{signal.label}</span><strong>{signal.title}</strong><p>{signal.detail}</p><small>{signal.strength === "observed" ? "Observed in YOVA" : signal.strength === "direct" ? "Known from this goal" : "You told YOVA"}</small></article>)}</div></section>
      <fieldset className="session-readiness-options"><legend>Has anything changed since the plan was created?</legend><div>{options.map((option) => <button type="button" key={option.value} className={familiarity === option.value ? "selected" : ""} onClick={() => setFamiliarity(option.value)}><span>{familiarity === option.value ? <Check size={16} /> : <Target size={16} />}</span><div><strong>{option.title}</strong><small>{option.description}</small></div></button>)}</div></fieldset>
      {familiarity === "already_know" && <fieldset className="known-targets"><legend>Which parts do you think you already know?</legend>{targetChoices.length ? <><p>Select any that should be verified first. YOVA will not skip them based only on this claim.</p><div>{targetChoices.map((target) => <button type="button" aria-pressed={selectedKnownTargets.includes(target)} className={selectedKnownTargets.includes(target) ? "selected" : ""} key={target} onClick={() => toggleKnownTarget(target)}><span>{selectedKnownTargets.includes(target) ? <Check size={15} /> : null}</span>{target}</button>)}</div></> : <p>Name the concepts in the context box below. YOVA will turn the claim into an unsupported check before deciding what to omit.</p>}</fieldset>}
      <div className="session-context-row"><label><span>Time available right now</span><select value={availableMinutes ?? ""} onChange={(event) => setAvailableMinutes(event.target.value ? Number(event.target.value) : null)}><option value="">Keep the planned {session.estimatedMinutes} minutes</option>{[10, 15, 20, 25, 30, 45, 60].filter((minutes) => minutes !== session.estimatedMinutes).map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select><small>A shorter window reduces today&apos;s content slice. It does not make incomplete content count as finished.</small></label><label><span>Anything YOVA should account for today?</span><textarea rows={3} maxLength={500} value={note} placeholder="Optional: name what you already know, what confused you, or what this session must cover." onChange={(event) => setNote(event.target.value)} /><small>{note.length}/500 · More specific context usually produces a better session.</small></label></div>
      <div className="session-setup-proof"><Sparkles size={19} /><div><strong>What will change</strong><p>{adjustmentExplanation}</p></div></div>
      <footer><button className="button ghost" onClick={onExit}>Not now</button><button className="button primary large" onClick={start}>Prepare this session <ArrowRight size={18} /></button></footer>
    </section>
  </main>;
}

function SessionLoading({ plan, onExit }: { plan: LearningPlan | null; onExit: () => void }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const status = elapsedSeconds < 20
    ? "Preparing the content and activity sequence."
    : elapsedSeconds < 45
      ? "Building and checking the guided lesson."
      : "This is taking longer than usual. Keep this page open while YOVA finishes the lesson.";

  return <main className="centered-shell session-loading"><BrandMark /><section><div className="session-loading-orbit" aria-hidden="true"><span className="button-spinner dark" /><Sparkles size={22} /></div><span className="step-label">PREPARING YOUR SESSION</span><h1>Building one focused path through <em>{plan?.topic ?? "your goal"}</em>.</h1><p>YOVA is turning the next objective into a lesson you can actually complete, not a generic pile of study tools.</p><div className="session-building-list" aria-label="What YOVA is preparing"><article><Target size={18} /><div><strong>Bounded content</strong><span>Only the ideas that fit this session</span></div></article><article><Sparkles size={18} /><div><strong>Learning method</strong><span>Selected for the task, then adapted to you</span></div></article><article><BookOpen size={18} /><div><strong>Teaching and practice</strong><span>Explanation first when the topic is new</span></div></article><article><Check size={18} /><div><strong>Completion evidence</strong><span>Finished work, not elapsed time</span></div></article></div><div className="session-building-status" role="status" aria-live="polite"><Clock3 size={17} /><div><strong>{status}</strong><span>{formatElapsedDuration(elapsedSeconds)} elapsed</span></div></div><button className="button ghost" onClick={onExit}>Cancel</button></section></main>;
}

function SessionGenerationError({ plan, issue, onExit, onRetry }: { plan: LearningPlan | null; issue: string | null; onExit: () => void; onRetry: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="plan-error-state" role="alert"><span><AlertCircle /></span><span className="step-label">SAFE STOP</span><h1>YOVA did not substitute unrelated content.</h1><p>{issue ?? "YOVA could not build this session safely yet."}</p><p>Nothing was marked complete. Return to {plan?.title ?? "the learning goal"} to clarify the topic or source, or retry the same request.</p><div><button className="button ghost" onClick={onExit}><ArrowLeft size={17} /> Return to learning</button><button className="button primary" onClick={onRetry}>Try again <ArrowRight size={17} /></button></div></section></main>;
}

function GuidedSession({ plan, steps, step, selectedAnswer, outcome, confidence, priorConfidenceCaptured, answerRevealed, elapsedSeconds, capacityMinutes, rationale, coverage, methodBriefing, supportPlan, sourceGrounding, issue, analyticsEnabled, browserPreviewMode, onSelect, onEvaluate, onConfidence, onReveal, onExit, onNext }: { plan: LearningPlan | null; steps: LessonStep[]; step: number; selectedAnswer: string | null; outcome: boolean | undefined; confidence: ConfidenceLevel | undefined; priorConfidenceCaptured: boolean; answerRevealed: boolean; elapsedSeconds: number; capacityMinutes: number | null; rationale: string | null; coverage: SessionCoverage | null; methodBriefing: SessionMethodBriefing | null; supportPlan: SessionSupportPlan | null; sourceGrounding: SessionSourceGrounding | null; issue: string | null; analyticsEnabled: boolean; browserPreviewMode: boolean; onSelect: (answer: string) => void; onEvaluate: (correct: boolean) => void; onConfidence: (confidence: ConfidenceLevel) => void; onReveal: () => void; onExit: () => void; onNext: (evaluation: AnswerEvaluationResponse | null) => void }) {
  const [confirmingExit, setConfirmingExit] = useState(false);
  const [answerEvaluation, setAnswerEvaluation] = useState<AnswerEvaluationResponse | null>(null);
  const [answerEvaluationIssue, setAnswerEvaluationIssue] = useState<string | null>(null);
  const [answerEvaluationPending, setAnswerEvaluationPending] = useState(false);
  const content = steps[step];
  const currentSession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  const isQuestion = content.type === "multiple_choice" || content.type === "free_response";
  const isImmediateRepair = content.evidenceRole === "immediate_repair";
  const requiresConfidence = shouldRequestConfidence({
    isQuestion,
    isImmediateRepair,
    methodPhase: content.methodPhase,
    priorConfidenceCaptured,
  });
  const isCorrect = outcome === true;
  const correctAnswer = content.correctAnswer?.trim() ?? "";
  const punctuatedCorrectAnswer = correctAnswer && !/[.!?]$/.test(correctAnswer) ? `${correctAnswer}.` : correctAnswer;
  const explanation = isCorrect
    ? content.feedback
    : punctuatedCorrectAnswer
      ? `The correct answer is “${punctuatedCorrectAnswer}” ${content.feedback ?? "YOVA will bring this idea back for another attempt."}`
      : content.feedback;
  const canContinue = !isQuestion || outcome !== undefined;
  const phase = content.methodPhase ? getMethodPhasePresentation(content.methodPhase) : null;
  const phasePosition = methodPhasePosition(steps.map((item) => item.methodPhase), step);
  const requiredSteps = steps.filter((item) => item.requiredForCompletion !== false);
  const completedRequiredSteps = steps.slice(0, step).filter((item) => item.requiredForCompletion !== false).length;
  const requiredProgress = requiredSteps.length ? Math.round((completedRequiredSteps / requiredSteps.length) * 100) : 0;
  const activityLabel = polishActivityLabel(content.label) || "Activity";
  const freeResponseMode = content.type === "free_response"
    ? selectFreeResponseMode({
      taskType: methodBriefing?.taskType,
      title: content.title,
      prompt: content.body,
      referenceAnswer: content.correctAnswer ?? "",
    })
    : "explanation";

  const checkFreeResponse = async () => {
    if (!selectedAnswer?.trim() || answerEvaluationPending) return;
    if (!plan || !currentSession || !content.concept || !content.correctAnswer) {
      onReveal();
      return;
    }

    setAnswerEvaluationPending(true);
    setAnswerEvaluationIssue(null);
    try {
      const response = await fetch("/api/sessions/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(browserPreviewMode ? { "X-Yova-Development-Preview": "guided-session" } : {}),
        },
        body: JSON.stringify({
          planId: plan.id,
          planSessionId: currentSession.id,
          learnerAnswer: selectedAnswer,
          activity: {
            title: content.title,
            prompt: content.body,
            concept: content.concept,
            referenceAnswer: content.correctAnswer,
            rubric: content.feedback ?? `A strong answer accurately explains ${content.concept}.`,
          },
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not check this explanation right now.";
        throw new Error(message);
      }
      const parsed = AnswerEvaluationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("YOVA received an unsafe answer-checking response.");
      setAnswerEvaluation(parsed.data);
      if (parsed.data.verdict !== "uncertain") onEvaluate(parsed.data.verdict === "secure");
    } catch (error) {
      setAnswerEvaluationIssue(error instanceof Error
        ? error.message
        : "YOVA could not check this explanation right now.");
    } finally {
      onReveal();
      setAnswerEvaluationPending(false);
    }
  };

  const revealUnknownAnswer = () => {
    if (answerEvaluationPending || answerRevealed) return;
    if (requiresConfidence && !confidence) onConfidence("guessing");
    onSelect("I do not know this yet.");
    onEvaluate(false);
    onReveal();
  };

  return <main className="session-shell">
    <header className="session-top">
      <BrandMark compact />
      <div><span>{plan?.title ?? "YOVA session"}</span><strong>{currentSession?.title ?? "Guided learning"}</strong></div>
      <div className="session-progress"><span>{completedRequiredSteps} of {requiredSteps.length} required steps complete · {formatElapsedDuration(elapsedSeconds)} elapsed</span><div><i style={{ width: `${requiredProgress}%` }} /></div></div>
      <button className="button ghost" onClick={() => setConfirmingExit(true)}>Exit</button>
    </header>
    <section className="session-content">
      <SessionGuidePanel session={currentSession} capacityMinutes={capacityMinutes} coverage={coverage} steps={steps} step={step} methodBriefing={methodBriefing} supportPlan={supportPlan} sourceGrounding={sourceGrounding} rationale={rationale} />
      <section className="session-workspace">
        {issue && step === 0 && <div className="session-issue"><AlertCircle size={17} /><span>{issue}</span></div>}
        {phase && phasePosition && <MethodPhaseCoach phase={phase} current={phasePosition.current} total={phasePosition.total} />}
        {isImmediateRepair && <div className="immediate-repair-note"><RotateCcw size={17} /><div><strong>Repair now, verify later</strong><p>Correct the idea now. YOVA will still check it again later because an immediate retry is not proof that it will stick.</p></div></div>}
        <header className="session-activity-header"><div className="session-step-meta"><div><span>STEP {step + 1} OF {steps.length}</span><strong>{activityLabel}</strong></div>{content.estimatedMinutes && <span><Clock3 size={13} /> About {content.estimatedMinutes} min</span>}</div><h1><LearningContent content={content.title} inline /></h1>{content.body && <LearningContent content={content.body} className="session-activity-instruction" />}</header>
        {content.teaching && <TeachingLessonCard teaching={content.teaching} />}
        {requiresConfidence && <ConfidenceCheck value={confidence} locked={outcome !== undefined || answerRevealed} onChange={onConfidence} />}
        {content.type === "multiple_choice" && content.question && <div className="answer-grid">{content.question.map((answer) => {
          const answerState = outcome !== undefined && answer === content.correctAnswer
            ? "correct"
            : outcome !== undefined && selectedAnswer === answer
              ? "incorrect"
              : selectedAnswer === answer
                ? "selected"
                : "";
          return <button key={answer} className={answerState} disabled={selectedAnswer !== null || (requiresConfidence && !confidence)} onClick={() => { onSelect(answer); onEvaluate(answer === content.correctAnswer); }}><LearningContent content={answer} inline />{answerState === "correct" ? <Check size={18} /> : answerState === "incorrect" ? <X size={18} /> : null}</button>;
        })}</div>}
      {content.type === "multiple_choice" && outcome !== undefined && <><div className={`feedback ${isCorrect ? "" : "incorrect"}`}>{isCorrect ? <Check size={20} /> : <AlertCircle size={20} />}<div><strong>{isCorrect ? "Correct." : "Useful miss. Repair it now."}</strong>{explanation && <LearningContent content={explanation} />}</div></div>{confidence && <p className="confidence-result"><Sparkles size={15} /> {confidenceResultMessage(confidence, isCorrect)}</p>}</>}
      {content.type === "free_response" && <div className="recall-response">
        {freeResponseMode === "quantitative_workpad"
          ? <QuantitativeWorkpad
            value={selectedAnswer ?? ""}
            disabled={answerRevealed || answerEvaluationPending || (requiresConfidence && !confidence)}
            onChange={onSelect}
          />
          : <label htmlFor={`recall-${step}`}>
            <span>{isImmediateRepair ? "Corrected idea in your own words" : phase?.label ?? "Your answer from memory"}</span>
            <textarea
              id={`recall-${step}`}
              rows={6}
              value={selectedAnswer ?? ""}
              disabled={answerRevealed || answerEvaluationPending || (requiresConfidence && !confidence)}
              placeholder={isImmediateRepair ? "Explain the corrected idea without copying the wording..." : requiresConfidence && !confidence ? "Choose your confidence first..." : phase?.instruction ?? "Write what you can remember before checking..."}
              onChange={(event) => onSelect(event.target.value)}
            />
          </label>}
        {!answerRevealed ? <div className="recall-submit-actions">
          <button className="button secondary" disabled={!selectedAnswer?.trim() || answerEvaluationPending || (requiresConfidence && !confidence)} onClick={() => void checkFreeResponse()}>
            {answerEvaluationPending
              ? <><span className="button-spinner dark" /> Checking your work...</>
              : freeResponseMode === "quantitative_workpad" ? "Check my work" : "Check my answer"}
          </button>
          <button className="button ghost unknown-answer" disabled={answerEvaluationPending} onClick={revealUnknownAnswer}><AlertCircle size={16} /> I don&apos;t know yet</button>
          <small>YOVA will show the model and record a gap without treating it as failure.</small>
        </div> : <div className="recall-review">
          {answerEvaluation && <section className={`answer-evaluation ${answerEvaluation.verdict}`}>
            <span className="step-label">YOVA&apos;S FORMATIVE CHECK</span>
            <strong>{answerEvaluation.verdict === "secure" ? "The key idea is present." : answerEvaluation.verdict === "needs_review" ? "One or more key ideas need repair." : "YOVA could not judge this confidently."}</strong>
            <LearningContent content={answerEvaluation.feedback} />
            {answerEvaluation.matchedIdeas.length > 0 && <div><span>What your answer showed</span><ul>{answerEvaluation.matchedIdeas.map((idea) => <li key={idea}><LearningContent content={idea} inline /></li>)}</ul></div>}
            {answerEvaluation.missingIdeas.length > 0 && <div><span>What to check</span><ul>{answerEvaluation.missingIdeas.map((idea) => <li key={idea}><LearningContent content={idea} inline /></li>)}</ul></div>}
          </section>}
          {answerEvaluationIssue && <div className="answer-evaluation-fallback"><AlertCircle size={17} /><p>{answerEvaluationIssue} Use the reference answer and your own judgment below.</p></div>}
          <span className="step-label">REFERENCE ANSWER</span>
          <LearningContent content={content.correctAnswer ?? ""} className="reference-answer" />
          {content.feedback && <LearningContent content={content.feedback} className="reference-rubric" />}
          <div className="recall-actions"><span>{answerEvaluation ? "Confirm or correct YOVA’s check" : "How did your answer compare?"}</span><button className={outcome === true ? "selected" : ""} onClick={() => onEvaluate(true)}><Check size={17} /> I got the key idea</button><button className={outcome === false ? "selected needs-work" : ""} onClick={() => onEvaluate(false)}><AlertCircle size={17} /> Needs another pass</button></div>
          {confidence && outcome !== undefined && <p className="confidence-result"><Sparkles size={15} /> {confidenceResultMessage(confidence, outcome)}</p>}
          <small className="privacy-note">{isImmediateRepair ? "This immediate explain-back is not saved as proof of mastery. The original miss remains scheduled for later verification." : answerEvaluation ? "Your answer was sent for a one-time AI check and is not saved. YOVA keeps only the concept result, confidence, and support level." : "Your typed answer is not saved. YOVA keeps only the concept result, confidence, and support level."}</small>
        </div>}
      </div>}
        <footer className="session-action-bar">{step === steps.length - 1 && <p className="completion-rule"><Check size={14} /> Completion is based on the required learning work, not on running out the clock.</p>}<button className="button primary large" onClick={() => onNext(answerEvaluation)} disabled={!canContinue}>{outcome === false && !isImmediateRepair ? "Repair this idea" : step === steps.length - 1 ? "Finish this content" : "Continue"} <ArrowRight size={18} /></button></footer>
      </section>
    </section>
    <SessionTutor
      plan={plan}
      activity={content}
      outcome={outcome}
      answerRevealed={answerRevealed}
      selectedAnswer={selectedAnswer}
      analyticsEnabled={analyticsEnabled}
    />
    {confirmingExit && <div className="session-exit-backdrop"><section className="session-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="session-exit-title"><div className="session-exit-icon"><Clock3 size={21} /></div><span className="step-label">LEAVE THIS SESSION?</span><h2 id="session-exit-title">Your plan will stay open.</h2><p>YOVA will remember how long you studied and exactly which content steps you reached. Unfinished answers will not be treated as knowledge evidence.</p><div className="session-exit-summary"><span>{formatElapsedDuration(elapsedSeconds)} studied</span><span>{completedRequiredSteps} of {requiredSteps.length} required steps finished</span></div><div className="session-exit-actions"><button className="button ghost" onClick={() => setConfirmingExit(false)}>Keep studying</button><button className="button primary" onClick={onExit}>Save progress and leave</button></div></section></div>}
  </main>;
}

function SessionGuidePanel({ session, capacityMinutes, coverage, steps, step, methodBriefing, supportPlan, sourceGrounding, rationale }: { session: LearningPlanSession | null; capacityMinutes: number | null; coverage: SessionCoverage | null; steps: LessonStep[]; step: number; methodBriefing: SessionMethodBriefing | null; supportPlan: SessionSupportPlan | null; sourceGrounding: SessionSourceGrounding | null; rationale: string | null }) {
  const focus = coverage?.focus ?? session?.objective ?? "Complete the next bounded learning objective.";
  const evidence = coverage?.completionEvidence.length ? coverage.completionEvidence : session?.completionEvidence ?? ["Attempt the required check without hidden support."];
  const ideas = coverage?.essentialIdeas.length ? coverage.essentialIdeas : session?.contentTargets ?? [focus];
  const roadmap = buildMethodPhaseRoadmap(steps.map((item) => item.methodPhase));
  const modeLabel = methodBriefing?.learningMode === "learn" ? "Teaching first" : "Practice first";
  const taskLabel = methodBriefing?.taskType.replaceAll("_", " ") ?? "guided learning";
  const guide = <>
    <div className="session-guide-focus"><span className="step-label">TODAY&apos;S TARGET</span><h2>{focus}</h2><div><Clock3 size={14} /><span>{capacityMinutes ?? session?.estimatedMinutes ?? 20} minute window</span></div></div>
    <div className="session-guide-method"><div><BookOpen size={16} /><span>{modeLabel}</span></div><strong>{methodBriefing?.name ?? "Guided method"}</strong><small>{taskLabel}</small></div>
    {methodBriefing?.personalization[0] && <div className="session-personalization-proof"><Sparkles size={15} /><p><span>Why this fits you</span>{methodBriefing.personalization[0]}</p></div>}
    <div className="session-guide-path"><strong>Session path</strong>{steps.map((item, index) => {
      const presentation = item.methodPhase ? getMethodPhasePresentation(item.methodPhase) : null;
      const state = index < step ? "complete" : index === step ? "current" : "upcoming";
      return <div key={`${index}-${item.label}-${item.title}`} className={state}><span>{state === "complete" ? <Check size={13} /> : index + 1}</span><p><strong>{polishActivityLabel(item.label) || presentation?.label || "Activity"}</strong><small>{presentation?.label ?? item.title}</small></p></div>;
    })}</div>
    <div className="session-guide-evidence"><Target size={15} /><p><span>Finished means</span>{evidence[0]}</p></div>
    <details className="session-guide-details"><summary>Why this plan and method</summary>{methodBriefing && <div className="session-guide-explanation"><strong>What you are doing</strong><p>{methodBriefing.what}</p><strong>Why it fits</strong><p>{methodBriefing.why}</p>{rationale && <p>{rationale}</p>}<strong>How to use it</strong><ol>{methodBriefing.how.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol></div>}<MethodRoadmap steps={steps} />{supportPlan && <SupportProgressionCard plan={supportPlan} />}</details>
    <details className="session-guide-details"><summary>Content and sources</summary><div className="session-guide-lists"><strong>In this session</strong><ul>{ideas.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>{coverage?.evidenceMap.length ? <><strong>How completion is checked</strong><ul>{coverage.evidenceMap.map((mapping) => <li key={`${mapping.essentialIdea}-${mapping.activityConcept}`}>{mapping.essentialIdea}: checked through {mapping.activityConcept}</li>)}</ul></> : null}{coverage?.deferredContent.length ? <><strong>Saved for later</strong><ul>{coverage.deferredContent.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></> : null}</div>{sourceGrounding && <SourceGroundingCard grounding={sourceGrounding} />}</details>
  </>;
  return <aside className="session-guide"><div className="session-guide-desktop">{guide}</div><details className="session-guide-mobile"><summary><span><strong>{methodBriefing?.name ?? "Session path"}</strong><small>Step {step + 1} of {steps.length} · {roadmap.length} learning phases</small></span><ChevronRight size={17} /></summary><div>{guide}</div></details></aside>;
}

function TeachingLessonCard({ teaching }: { teaching: NonNullable<LessonStep["teaching"]> }) {
  const visualSteps = teaching.example?.steps ?? visualModelSteps(teaching.explanation);
  return <section className="teaching-lesson" aria-label="Teaching explanation"><div className="teaching-core"><span>CORE IDEA</span><strong><LearningContent content={teaching.keyIdea} inline /></strong><LearningContent content={teaching.explanation} /></div>{visualSteps.length >= 2 && <TeachingPathDiagram setup={teaching.example?.setup ?? teaching.keyIdea} steps={visualSteps} takeaway={teaching.example?.takeaway ?? teaching.keyIdea} />}{teaching.example && <div className="worked-example"><span>WORKED WALKTHROUGH</span><h3><LearningContent content={teaching.example.setup} inline /></h3><ol>{teaching.example.steps.map((item) => <li key={item}><LearningContent content={item} /></li>)}</ol><div className="worked-example-takeaway"><strong>Takeaway:</strong><LearningContent content={teaching.example.takeaway} inline /></div></div>}{teaching.commonMistake && <div className="common-mistake"><AlertCircle size={17} /><div><span>COMMON MIX-UP</span><s><LearningContent content={teaching.commonMistake.mistake} inline /></s><strong><LearningContent content={teaching.commonMistake.correction} inline /></strong></div></div>}</section>;
}

function visualModelSteps(explanation: string) {
  const sentences = explanation
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/[.!?]+$/, ""))
    .filter((sentence) => sentence.length >= 8);
  if (sentences.length >= 2) return sentences.slice(0, 5);
  return explanation
    .split(/(?:;|:\s+|,\s+(?:then|and then)\s+)/i)
    .map((clause) => clause.trim().replace(/[.!?]+$/, ""))
    .filter((clause) => clause.length >= 8)
    .slice(0, 5);
}

function TeachingPathDiagram({ setup, steps, takeaway }: { setup: string; steps: string[]; takeaway: string }) {
  if (steps.length < 2) return null;
  const visibleSteps = steps.slice(0, 5);
  return <figure className="teaching-path-diagram" aria-label={`Visual model: ${setup}`}><figcaption><span>VISUAL MODEL</span><strong><LearningContent content={setup} inline /></strong></figcaption><div className="teaching-path-flow">{visibleSteps.map((item, index) => <div className="teaching-path-segment" key={`${index}-${item}`}><article><span>{index + 1}</span><LearningContent content={shortVisualLabel(item)} /></article>{index < visibleSteps.length - 1 && <ArrowRight size={18} aria-hidden="true" />}</div>)}</div><div className="teaching-path-takeaway"><Target size={15} /><LearningContent content={takeaway} inline /></div></figure>;
}

function shortVisualLabel(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const beforeDetail = normalized.split(/,\s+(?:where|which|so|then)\b/i)[0]
    .replace(/^(?:start|move|continue|next|then|finally)\s+(?:at|in|into|to|with|outside)?\s*/i, "")
    .trim();
  const words = beforeDetail.split(" ");
  return words.length <= 10 ? beforeDetail : `${words.slice(0, 10).join(" ")}…`;
}

function MethodPhaseCoach({ phase, current, total }: { phase: ReturnType<typeof getMethodPhasePresentation>; current: number; total: number }) {
  return <section className="method-phase-coach" aria-label={`Method phase ${current} of ${total}`}><div><span>METHOD PHASE {current} OF {total}</span><strong>{phase.label}</strong><p>{phase.instruction}</p></div><em>{phase.supportLabel}</em></section>;
}

function MethodRoadmap({ steps, standalone = false }: { steps: LessonStep[]; standalone?: boolean }) {
  const roadmap = buildMethodPhaseRoadmap(steps.map((step) => step.methodPhase));
  if (!roadmap.length) return null;
  return <div className={`method-roadmap ${standalone ? "standalone" : ""}`} aria-label="Session method sequence"><strong>Session method sequence</strong><div>{roadmap.map((phase) => <article key={phase.sequence}><span>{phase.sequence}</span><div><b>{phase.label}</b><small>{phase.supportLabel}</small></div></article>)}</div></div>;
}

function SourceGroundingCard({ grounding }: { grounding: SessionSourceGrounding }) {
  const supplemented = grounding.mode === "materials_plus_ai";
  return <section className={`source-grounding ${supplemented ? "supplemented" : ""}`} aria-label="Session source coverage"><div className="source-grounding-head"><div><span className="step-label">MATERIAL-ANCHORED</span><h2>{supplemented ? "Your material set the scope. YOVA filled the teaching gaps." : "Built directly from your material."}</h2></div><FileText size={20} /></div><p>{grounding.summary}</p><div className="source-grounding-files"><strong>Grounded in</strong>{grounding.sourceNames.map((name, index) => <span key={`${index}-${name}`}>{name}</span>)}</div><details><summary>See what YOVA used{supplemented ? " and added" : ""}</summary><div className="source-anchors">{grounding.anchors.map((anchor, index) => <blockquote key={`${index}-${anchor.sourceName}-${anchor.excerpt}`}><span>{anchor.sourceName}</span><p>“{anchor.excerpt}”</p><small>{anchor.usedFor}</small></blockquote>)}</div>{grounding.supplements.length > 0 && <div className="source-supplements"><strong>YOVA added only what the source did not explain</strong><ul>{grounding.supplements.map((item, index) => <li key={`${index}-${item.topic}`}><span>{item.topic}</span><small>{item.reason}</small></li>)}</ul></div>}</details></section>;
}

function ConfidenceCheck({ value, locked, onChange }: { value: ConfidenceLevel | undefined; locked: boolean; onChange: (value: ConfidenceLevel) => void }) {
  const options: Array<{ value: ConfidenceLevel; label: string }> = [
    { value: "guessing", label: "Mostly guessing" },
    { value: "somewhat_sure", label: "Somewhat sure" },
    { value: "very_sure", label: "Very sure" },
  ];

  return <fieldset className="confidence-check"><legend>One quick confidence check</legend><p>YOVA asks this once in the session to separate a memory slip from a confident misconception.</p><div>{options.map((option) => <button type="button" key={option.value} className={value === option.value ? "selected" : ""} disabled={locked} onClick={() => onChange(option.value)}>{option.label}{value === option.value && <Check size={15} />}</button>)}</div></fieldset>;
}

function SupportProgressionCard({ plan }: { plan: SessionSupportPlan }) {
  const levelLabel = plan.level === "supported_start" ? "Support restored" : plan.level === "fading" ? "Support fading" : "Independent start";
  return <section className={`support-progression ${plan.level}`} aria-label="Support progression"><div><span>{levelLabel}</span><strong>{plan.title}</strong><p>{plan.explanation}</p></div><em>{plan.evidenceLabel}</em></section>;
}

type SessionTutorHelpIntent = NonNullable<TutorRequest["sessionContext"]>["helpIntent"];

function SessionTutor({ plan, activity, outcome, answerRevealed, selectedAnswer, analyticsEnabled }: {
  plan: LearningPlan | null;
  activity: LessonStep;
  outcome: boolean | undefined;
  answerRevealed: boolean;
  selectedAnswer: string | null;
  analyticsEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerState = outcome === true
    ? "correct"
    : outcome === false
      ? answerRevealed ? "revealed" : "incorrect"
      : answerRevealed
        ? "revealed"
        : "not_attempted";
  const teachingSummary = activity.teaching
    ? [activity.teaching.keyIdea, activity.teaching.explanation, activity.teaching.example?.takeaway]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1_200)
    : null;
  const quickActions = sessionTutorQuickActions(activity.type, answerState);

  const ask = async (prompt = question, helpIntent: SessionTutorHelpIntent = "open_question") => {
    const nextQuestion = prompt.trim();
    if (!nextQuestion || pending || !plan) return;
    setPending(true);
    setError(null);
    trackProductEvent({
      eventName: "tutor_message_sent",
      context: { linkedToPlan: true, surface: "guided_session" },
    }, analyticsEnabled);

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: nextQuestion,
          planId: plan.id,
          threadId,
          history: messages.slice(-8).map(({ role, content }) => ({ role, content })),
          sessionContext: {
            activityTitle: activity.title,
            activityType: activity.type,
            activityInstruction: activity.body,
            concept: activity.concept,
            methodPhase: activity.methodPhase ?? null,
            teachingSummary,
            choices: activity.question ?? [],
            referenceAnswer: activity.correctAnswer,
            feedback: activity.feedback,
            answerState,
            selectedChoice: activity.type === "multiple_choice" ? selectedAnswer : null,
            helpIntent,
          },
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not answer during this session.";
        throw new Error(message);
      }

      const parsed = TutorResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The tutor answer came back in an unsafe format.");
      setThreadId(parsed.data.persistence === "supabase" ? parsed.data.threadId : null);
      setMessages((current) => [...current, ...parsed.data.messages]);
      setQuestion("");
      if (parsed.data.persistence === "browser") setError("The answer worked, but this exchange did not reach cloud storage.");
    } catch (requestError) {
      reportProductError({ surface: "tutor", errorCode: "session_tutor_request_failed" });
      setError(requestError instanceof Error ? requestError.message : "YOVA could not answer during this session.");
    } finally {
      setPending(false);
    }
  };

  return <aside className={`session-tutor ${expanded ? "expanded" : "collapsed"}`}>
    {!expanded ? <button className="session-tutor-launcher" aria-expanded="false" onClick={() => setExpanded(true)}><MessageCircleMore size={18} /><span>Ask YOVA</span></button> : <section className="session-tutor-panel" aria-label="Ask YOVA about this session"><header><div><Sparkles size={15} /><span><strong>Help with this step</strong><small>{activity.title}</small></span></div><button aria-label="Close session tutor" onClick={() => setExpanded(false)}><X size={17} /></button></header><div className="session-tutor-quick-actions" aria-label="Quick help options">{quickActions.map((action) => <button key={action.intent} disabled={pending || !plan} onClick={() => void ask(action.prompt, action.intent)}>{action.label}</button>)}</div>{(messages.length > 0 || pending || error) && <div className="session-tutor-response" aria-live="polite">{messages.slice(-6).map((message) => message.role === "assistant" ? <div className="session-tutor-assistant" key={message.id}><span><Sparkles size={14} /> YOVA</span><TutorMessageContent content={message.content} /></div> : <div className="session-tutor-user" key={message.id}><span>You</span><p>{message.content}</p></div>)}{pending && <div className="session-tutor-thinking"><span className="button-spinner dark" /> Building help for this exact step…</div>}{error && <div className="session-tutor-error"><AlertCircle size={15} /> {error}</div>}</div>}<form className="session-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}><input aria-label="Ask YOVA about this session" placeholder="Ask about this exact step…" value={question} disabled={pending || !plan} onChange={(event) => setQuestion(event.target.value)} /><button aria-label="Send session question" type="submit" disabled={!question.trim() || pending || !plan}>{pending ? <span className="button-spinner" /> : <Send size={18} />}</button></form><small className="session-tutor-privacy">YOVA sees the step and result, but not your typed free response.</small></section>}
  </aside>;
}

function sessionTutorQuickActions(activityType: LessonStep["type"], answerState: "not_attempted" | "correct" | "incorrect" | "revealed"): Array<{ label: string; prompt: string; intent: SessionTutorHelpIntent }> {
  if (answerState === "incorrect" || answerState === "revealed") {
    return [
      { label: "Help me repair this", prompt: "Help me repair the specific gap in this step without doing the next attempt for me.", intent: "repair_gap" },
      { label: "Explain it differently", prompt: "Explain the idea in this step in a genuinely different way.", intent: "explain_differently" },
      { label: "Show a similar example", prompt: "Show me a new, similar example without solving this exact check for me.", intent: "show_example" },
    ];
  }
  if (activityType === "multiple_choice" || activityType === "free_response") {
    return [
      { label: "Give me one hint", prompt: "Give me one hint for this step without revealing the answer.", intent: "give_hint" },
      { label: "Explain the idea", prompt: "Explain the core idea for this step in a different way, then let me attempt it.", intent: "explain_differently" },
      { label: "Show a similar example", prompt: "Show me a new, similar example without solving this exact check for me.", intent: "show_example" },
    ];
  }
  return [
    { label: "Explain it differently", prompt: "Explain this step using a genuinely different representation or analogy.", intent: "explain_differently" },
    { label: "Show an example", prompt: "Show me one concrete example of the idea in this step.", intent: "show_example" },
    { label: "Check my understanding", prompt: "Ask me one short question that checks this step, and wait for my answer.", intent: "check_understanding" },
  ];
}

function SessionComplete({ requiredContentCount, repairCount, elapsedSeconds, actualMinutes, correctAnswers, totalAnswers, observedGap, conceptEvidence, confidenceEvidence, nextSession, onFinish }: { requiredContentCount: number; repairCount: number; elapsedSeconds: number; actualMinutes: number; correctAnswers: number; totalAnswers: number; observedGap: string; conceptEvidence: SessionCompletion["conceptEvidence"]; confidenceEvidence: ConfidenceEvidence[]; nextSession: LearningPlanSession | null; onFinish: (feedback: SessionCompletion["feedback"]) => void }) {
  const [feedback, setFeedback] = useState<SessionCompletion["feedback"]>("about_right");
  const hasGap = totalAnswers > 0 && correctAnswers < totalAnswers;
  const willScheduleVerification = !nextSession && hasGap;
  const calibration = summarizeConfidenceCalibration(confidenceEvidence);
  const conceptSummary = summarizeCompletionConcepts(conceptEvidence);
  const proposedAdaptation = buildNextSessionAdaptation(nextSession, {
    id: "completion-preview",
    planId: "completion-preview",
    planSessionId: "completion-preview",
    startedAt: "1970-01-01T00:00:00.000Z",
    completedAt: "1970-01-01T00:00:00.000Z",
    plannedMinutes: nextSession?.estimatedMinutes ?? actualMinutes,
    actualMinutes,
    correctAnswers,
    totalAnswers,
    feedback,
    observedGap,
    conceptEvidence: [],
    confidenceEvidence,
  });
  const nextStatus = willScheduleVerification
    ? { title: "YOVA will verify this after a delay", explanation: "A short check will be ready tomorrow. The time gap matters: immediate repetition can repair an idea, but delayed retrieval gives stronger evidence that it will hold up." }
    : !nextSession
      ? { title: "This learning item is complete", explanation: "There is no remaining session to adjust. This result is still saved to your learning history." }
    : proposedAdaptation
      ? { title: "YOVA will adjust the next session", explanation: proposedAdaptation.explanation }
      : { title: "The next session is ready", explanation: "This result does not justify changing the planned method, so YOVA will continue without inventing an adjustment." };

  return <main className="centered-shell completion"><BrandMark /><section className="completion-card"><header className="completion-heading"><div className={`completion-icon ${hasGap ? "needs-review" : ""}`}>{hasGap ? <RotateCcw size={27} /> : <Check size={28} />}</div><div><span className="step-label">SESSION COMPLETE</span><h1>{hasGap ? "The work is done. One part needs another check." : "Today’s checks held up."}</h1><p>You completed every required step. YOVA uses your answers to decide what comes next; time only records how long the work took.</p></div></header><div className="result-grid"><div><span>Required steps</span><strong>{requiredContentCount} of {requiredContentCount}</strong><small>All attempted</small></div><div><span>Evidence checks</span><strong>{correctAnswers} of {totalAnswers}</strong><small>Answered correctly</small></div><div><span>Time used</span><strong>{formatElapsedDuration(elapsedSeconds)}</strong><small>Recorded, not graded</small></div></div>{conceptSummary.showingStrength.length > 0 || conceptSummary.needsAnotherCheck.length > 0 ? <section className="completion-evidence"><div><span><Check size={15} /> Showing strength today</span>{conceptSummary.showingStrength.length > 0 ? <ul>{conceptSummary.showingStrength.map((concept) => <li key={concept}>{concept}</li>)}</ul> : <p>No concept has enough successful evidence yet.</p>}</div><div className={conceptSummary.needsAnotherCheck.length > 0 ? "needs-review" : ""}><span><RotateCcw size={15} /> Needs another check</span>{conceptSummary.needsAnotherCheck.length > 0 ? <ul>{conceptSummary.needsAnotherCheck.map((concept) => <li key={concept}>{concept}</li>)}</ul> : <p>No gap appeared in today’s required checks.</p>}</div></section> : null}{repairCount > 0 && <div className="repair-completion-summary"><RotateCcw size={19} /><div><strong>{repairCount} immediate {repairCount === 1 ? "repair" : "repairs"} completed</strong><p>You corrected the {repairCount === 1 ? "idea" : "ideas"} before leaving. The original {repairCount === 1 ? "miss remains" : "misses remain"} as evidence so YOVA can verify the learning after a delay.</p></div></div>}{calibration.pattern !== "insufficient" && <div className={`calibration-summary ${calibration.pattern}`}><Target size={19} /><div><strong>{calibration.title}</strong><p>{calibration.explanation}</p></div></div>}<section className="completion-next"><div className="completion-next-icon"><Sparkles size={20} /></div><div><span>NEXT UP</span><h2>{nextSession ? nextSession.title : willScheduleVerification ? "A delayed verification check" : "This learning item is complete"}</h2>{nextSession && <small>{formatAgendaTime(nextSession.scheduledFor)} · {nextSession.estimatedMinutes} minutes</small>}<p>{nextStatus.explanation}</p></div></section><section className="completion-feedback"><div><strong>Help YOVA tune the next session</strong><p>How did the level of challenge feel?</p></div><div className="feeling-row"><button className={feedback === "too_easy" ? "selected" : ""} onClick={() => setFeedback("too_easy")}>Too easy</button><button className={feedback === "about_right" ? "selected" : ""} onClick={() => setFeedback("about_right")}>About right</button><button className={feedback === "too_difficult" ? "selected" : ""} onClick={() => setFeedback("too_difficult")}>Too difficult</button></div></section><button className="button primary large full" onClick={() => onFinish(feedback)}>Save and see what’s next <ArrowRight size={18} /></button></section></main>;
}

function formatElapsedDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function readBoundedIntegerHeader(response: Response, name: string, maximum: number) {
  const parsed = Number(response.headers.get(name));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) return 0;
  return parsed;
}

function formatSessionTime(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(isoDate));
}

function formatAgendaTime(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatAgendaClock(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(isoDate));
}

function agendaDayEyebrow(date: Date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (localDateInput(date.toISOString()) === localDateInput(today.toISOString())) return "TODAY";
  if (localDateInput(date.toISOString()) === localDateInput(tomorrow.toISOString())) return "TOMORROW";
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date).toUpperCase();
}

function agendaFullDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(date);
}

function agendaDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function shortDeadlineDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatReviewType(reviewType: ConceptReviewAgendaItem["reviewType"]) {
  if (reviewType === "repair_and_retrieve") return "Retrieve and repair";
  if (reviewType === "maintenance_transfer") return "Light transfer";
  return "Independent verification";
}

function moveByDays(isoDate: string, days: number) {
  const scheduled = new Date(isoDate);
  const date = scheduled.getTime() > Date.now() ? scheduled : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function toLocalDateTimeInput(isoDate: string) {
  const date = new Date(isoDate);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateInput(isoDate: string) {
  const date = new Date(isoDate);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatPlanDeadline(deadline: string | null) {
  if (!deadline) return "FLEXIBLE";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(deadline)).toUpperCase();
}

function formatCompletionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatFeedback(value?: SessionCompletion["feedback"]) {
  if (value === "too_easy") return "Too easy";
  if (value === "too_difficult") return "Too difficult";
  if (value === "about_right") return "About right";
  return "Not rated";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  FileText,
  Home,
  LibraryBig,
  LogOut,
  Mail,
  MessageCircleMore,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PlanCreator } from "@/components/plan-creator";
import { StudyNowCreator } from "@/components/study-now-creator";
import { trackProductEvent } from "@/lib/analytics/client";
import { describeAuthCallbackResult } from "@/lib/auth/callback-result";
import { AuthConnectionError, getAuthenticatedAccount, getAuthMode, requestEmailAuthentication, signOutAuthenticatedAccount } from "@/lib/auth/client";
import { makeId, makeUuid, type ConceptEvidence, type LearningPlan, type LearningPlanSession, type PreviewAccount, type SessionCompletion, type SessionInterruption } from "@/lib/domain";
import { summarizeConceptEvidence, type ConceptSignal } from "@/lib/learning/concept-evidence";
import { clearPreviewSnapshot, loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";
import { buildPlanProfileSummary } from "@/lib/personalization/profile-summary";
import { buildNextSessionAdaptation } from "@/lib/personalization/session-adaptation";
import { onboardingQuestions } from "@/lib/sample-data";
import { PlanAdjustmentResponseSchema, type PlanAdjustmentRequest } from "@/lib/learning/adjustment-schema";
import { PlanArchiveResponseSchema } from "@/lib/learning/status-schema";
import { MaterialAttachmentResponseSchema } from "@/lib/materials/attachment-schema";
import { deleteUploadedMaterial, uploadMaterialFiles } from "@/lib/materials/intake";
import {
  completeAuthenticatedPlanSession,
  loadAuthenticatedLearningState,
  recordAuthenticatedSessionInterruption,
  saveAuthenticatedLearnerProfile,
} from "@/lib/supabase/learning-state-repository";
import { SessionGenerationResponseSchema } from "@/lib/session-generation/schema";
import { buildPreviewSessionContext } from "@/lib/session-generation/preview-context";
import { RescheduleSessionResponseSchema } from "@/lib/scheduling/schema";
import { SessionDurationAdjustmentResponseSchema } from "@/lib/scheduling/session-adjustment-schema";
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
  type TutorMessage,
  type TutorProposedAction,
} from "@/lib/tutor/schema";

type Stage = "landing" | "account" | "onboarding-intro" | "onboarding" | "profile" | "paywall" | "app" | "plan-creator" | "study-now" | "session-loading" | "session-error" | "session" | "complete";
type Tab = "Home" | "Learning" | "Agenda" | "Ask YOVA" | "You";
type AccountMode = "create" | "sign-in";
type LessonStep = {
  type: "instruction" | "multiple_choice" | "free_response" | "reflection";
  concept: string | null;
  label: string;
  title: string;
  body: string;
  question: string[] | null;
  correctAnswer: string | null;
  feedback: string | null;
};

const navItems: Array<{ label: Tab; icon: typeof Home }> = [
  { label: "Home", icon: Home },
  { label: "Learning", icon: LibraryBig },
  { label: "Agenda", icon: CalendarDays },
  { label: "Ask YOVA", icon: MessageCircleMore },
  { label: "You", icon: CircleUserRound },
];

export function YovaPrototype() {
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
  const [sessionCompletions, setSessionCompletions] = useState<SessionCompletion[]>([]);
  const [sessionInterruptions, setSessionInterruptions] = useState<SessionInterruption[]>([]);
  const [sessionStep, setSessionStep] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [sessionOutcomes, setSessionOutcomes] = useState<Record<number, boolean>>({});
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [generatedLessonSteps, setGeneratedLessonSteps] = useState<LessonStep[] | null>(null);
  const [sessionRationale, setSessionRationale] = useState<string | null>(null);
  const [sessionGenerationIssue, setSessionGenerationIssue] = useState<string | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionCompletedAt, setSessionCompletedAt] = useState<string | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [cloudSyncIssue, setCloudSyncIssue] = useState<string | null>(null);
  const [authStartupIssue, setAuthStartupIssue] = useState<string | null>(null);
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
  const [tutorQuestion, setTutorQuestion] = useState("");
  const analyticsEnabled = account?.identityMode === "supabase";

  const activePlans = plans.filter((plan) => plan.status === "active");
  const activePlan = activePlans.find((plan) => plan.id === selectedPlanId) ?? activePlans[activePlans.length - 1] ?? null;
  const recommendedPlan = chooseRecommendedPlan(activePlans);
  const activeLessonSteps = generatedLessonSteps ?? lessonStepsFor(activePlan);
  const sessionCorrectAnswers = Object.values(sessionOutcomes).filter(Boolean).length;
  const sessionTotalAnswers = activeLessonSteps.filter((step) => step.type === "multiple_choice" || step.type === "free_response").length;
  const sessionConceptEvidence = activeLessonSteps.flatMap<ConceptEvidence>((step, index) => {
    const outcome = sessionOutcomes[index];
    if ((step.type !== "multiple_choice" && step.type !== "free_response") || !step.concept || outcome === undefined) return [];
    return [{
      concept: step.concept,
      outcome: outcome ? "secure" : "needs_review",
      activityType: step.type,
    }];
  });
  const sessionObservedGap = activeLessonSteps
    .filter((step, index) => (step.type === "multiple_choice" || step.type === "free_response") && sessionOutcomes[index] === false)
    .map((step) => step.concept ?? step.title)
    .join("; ") || "No major gap detected in the required check";
  const capturedSessionSeconds = Math.max(1, sessionElapsedSeconds);
  const capturedSessionMinutes = Math.max(1, Math.ceil(capturedSessionSeconds / 60));

  useEffect(() => {
    let cancelled = false;

    async function openYova() {
      const callbackIssue = consumeAuthCallbackIssue();
      if (callbackIssue) setAuthStartupIssue(callbackIssue);
      const saved = loadPreviewSnapshot();
      const authMode = getAuthMode();
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

      let cloudAccount: PreviewAccount | null;
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
        resumed,
      },
    }, analyticsEnabled);
    setSessionStartedAt(new Date().getTime());
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setStage("session");
  };

  const startSession = async (planId?: string, planOverride?: LearningPlan) => {
    const requestedPlan = planOverride ?? activePlans.find((plan) => plan.id === planId) ?? activePlan;
    if (!requestedPlan) return;

    const requestedSession = requestedPlan.sessions.find((session) => session.status === "ready")
      ?? requestedPlan.sessions.find((session) => session.status === "upcoming");
    if (!requestedSession) return;
    const resumePoint = resumableSessionProgress(requestedSession.id, sessionInterruptions);

    setSelectedPlanId(requestedPlan.id);
    setSessionStep(0);
    setSelectedAnswer(null);
    setSessionOutcomes({});
    setAnswerRevealed(false);
    setGeneratedLessonSteps(null);
    setSessionRationale(null);
    setSessionGenerationIssue(null);
    setSessionStartedAt(null);
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setStage("session-loading");

    try {
      const response = await fetch("/api/sessions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: requestedPlan.id,
          planSessionId: requestedSession.id,
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
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
          ? body.error
          : "YOVA could not generate this guided session.";
        throw new Error(message);
      }

      const parsed = SessionGenerationResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("The generated session came back in an unsafe format.");

      const nextLessonSteps = parsed.data.session.activities.map((activity) => ({
        type: activity.type,
        concept: activity.concept,
        label: activity.label,
        title: activity.title,
        body: activity.body,
        question: activity.type === "multiple_choice" ? activity.choices : null,
        correctAnswer: activity.correctAnswer,
        feedback: activity.feedback,
      }));
      setGeneratedLessonSteps(nextLessonSteps);
      if (resumePoint) setSessionStep(Math.min(resumePoint.completedSteps, nextLessonSteps.length - 1));
      setSessionRationale(parsed.data.session.rationale);
      if (parsed.data.generation.persistence === "browser" && account?.identityMode === "supabase") {
        setSessionGenerationIssue("This session is ready, but YOVA could not cache it in your cloud account.");
      }
      beginTimedSession(requestedPlan, Boolean(resumePoint));
    } catch (error) {
      const message = error instanceof Error ? error.message : "YOVA could not generate this session.";
      if (requestedPlan.sourceMode === "user_materials") {
        setSessionGenerationIssue(message);
        setStage("session-error");
        return;
      }
      const fallbackSteps = lessonStepsFor(requestedPlan);
      setGeneratedLessonSteps(fallbackSteps);
      if (resumePoint) setSessionStep(Math.min(resumePoint.completedSteps, fallbackSteps.length - 1));
      setSessionRationale(requestedSession.methodReason);
      setSessionGenerationIssue(`${message} A safe built-in session was loaded instead.`);
      beginTimedSession(requestedPlan, Boolean(resumePoint));
    }
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
      plannedMinutes: currentSession.estimatedMinutes,
      actualMinutes,
      correctAnswers,
      totalAnswers,
      feedback,
      observedGap: sessionObservedGap,
      conceptEvidence: sessionConceptEvidence,
    };
    const nextSession = activePlan.sessions.find((session) => session.sequence === currentSession.sequence + 1) ?? null;
    const adaptation = buildNextSessionAdaptation(nextSession, completion);

    trackProductEvent({
      eventName: "session_completed",
      context: {
        plannedMinutes: completion.plannedMinutes,
        actualMinutes: completion.actualMinutes,
        correctAnswers: completion.correctAnswers,
        totalAnswers: completion.totalAnswers,
        feedback: completion.feedback,
        adaptedNextSession: adaptation !== null,
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
              status: "ready" as const,
            }
            : { ...session, status: "ready" as const };
        }
        return session;
      });
      return {
        ...plan,
        status: updatedSessions.some((session) => session.status === "ready" || session.status === "upcoming")
          ? plan.status
          : "completed",
        sessions: updatedSessions,
      };
    }));

    setSessionCompletions((current) => [...current, completion]);

    if (account?.identityMode === "supabase") {
      queueSessionCompletion({
        userId: account.id,
        completion,
        adaptation,
        queuedAt: new Date().toISOString(),
      });
      void completeAuthenticatedPlanSession(completion, adaptation)
        .then(() => {
          removeQueuedSessionCompletion(completion.id);
          setCloudSyncIssue(null);
        })
        .catch((error: unknown) => {
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
    const interruption: SessionInterruption = {
      id: makeUuid(),
      planId: activePlan.id,
      planSessionId: currentSession.id,
      startedAt: new Date(sessionStartedAt).toISOString(),
      interruptedAt: interruptedAt.toISOString(),
      plannedMinutes: currentSession.estimatedMinutes,
      actualMinutes,
      completedSteps: Math.min(sessionStep, activeLessonSteps.length),
      totalSteps: activeLessonSteps.length,
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
    setAnswerRevealed(false);
    setGeneratedLessonSteps(null);
    setSessionRationale(null);
    setSessionGenerationIssue(null);
    setSessionStartedAt(null);
    setSessionCompletedAt(null);
    setSessionElapsedSeconds(0);
    setCloudSyncIssue(null);
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
    const sessionUpdates = new Map(parsed.data.sessions.map((session) => [session.id, session]));
    setPlans((current) => current.map((plan) => {
      if (plan.id !== parsed.data.planId) return plan;
      return {
        ...plan,
        deadline: parsed.data.deadline,
        studyMode: parsed.data.studyMode,
        sessions: plan.sessions.map((session) => {
          const update = sessionUpdates.get(session.id);
          return update ? { ...session, estimatedMinutes: update.estimatedMinutes, amountLabel: update.amountLabel } : session;
        }),
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
    } : plan));
  };

  const applyTutorAction = async (action: TutorProposedAction) => {
    const response = await fetch("/api/sessions/duration", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planSessionId: action.planSessionId,
        estimatedMinutes: action.minutes,
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
        ? body.error
        : "YOVA could not apply that change.";
      throw new Error(message);
    }

    const parsed = SessionDurationAdjustmentResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error("The changed session came back in an unsafe format.");
    setPlans((current) => current.map((plan) => plan.id === parsed.data.planId ? {
      ...plan,
      sessions: plan.sessions.map((session) => session.id === parsed.data.planSessionId ? {
        ...session,
        estimatedMinutes: parsed.data.estimatedMinutes,
        amountLabel: parsed.data.amountLabel,
      } : session),
    } : plan));
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
    return <AccountEntry mode={accountMode} existingAccount={account} onBack={() => setStage("landing")} onContinue={(nextAccount) => {
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
        sessionCount: plan.sessions.length,
      },
    }, analyticsEnabled);
    setPlans((current) => [...current, plan]);
    setSelectedPlanId(plan.id);
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
        sessionCount: plan.sessions.length,
      },
    }, analyticsEnabled);
    setPlans((current) => [...current, plan]);
    setSelectedPlanId(plan.id);
    void startSession(plan.id, plan);
  }} />;
  if (stage === "session-loading") return <SessionLoading plan={activePlan} onExit={() => setStage("app")} />;
  if (stage === "session-error") return <SessionGenerationError plan={activePlan} issue={sessionGenerationIssue} onExit={() => setStage("app")} onRetry={() => void startSession(activePlan?.id)} />;
  if (stage === "session") {
    return (
      <GuidedSession
        plan={activePlan}
        steps={activeLessonSteps}
        step={sessionStep}
        selectedAnswer={selectedAnswer}
        outcome={sessionOutcomes[sessionStep]}
        answerRevealed={answerRevealed}
        elapsedSeconds={sessionElapsedSeconds}
        rationale={sessionRationale}
        issue={sessionGenerationIssue}
        analyticsEnabled={analyticsEnabled}
        onSelect={(answer) => {
          setSelectedAnswer(answer);
        }}
        onEvaluate={(correct) => {
          setSessionOutcomes((current) => ({ ...current, [sessionStep]: correct }));
        }}
        onReveal={() => setAnswerRevealed(true)}
        onExit={interruptActiveSession}
        onNext={() => {
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
    return <SessionComplete stepCount={activeLessonSteps.length} elapsedSeconds={capturedSessionSeconds} actualMinutes={capturedSessionMinutes} correctAnswers={sessionCorrectAnswers} totalAnswers={sessionTotalAnswers} observedGap={sessionObservedGap} nextSession={nextSession} onFinish={(feedback) => { completeActiveSession(sessionCorrectAnswers, sessionTotalAnswers, feedback, capturedSessionMinutes); setStage("app"); setActiveTab("Home"); }} />;
  }

  return (
    <AppShell activeTab={activeTab} onTab={setActiveTab} account={account} cloudSyncIssue={cloudSyncIssue} onRetryCloudSync={retryCloudSync} onSignOut={() => {
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
      {activeTab === "Home" && <HomeScreen account={account} plans={activePlans} plan={recommendedPlan} sessionInterruptions={sessionInterruptions} tutorQuestion={tutorQuestion} onTutorQuestion={setTutorQuestion} onOpenTutor={() => setActiveTab("Ask YOVA")} onStart={() => void startSession(recommendedPlan?.id)} onOpenPlan={(planId) => { setSelectedPlanId(planId); setActiveTab("Learning"); }} onCreatePlan={() => setStage("plan-creator")} onStudyNow={() => setStage("study-now")} />}
      {activeTab === "Learning" && <LearningScreen plans={plans} selectedPlanId={selectedPlanId} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} onSelectPlan={setSelectedPlanId} onStart={(planId) => void startSession(planId)} onCreatePlan={() => setStage("plan-creator")} onArchiveStateChange={changePlanArchiveState} onAdjustPlan={adjustPlan} onAttachMaterials={attachMaterials} />}
      {activeTab === "Agenda" && <AgendaScreen plans={activePlans} sessionInterruptions={sessionInterruptions} onStart={(planId) => void startSession(planId)} onReschedule={rescheduleSession} />}
      {activeTab === "Ask YOVA" && <AskScreen key={activePlan?.id ?? "general"} plan={activePlan} question={tutorQuestion} onQuestion={setTutorQuestion} onApplyAction={applyTutorAction} analyticsEnabled={analyticsEnabled} />}
      {activeTab === "You" && <YouScreen account={account} answers={answers} sessionCompletions={sessionCompletions} sessionInterruptions={sessionInterruptions} onAnswersChange={setAnswers} onReset={resetYovaData} />}
    </AppShell>
  );
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
        <span className="eyebrow"><Sparkles size={15} /> Personalized around how you actually study</span>
        <h1>Know exactly what<br />to study next.</h1>
        <p>Tell YOVA what you need to learn. It figures out where you are, builds the plan, and guides each session.</p>
        <div className="hero-actions"><button className="button primary large" onClick={onCreate}>Create account <ArrowRight size={18} /></button><a className="button secondary large" href="#how-yova-works">See how it works</a></div>
        <div className="product-proof">
          <div><strong>What</strong><span>Cellular respiration retrieval</span></div>
          <div><strong>Why now</strong><span>Your test is in four days.</span></div>
          <div><strong>How</strong><span>12 closed-note questions, then repair gaps.</span></div>
        </div>
      </section>
      <section className="how-yova-works" id="how-yova-works">
        <div><span className="step-label">HOW YOVA WORKS</span><h2>Personalization becomes a study session.</h2><p>YOVA keeps the first experience simple while using your goal, schedule, current knowledge, and learning tendencies underneath.</p></div>
        <div className="how-steps"><article><span>1</span><h3>Tell YOVA about you</h3><p>Answer ten short questions about guidance, focus, starting, explanations, and realistic session length.</p></article><article><span>2</span><h3>Add a goal—not necessarily a file</h3><p>Upload your own materials, ask YOVA to create the content, or use YOVA as a guide while studying elsewhere.</p></article><article><span>3</span><h3>Follow one clear next step</h3><p>YOVA builds the plan, explains the selected method, guides the session, and uses the result when deciding what comes next.</p></article></div>
        <button className="button primary large" onClick={onCreate}>Build my YOVA <ArrowRight size={18} /></button>
      </section>
    </main>
  );
}

function AccountEntry({ mode, existingAccount, onBack, onContinue }: { mode: AccountMode; existingAccount: PreviewAccount | null; onBack: () => void; onContinue: (account: PreviewAccount) => void }) {
  const [displayName, setDisplayName] = useState(existingAccount?.displayName ?? "");
  const [email, setEmail] = useState(existingAccount?.email ?? "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const isCreate = mode === "create";
  const authMode = getAuthMode();

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
      const result = await requestEmailAuthentication({
        email: normalizedEmail,
        displayName: displayName.trim(),
        shouldCreateUser: isCreate,
      });

      if (result.mode === "supabase") {
        setEmailSent(true);
        return;
      }

      onContinue(existingAccount && !isCreate ? existingAccount : {
        id: makeId("preview_user"),
        email: normalizedEmail,
        displayName: displayName.trim(),
        createdAt: new Date().toISOString(),
        identityMode: "preview",
      });
    } catch (authenticationError) {
      setError(authenticationError instanceof Error ? authenticationError.message : "YOVA could not start sign-in. Try again.");
    } finally {
      setPending(false);
    }
  };

  if (emailSent) {
    return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card email-sent"><div className="mail-check"><Mail size={24} /></div><span className="step-label">CHECK YOUR EMAIL</span><h1>Your secure sign-in link is on its way.</h1><p>Open the message sent to <strong>{email.trim().toLowerCase()}</strong>. The link will bring you back to YOVA and finish signing you in.</p><button className="button primary large full" onClick={() => window.location.reload()}>I opened the link — check sign-in</button><button className="button secondary large full" onClick={() => setEmailSent(false)}>Use a different email</button><div className="preview-notice"><strong>Use the same browser</strong><span>For this private alpha, open the email link in the browser where you requested it. If the link opened a new tab, return here and check sign-in.</span></div></section></main>;
  }

  return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card"><span className="step-label">{isCreate ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span><h1>{isCreate ? "Start building your YOVA." : "Continue your learning."}</h1><p>{isCreate ? "Your account keeps your profile, plans, sessions, and progress together." : authMode === "supabase" ? "Enter your email and YOVA will send you a secure sign-in link." : "Use the email attached to this browser’s private-alpha account."}</p>{isCreate && <label><span>First name</span><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} autoComplete="given-name" disabled={pending} /></label>}<label><span>Email address</span><div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" disabled={pending} /></div></label>{error && <p className="form-error">{error}</p>}<button className="button primary large full" onClick={() => void submit()} disabled={pending}>{pending ? "Sending secure link…" : isCreate ? "Continue" : "Sign in"} {!pending && <ArrowRight size={18} />}</button><div className="preview-notice"><strong>{authMode === "supabase" ? "Secure cloud account" : "Private-alpha storage"}</strong><span>{authMode === "supabase" ? "YOVA uses a temporary email link instead of storing a password." : "For now, this browser remembers the prototype. Real email verification activates when the cloud project is connected."}</span></div></section></main>;
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
  return <main className="centered-shell"><BrandMark /><section className="setup-card"><span className="step-label">SET UP YOUR YOVA</span><h1>Make YOVA fit how you actually study.</h1><p>Ten short questions help YOVA build realistic plans, choose useful methods, and guide you at the right level. About two minutes.</p><div className="info-strip"><Sparkles size={20} /><span>This creates starting preferences—not a brain type. YOVA will update carefully based on what you actually do.</span></div><button className="button primary large full" onClick={onStart}>Personalize YOVA <ArrowRight size={18} /></button></section></main>;
}

function OnboardingQuestion({ index, answer, onAnswer, onNext, onBack }: { index: number; answer?: string; onAnswer: (answer: string) => void; onNext: () => void; onBack: () => void }) {
  const question = onboardingQuestions[index];
  return <main className="onboarding-shell"><header><BrandMark /><span>{index + 1} of {onboardingQuestions.length}</span></header><div className="progress-track"><div style={{ width: `${((index + 1) / onboardingQuestions.length) * 100}%` }} /></div><section className="question-wrap"><span className="step-label">YOUR STARTING PROFILE</span><h2>{question.prompt}</h2>{question.optional && <p className="muted">Optional — you can skip this or change it later.</p>}<div className="option-list">{question.options.map((option) => <button key={option} className={`option ${answer === option ? "selected" : ""}`} onClick={() => onAnswer(option)}><span>{option}</span>{answer === option && <Check size={18} />}</button>)}</div><footer className="question-footer"><button className="button ghost" onClick={onBack} disabled={index === 0}><ArrowLeft size={17} /> Back</button><button className="button primary" onClick={onNext} disabled={!answer && !question.optional}>{index === onboardingQuestions.length - 1 ? "Build my setup" : "Continue"} <ArrowRight size={17} /></button></footer></section></main>;
}

function ProfileSummary({ answers, onContinue }: { answers: string[]; onContinue: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card wide"><span className="eyebrow"><Sparkles size={15} /> Your starting setup</span><h1>YOVA will begin like this.</h1><p>This is a transparent starting point based on your answers. It can change as you update your preferences and complete sessions.</p><div className="profile-grid"><ProfileItem title="Guidance" value={answers[1] || "Not answered yet"} note="Controls how much YOVA decides for you" /><ProfileItem title="Session size" value={answers[2] || "Not answered yet"} note="Used as a starting estimate" /><ProfileItem title="Explanations" value={answers[3] || "Not answered yet"} note="Shapes how difficult material is introduced" /><ProfileItem title="Focus pattern" value={answers[4] || "Not answered yet"} note="Helps YOVA keep sessions manageable" /></div><button className="button primary large full" onClick={onContinue}>Continue <ArrowRight size={18} /></button></section></main>;
}

function ProfileItem({ title, value, note }: { title: string; value: string; note: string }) { return <div className="profile-item"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>; }

function PaywallPreview({ onContinue }: { onContinue: () => void }) {
  return <main className="centered-shell dark"><BrandMark /><section className="setup-card paywall"><span className="step-label">YOVA LITE</span><h1>A study system built around you.</h1><p>Plans, method selection, guided sessions, progress memory, and adjustments based on what happens next.</p><ul className="check-list"><li><Check /> Determine what you already know</li><li><Check /> Choose methods that fit the task and your tendencies</li><li><Check /> Tell you exactly how to perform each method</li><li><Check /> Adjust the next session using your results</li></ul><button className="button primary large full" onClick={onContinue}>Continue to private alpha</button><small>Payments will be connected after the core experience is validated.</small></section></main>;
}

function AppShell({ activeTab, onTab, account, cloudSyncIssue, onRetryCloudSync, onSignOut, children }: { activeTab: Tab; onTab: (tab: Tab) => void; account: PreviewAccount | null; cloudSyncIssue: string | null; onRetryCloudSync: () => Promise<void>; onSignOut: () => void; children: React.ReactNode }) {
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
  return <div className="app-shell"><aside className="sidebar"><BrandMark /> <nav>{navItems.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? "active" : ""} onClick={() => onTab(label)}><Icon size={19} />{label}</button>)}</nav><div className="sidebar-bottom"><button onClick={onSignOut}><LogOut size={18} /> Sign out</button><div className="account-dot">{initial}</div><div><strong>{account?.displayName || "YOVA user"}</strong><span>{account?.identityMode === "supabase" ? "Cloud account" : "Private alpha"}</span></div></div></aside><main className="app-content">{cloudSyncIssue && <div className="cloud-sync-warning"><strong>Cloud sync needs attention.</strong><span>{cloudSyncIssue} Your latest work is still saved in this browser.</span><button disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Retry now"}</button></div>}{children}</main></div>;
}

function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <header className="page-header">{eyebrow && <span className="step-label">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</header>; }

function HomeScreen({ account, plans, plan, sessionInterruptions, tutorQuestion, onTutorQuestion, onOpenTutor, onStart, onOpenPlan, onCreatePlan, onStudyNow }: { account: PreviewAccount | null; plans: LearningPlan[]; plan: LearningPlan | null; sessionInterruptions: SessionInterruption[]; tutorQuestion: string; onTutorQuestion: (question: string) => void; onOpenTutor: () => void; onStart: () => void; onOpenPlan: (planId: string) => void; onCreatePlan: () => void; onStudyNow: () => void }) {
  const readySession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  const resumePoint = readySession ? resumableSessionProgress(readySession.id, sessionInterruptions) : null;
  const completedCount = plan?.sessions.filter((session) => session.status === "complete").length ?? 0;
  const firstName = account?.displayName.split(" ")[0] || "there";
  const now = new Date();

  return <div className="page"><PageHeader eyebrow={formatHomeDate(now)} title={`${greetingFor(now)}, ${firstName}.`} description="Here is the most useful next step across your active learning." />{plan && readySession ? <section className="recommendation-card"><div className="rec-top"><span className="eyebrow light"><Sparkles size={15} /> {resumePoint ? "Continue where you left off" : "Recommended next"}</span><span>{completedCount} of {plan.sessions.length} sessions complete</span></div><div className="rec-body"><div><span className="subject-label">{plan.title.toUpperCase()}</span><h2>{readySession.title}</h2><div className="meta-row"><span><Target size={16} /> {readySession.method}</span><span><Clock3 size={16} /> {readySession.amountLabel}</span>{resumePoint && <span><Check size={16} /> {resumePoint.completedSteps} sections saved</span>}</div></div><button className="button white large" onClick={onStart}>{resumePoint ? "Continue session" : "Start session"} <ArrowRight size={18} /></button></div><div className="reason-grid"><div><strong>{resumePoint ? "Where you will resume" : "Why now"}</strong><p>{resumePoint ? `YOVA saved your first ${resumePoint.completedSteps} ${resumePoint.completedSteps === 1 ? "section" : "sections"}. You will continue with the next unfinished activity.` : recommendationReason(plan, readySession, now)}</p></div><div><strong>Why this method</strong><p>{readySession.methodReason}</p></div></div></section> : <section className="empty-home"><span className="eyebrow"><Sparkles size={15} /> Start here</span><h2>What do you want to learn?</h2><p>Start one focused session now or build a plan for a larger goal. Materials are optional.</p><div className="empty-home-actions"><button className="button primary large" onClick={onStudyNow}>Study something now <ArrowRight size={18} /></button><button className="button secondary large" onClick={onCreatePlan}>Create a plan</button></div></section>}<AskBar value={tutorQuestion} onChange={onTutorQuestion} onSubmit={onOpenTutor} /><section className="quick-actions"><button onClick={onStudyNow}><Plus size={18} /><span><strong>Study something now</strong><small>Build one focused session</small></span></button><button onClick={onCreatePlan}><BookOpen size={18} /><span><strong>{plan ? "Create another plan" : "Create a plan"}</strong><small>Prepare for a larger goal</small></span></button></section>{plans.length > 0 && <section className="section-block"><div className="section-title"><h3>Active learning</h3><span>{plans.length} {plans.length === 1 ? "goal" : "goals"}</span></div><div className="compact-items">{plans.map((item) => { const next = item.sessions.find((session) => session.status === "ready"); const saved = next ? resumableSessionProgress(next.id, sessionInterruptions) : null; return <button className={item.id === plan?.id ? "selected" : ""} key={item.id} onClick={() => onOpenPlan(item.id)}><span className="item-icon blue">{item.title.charAt(0)}</span><span><strong>{item.title}</strong><small>{next ? saved ? `Continue at section ${saved.completedSteps + 1}` : `${next.method} · ${formatSessionTime(next.scheduledFor)}` : "Plan complete"}</small></span><ChevronRight /></button>; })}</div></section>}</div>;
}

function resumableSessionProgress(planSessionId: string, interruptions: SessionInterruption[]) {
  const matching = interruptions.filter((interruption) => interruption.planSessionId === planSessionId);
  if (matching.length !== 1) return null;
  const interruption = matching[0];
  if (interruption.completedSteps < 1 || interruption.completedSteps >= interruption.totalSteps) return null;
  return interruption;
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

function LearningScreen({ plans, selectedPlanId, sessionCompletions, sessionInterruptions, onSelectPlan, onStart, onCreatePlan, onArchiveStateChange, onAdjustPlan, onAttachMaterials }: { plans: LearningPlan[]; selectedPlanId: string | null; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; onSelectPlan: (planId: string) => void; onStart: (planId: string) => void; onCreatePlan: () => void; onArchiveStateChange: (planId: string, action: "archive" | "restore") => Promise<LearningPlan["status"]>; onAdjustPlan: (input: PlanAdjustmentRequest) => Promise<void>; onAttachMaterials: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [view, setView] = useState<"active" | "recent" | "archive">("active");
  const [browsedPlanId, setBrowsedPlanId] = useState<string | null>(null);
  const [changingPlanId, setChangingPlanId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const visiblePlans = plans.filter((plan) => {
    if (view === "active") return plan.status === "active";
    if (view === "recent") return plan.status === "completed";
    return plan.status === "archived";
  });
  const preferredId = view === "active" ? selectedPlanId : browsedPlanId;
  const plan = visiblePlans.find((item) => item.id === preferredId) ?? visiblePlans.at(-1) ?? null;
  const viewLabels = {
    active: { empty: "No active learning yet.", description: "Start one focused session or create a plan for a larger goal." },
    recent: { empty: "No completed studies yet.", description: "Finished sessions and plans will remain here so you can review what happened." },
    archive: { empty: "Nothing is archived.", description: "Learning items you intentionally put away will appear here." },
  };

  const selectPlan = (planId: string) => {
    setBrowsedPlanId(planId);
    if (view === "active") onSelectPlan(planId);
  };

  const changeArchiveState = async (planId: string, action: "archive" | "restore") => {
    setChangingPlanId(planId);
    setStatusError(null);
    try {
      const status = await onArchiveStateChange(planId, action);
      setBrowsedPlanId(null);
      if (status === "archived") setView("archive");
      else setView(status === "completed" ? "recent" : "active");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "YOVA could not update that learning goal.");
    } finally {
      setChangingPlanId(null);
    }
  };

  return <div className="page">
    <PageHeader eyebrow="LEARNING" title="What you’re working toward" description="Each goal keeps its plan, sessions, methods, and progress together." />
    <div className="tabs">
      <button className={view === "active" ? "active" : ""} onClick={() => { setView("active"); setBrowsedPlanId(null); }}>Active</button>
      <button className={view === "recent" ? "active" : ""} onClick={() => { setView("recent"); setBrowsedPlanId(null); }}>Recent studies</button>
      <button className={view === "archive" ? "active" : ""} onClick={() => { setView("archive"); setBrowsedPlanId(null); }}>Archive</button>
    </div>
    {statusError && <div className="chat-error"><AlertCircle size={16} /><span>{statusError}</span></div>}
    {!plan ? <section className="empty-home"><h2>{viewLabels[view].empty}</h2><p>{viewLabels[view].description}</p>{view === "active" && <div className="empty-home-actions"><button className="button primary" onClick={onCreatePlan}>Create a plan</button></div>}</section> : <LearningPlanDetail plan={plan} plans={visiblePlans} view={view} completions={sessionCompletions.filter((completion) => completion.planId === plan.id)} interruptions={sessionInterruptions.filter((interruption) => interruption.planId === plan.id)} changingStatus={changingPlanId === plan.id} onSelectPlan={selectPlan} onStart={() => onStart(plan.id)} onArchiveStateChange={(action) => void changeArchiveState(plan.id, action)} onAdjustPlan={onAdjustPlan} onAttachMaterials={onAttachMaterials} />}
  </div>;
}

function LearningPlanDetail({ plan, plans, view, completions, interruptions, changingStatus, onSelectPlan, onStart, onArchiveStateChange, onAdjustPlan, onAttachMaterials }: { plan: LearningPlan; plans: LearningPlan[]; view: "active" | "recent" | "archive"; completions: SessionCompletion[]; interruptions: SessionInterruption[]; changingStatus: boolean; onSelectPlan: (planId: string) => void; onStart: () => void; onArchiveStateChange: (action: "archive" | "restore") => void; onAdjustPlan: (input: PlanAdjustmentRequest) => Promise<void>; onAttachMaterials: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [showAdjustments, setShowAdjustments] = useState(false);
  const completeCount = plan.sessions.filter((session) => session.status === "complete").length;
  const readySession = plan.sessions.find((session) => session.status === "ready");
  const resumePoint = readySession ? resumableSessionProgress(readySession.id, interruptions) : null;
  const totalCorrect = completions.reduce((sum, completion) => sum + completion.correctAnswers, 0);
  const totalChecks = completions.reduce((sum, completion) => sum + completion.totalAnswers, 0);
  const accuracy = totalChecks ? `${Math.round((totalCorrect / totalChecks) * 100)}%` : "—";
  const conceptSignals = summarizeConceptEvidence(completions);

  return <>
    {plans.length > 1 && <div className="plan-switcher">{plans.map((item) => { const done = item.sessions.filter((session) => session.status === "complete").length; return <button className={item.id === plan.id ? "selected" : ""} key={item.id} onClick={() => onSelectPlan(item.id)}><span>{item.kind}</span><strong>{item.title}</strong><small>{done} of {item.sessions.length} sessions</small></button>; })}</div>}
    <section className="learning-hero"><div><span className="subject-label">{plan.kind.toUpperCase()} · {formatPlanDeadline(plan.deadline)}</span><h2>{plan.title}</h2><p>{plan.topic}</p><div className="progress-line"><div style={{ width: `${(completeCount / plan.sessions.length) * 100}%` }} /></div><small>{resumePoint ? `${resumePoint.completedSteps} of ${resumePoint.totalSteps} sections saved in the current session` : `${completeCount} of ${plan.sessions.length} sessions complete`}</small></div><div className="learning-hero-actions">{view === "active" && readySession && <button className="button primary" onClick={onStart}>{resumePoint ? "Continue session" : "Start next session"}</button>}{view === "active" && <button className="button hero-secondary" onClick={() => setShowAdjustments((value) => !value)}><Settings2 size={16} /> {showAdjustments ? "Close" : "Adjust"}</button>}<button className="button hero-secondary" disabled={changingStatus} onClick={() => onArchiveStateChange(view === "archive" ? "restore" : "archive")}>{changingStatus ? <span className="button-spinner" /> : view === "archive" ? <><RotateCcw size={16} /> Restore</> : <><Archive size={16} /> Archive</>}</button></div></section>
    {view === "active" && showAdjustments && <PlanAdjustmentPanel plan={plan} onCancel={() => setShowAdjustments(false)} onSave={async (input) => { await onAdjustPlan(input); setShowAdjustments(false); }} />}
    {view === "recent" && <section className="learning-history-summary"><div><span>Completed</span><strong>{formatCompletionDate(completions.at(-1)?.completedAt ?? plan.createdAt)}</strong></div><div><span>Knowledge-check accuracy</span><strong>{accuracy}</strong></div><div><span>Last session felt</span><strong>{formatFeedback(completions.at(-1)?.feedback)}</strong></div></section>}
    <PlanSources plan={plan} editable={view === "active"} onAttach={onAttachMaterials} />
    <ConceptSignalsPanel signals={conceptSignals} />
    <section className="section-block"><div className="section-title"><h3>{view === "recent" ? "What you completed" : "Plan timeline"}</h3><span>{plan.sourceMode === "user_materials" ? "Your materials" : "YOVA-created content"}</span></div><div className="timeline">{plan.sessions.map((session) => <div className={`timeline-row ${session.status}`} key={session.id}><span className="timeline-node">{session.status === "complete" ? <Check size={15} /> : null}</span><div><strong>{session.title}</strong><small>{session.method} · {formatSessionTime(session.scheduledFor)}</small></div><span>{session.estimatedMinutes} min</span></div>)}</div></section>
  </>;
}

function ConceptSignalsPanel({ signals }: { signals: ConceptSignal[] }) {
  if (!signals.length) return null;
  const visibleSignals = signals.slice(0, 8);
  return <section className="section-block concept-signals"><div className="section-title"><div><h3>Current learning signals</h3><p>Based only on answers and self-checks completed in YOVA.</p></div><span>{signals.length} observed</span></div><div className="concept-signal-list">{visibleSignals.map((signal) => <div className={signal.status} key={signal.concept.toLocaleLowerCase()}><span>{signal.status === "needs_review" ? <AlertCircle size={16} /> : <Check size={16} />}</span><div><strong>{signal.concept}</strong><small>{formatConceptSignal(signal)}</small></div><em>{signal.status === "needs_review" ? "Review" : signal.status === "showing_strength" ? "Repeatedly secure" : "Early signal"}</em></div>)}</div>{signals.length > visibleSignals.length && <small className="concept-signal-overflow">{signals.length - visibleSignals.length} more signals will be considered when YOVA builds future sessions.</small>}</section>;
}

function formatConceptSignal(signal: ConceptSignal) {
  if (signal.attempts === 1) return signal.lastOutcome === "secure" ? "Secure in the first observed check" : "Needs another attempt after the first check";
  return `${signal.secureAttempts} secure ${signal.secureAttempts === 1 ? "check" : "checks"} across ${signal.attempts} attempts`;
}

function PlanSources({ plan, editable, onAttach }: { plan: LearningPlan; editable: boolean; onAttach: (planId: string, materialIds: string[]) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const materials = plan.materials ?? [];
  const atLimit = materials.length >= 5;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length || adding) return;
    setAdding(true);
    setError(null);
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

  return <section className="section-block plan-sources"><div className="section-title"><h3>Learning source</h3><div className="source-heading-actions"><span>{plan.sourceMode === "user_materials" ? `${materials.length} uploaded` : "Created by YOVA"}</span>{editable && !atLimit && <label className={`button source-upload ${adding ? "disabled" : ""}`}><Upload size={15} /> {adding ? "Processing…" : "Add sources"}<input aria-label="Add source materials" type="file" multiple accept=".pdf,.txt,.md,text/plain,text/markdown,application/pdf" disabled={adding} onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label>}</div></div>{materials.length ? <div className="source-material-list">{materials.map((material) => <div key={material.id}><FileText size={18} /><span><strong>{material.name}</strong><small>{formatFileSize(material.sizeBytes)} · Private source for this goal</small></span><span className="data-badge">Ready</span></div>)}</div> : plan.sourceMode === "user_materials" ? <div className="source-empty"><AlertCircle size={17} /><p>This goal expects uploaded sources, but their metadata could not be loaded. Guided sessions will stop rather than silently inventing source content.</p></div> : <div className="source-created"><Sparkles size={18} /><div><strong>YOVA-generated learning content</strong><p>Explanations, questions, and practice are created from the goal. You can add private source files later.</p></div></div>}{atLimit && editable && <p className="source-limit">This goal has reached the five-material limit for the private alpha.</p>}{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}</section>;
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

  return <section className="plan-adjustment-panel"><div className="plan-adjustment-heading"><div><span className="step-label">ADJUST UNFINISHED WORK</span><h3>Change the plan without losing progress</h3><p>{unfinishedCount} unfinished {unfinishedCount === 1 ? "session will" : "sessions will"} use these settings. Completed sessions stay exactly as they are.</p></div></div><div className="plan-adjustment-grid"><label><span>Target date</span><input type="date" min={localDateInput(new Date().toISOString())} value={deadlineDate} disabled={saving} onChange={(event) => setDeadlineDate(event.target.value)} /><small>Optional. Agenda times are changed separately.</small></label><label><span>Future session length</span><select value={minutes} disabled={saving} onChange={(event) => setMinutes(Number(event.target.value))}><option value={15}>15 minutes</option><option value={25}>25 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select><small>Applies only to ready and upcoming sessions.</small></label></div><div className="adjustment-mode"><span>Where should future sessions happen?</span><div><button className={studyMode === "inside_yova" ? "selected" : ""} disabled={saving} onClick={() => setStudyMode("inside_yova")}><BookOpen size={17} /><strong>Inside YOVA</strong><small>Teaching, questions, and feedback in the app</small></button><button className={studyMode === "outside_yova" ? "selected" : ""} disabled={saving} onClick={() => setStudyMode("outside_yova")}><LibraryBig size={17} /><strong>Outside YOVA</strong><small>Exact instructions for another source or workspace</small></button></div></div>{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}<footer><button className="button ghost" disabled={saving} onClick={onCancel}>Cancel</button><button className="button primary" disabled={saving || unfinishedCount === 0} onClick={() => void save()}>{saving ? <span className="button-spinner" /> : <><Check size={16} /> Save adjustments</>}</button></footer></section>;
}

function AgendaScreen({ plans, sessionInterruptions, onStart, onReschedule }: { plans: LearningPlan[]; sessionInterruptions: SessionInterruption[]; onStart: (planId?: string) => void; onReschedule: (planId: string, planSessionId: string, scheduledFor: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState<{ planId: string; sessionId: string } | null>(null);
  const [customTime, setCustomTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableSessions = plans
    .flatMap((plan) => plan.sessions.filter((session) => session.status !== "complete" && session.status !== "skipped").map((session) => ({ plan, session })))
    .sort((a, b) => new Date(a.session.scheduledFor).getTime() - new Date(b.session.scheduledFor).getTime());
  const movingEntry = moving
    ? availableSessions.find(({ plan, session }) => plan.id === moving.planId && session.id === moving.sessionId) ?? null
    : null;

  const openMove = (planId: string, sessionId: string, scheduledFor: string) => {
    setMoving({ planId, sessionId });
    setCustomTime(toLocalDateTimeInput(scheduledFor));
    setError(null);
  };

  const saveMove = async (scheduledFor: string) => {
    if (!movingEntry || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/sessions/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSessionId: movingEntry.session.id, scheduledFor }),
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
      onReschedule(movingEntry.plan.id, parsed.data.planSessionId, parsed.data.scheduledFor);
      setMoving(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "YOVA could not move that session.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="page">
    <PageHeader eyebrow="AGENDA" title="Today and this week" description="One unified view of sessions and deadlines across your learning." />
    <section className="section-block">
      <div className="section-title"><h3>Upcoming</h3>{availableSessions.length > 0 && <button onClick={() => { setEditing((value) => !value); setMoving(null); setError(null); }}>{editing ? "Done adjusting" : "Adjust agenda"}</button>}</div>
      <div className="agenda-list">{availableSessions.length ? availableSessions.slice(0, 8).map(({ plan, session }) => { const resumePoint = resumableSessionProgress(session.id, sessionInterruptions); return <article key={session.id} className={session.status === "ready" ? "primary-agenda" : ""}><span className="agenda-window">{formatAgendaTime(session.scheduledFor)}</span><div><strong>{session.title}</strong><small>{resumePoint ? `${plan.title} · continue at section ${resumePoint.completedSteps + 1}` : `${plan.title} · ${session.estimatedMinutes} min`}</small></div>{editing || session.status !== "ready" ? <button className="button ghost" onClick={() => openMove(plan.id, session.id, session.scheduledFor)}>Move</button> : <button className="button primary" onClick={() => onStart(plan.id)}>{resumePoint ? "Continue" : "Start"}</button>}</article>; }) : <p className="muted">Your upcoming sessions will appear here after you create a plan or focused session.</p>}</div>
    </section>
    {movingEntry && <section className="agenda-move-panel" aria-live="polite"><div><span className="step-label">MOVE SESSION</span><h3>{movingEntry.session.title}</h3><p>Choose a new time. The learning order and session content will stay the same.</p></div><div className="agenda-quick-times"><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 1))} disabled={saving}>Tomorrow</button><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 2))} disabled={saving}>In two days</button><button onClick={() => void saveMove(moveByDays(movingEntry.session.scheduledFor, 7))} disabled={saving}>Next week</button></div><label><span>Custom date and time</span><input type="datetime-local" min={toLocalDateTimeInput(new Date().toISOString())} value={customTime} disabled={saving} onChange={(event) => setCustomTime(event.target.value)} /></label>{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}<footer><button className="button ghost" onClick={() => { setMoving(null); setError(null); }} disabled={saving}>Cancel</button><button className="button primary" onClick={() => { const date = new Date(customTime); if (Number.isNaN(date.getTime())) { setError("Choose a valid date and time."); return; } void saveMove(date.toISOString()); }} disabled={!customTime || saving}>{saving ? <span className="button-spinner" /> : "Save new time"}</button></footer></section>}
    <section className="week-strip">{availableSessions.slice(0, 5).map(({ plan, session }) => <div key={session.id}><span>{formatDay(session.scheduledFor)}</span><strong>{new Date(session.scheduledFor).getDate()}</strong><small>{plan.title}: {session.title}</small></div>)}</section>
  </div>;
}

function AskScreen({ plan, question, onQuestion, onApplyAction, analyticsEnabled }: { plan: LearningPlan | null; question: string; onQuestion: (question: string) => void; onApplyAction: (action: TutorProposedAction) => Promise<void>; analyticsEnabled: boolean }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [outgoingQuestion, setOutgoingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposedAction, setProposedAction] = useState<TutorProposedAction | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "applying" | "applied">("idle");

  useEffect(() => {
    const controller = new AbortController();
    const query = plan ? `?planId=${encodeURIComponent(plan.id)}` : "";

    void fetch(`/api/tutor${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          const message = typeof body === "object" && body && "error" in body && typeof body.error === "string"
            ? body.error
            : "YOVA could not load this tutor conversation.";
          throw new Error(message);
        }
        const parsed = TutorHistoryResponseSchema.safeParse(body);
        if (!parsed.success) throw new Error("The saved tutor conversation was not in a safe format.");
        setThreadId(parsed.data.threadId);
        setMessages(parsed.data.messages);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "YOVA could not load this tutor conversation.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });

    return () => controller.abort();
  }, [plan]);

  const sendQuestion = async (suggestedQuestion?: string) => {
    const nextQuestion = (suggestedQuestion ?? question).trim();
    if (!nextQuestion || sending || historyLoading) return;

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
      if (parsed.data.persistence === "browser") {
        setError("The answer worked, but this exchange did not reach cloud storage. Keep this page open if you need it.");
      }
    } catch (requestError) {
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

  return <div className="page ask-page"><PageHeader eyebrow="ASK YOVA" title="Get help in context" description="Ask about a topic, plan, session, or study problem." />{plan ? <div className="context-pill"><BookOpen size={15} /> Context: {plan.title} <ChevronRight size={15} /></div> : <div className="context-pill"><Sparkles size={15} /> General learning conversation</div>}<div className="chat-space">{historyLoading ? <div className="chat-loading"><span className="button-spinner dark" /> Loading your conversation…</div> : <div className="chat-thread">{messages.length === 0 && <div className="yova-message"><BrandMark compact /><div><strong>YOVA</strong><p>What would you like help with? I can explain a concept, quiz you, or help you decide what to do next.</p></div></div>}{messages.map((message) => message.role === "assistant" ? <div className="yova-message" key={message.id}><BrandMark compact /><div><strong>YOVA</strong><p>{message.content}</p></div></div> : <div className="user-message" key={message.id}><strong>You</strong><p>{message.content}</p></div>)}{outgoingQuestion && <div className="user-message pending" aria-live="polite"><strong>You</strong><p>{outgoingQuestion}</p></div>}</div>}{proposedAction && <section className={`tutor-action-card ${actionStatus === "applied" ? "applied" : ""}`} aria-live="polite"><div className="tutor-action-icon">{actionStatus === "applied" ? <Check size={18} /> : <Clock3 size={18} />}</div><div><span className="step-label">{actionStatus === "applied" ? "CHANGE APPLIED" : "PROPOSED CHANGE"}</span><h3>{proposedAction.title}</h3><p>{actionStatus === "applied" ? `Your next session is now ${proposedAction.minutes} minutes. Its activities will be regenerated when you start.` : proposedAction.explanation}</p></div><button className="button primary" disabled={actionStatus !== "idle"} onClick={() => void approveAction()}>{actionStatus === "applying" ? <><span className="button-spinner" /> Applying</> : actionStatus === "applied" ? <><Check size={16} /> Applied</> : "Approve change"}</button></section>}{messages.length === 0 && !outgoingQuestion && !historyLoading && <div className="prompt-grid">{suggestedPrompts.map((prompt) => <button key={prompt} disabled={sending} onClick={() => void sendQuestion(prompt)}>{prompt}</button>)}</div>}{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}</div><AskBar value={question} onChange={onQuestion} onSubmit={() => void sendQuestion()} pending={sending || historyLoading} /></div>;
}

const editablePreferenceIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 9] as const;

function observedLearningInsight(sessionCompletions: SessionCompletion[], sessionInterruptions: SessionInterruption[], accuracyPercent: number | null) {
  if (sessionCompletions.length === 0 && sessionInterruptions.length === 0) {
    return "YOVA needs real session activity before it can responsibly show observed patterns.";
  }

  const recentInterruptions = sessionInterruptions.slice(-4);
  if (recentInterruptions.length >= 2) {
    return "You have left multiple recent sessions before finishing. YOVA will treat that as a scheduling signal and cautiously reduce or restructure future session scope—not as evidence about your ability.";
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

function YouScreen({ account, answers, sessionCompletions, sessionInterruptions, onAnswersChange, onReset }: { account: PreviewAccount | null; answers: string[]; sessionCompletions: SessionCompletion[]; sessionInterruptions: SessionInterruption[]; onAnswersChange: (answers: string[]) => void; onReset: () => Promise<void> }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftAnswers, setDraftAnswers] = useState<string[]>(answers);
  const totalCorrect = sessionCompletions.reduce((sum, completion) => sum + completion.correctAnswers, 0);
  const totalAnswers = sessionCompletions.reduce((sum, completion) => sum + completion.totalAnswers, 0);
  const accuracyPercent = totalAnswers ? Math.round((totalCorrect / totalAnswers) * 100) : null;
  const accuracy = accuracyPercent === null ? "—" : `${accuracyPercent}%`;
  const totalStudyMinutes = sessionCompletions.reduce((sum, completion) => sum + (Number.isFinite(completion.actualMinutes) ? completion.actualMinutes : 0), 0)
    + sessionInterruptions.reduce((sum, interruption) => sum + (Number.isFinite(interruption.actualMinutes) ? interruption.actualMinutes : 0), 0);
  const observedEventCount = sessionCompletions.length + sessionInterruptions.length;
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

  return <div className="page"><PageHeader eyebrow="YOU" title="Your learning, in one place" description="What you have told YOVA, what it has cautiously noticed, and your overall progress." /><div className="you-grid"><section className={`section-block preference-card ${editing ? "editing" : ""}`}><div className="section-title"><h3>Your learning preferences</h3>{editing ? <span className="data-badge">Editing</span> : <button onClick={startEditing}>Edit</button>}</div>{editing ? <div className="preference-editor"><p>These answers shape session length, guidance, explanations, and plan structure. You can change them whenever your needs change.</p>{editablePreferenceIndexes.map((index) => { const question = onboardingQuestions[index]; return <label key={question.prompt}><span>{question.prompt}</span><select value={draftAnswers[index] ?? ""} onChange={(event) => updateDraftAnswer(index, event.target.value)}><option value="">Not answered</option>{question.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; })}<div className="preference-actions"><button className="button ghost" onClick={cancelEditing}>Cancel</button><button className="button primary" onClick={savePreferences}><Check size={16} /> Save preferences</button></div><small>For signed-in accounts, saved preferences are also synced to YOVA’s database.</small></div> : <><ProfileItem title="Account" value={account?.email || "Not connected"} note="Your signed-in identity" /><ProfileItem title="Main blocker" value={answers[0] || "Not answered yet"} note="Shapes how YOVA helps you begin" /><ProfileItem title="Guidance" value={answers[1] || "Not answered yet"} note="Controls how much YOVA decides for you" /><ProfileItem title="Session size" value={answers[2] || "Not answered yet"} note="Used as a starting estimate, not a fixed limit" /><ProfileItem title="Explanation" value={answers[3] || "Not answered yet"} note="Shapes how difficult material is introduced" /></>}</section><section className="section-block"><div className="section-title"><h3>What YOVA has noticed</h3><span className="data-badge">{observedEventCount < 3 ? "Early signal" : "Observed pattern"}</span></div><div className="insight"><Sparkles size={18} /><p>{observedLearningInsight(sessionCompletions, sessionInterruptions, accuracyPercent)}</p></div><div className="metric-row"><div><strong>{sessionCompletions.length}</strong><span>sessions completed</span></div><div><strong>{formatStudyMinutes(totalStudyMinutes)}</strong><span>time studied</span></div><div><strong>{accuracy}</strong><span>recent quiz accuracy</span></div></div></section><section className="section-block alpha-data-card"><div><h3>{isCloudAccount ? "Cloud learning data" : "Private-alpha data"}</h3><p>{isCloudAccount ? "Remove your learning profile, plans, tutor conversations, results, and private uploaded materials. Your login identity will remain available." : "Reset the account, onboarding answers, plans, and session results stored in this browser."}</p></div>{confirmReset ? <div className="reset-confirm"><strong>This cannot be undone.</strong><span>{isCloudAccount ? "YOVA will permanently remove your cloud learning data and uploaded files." : "Only this browser’s private-alpha data will be removed."}</span>{resetError && <span className="reset-error">{resetError}</span>}<div><button className="button ghost" disabled={resetting} onClick={() => { setConfirmReset(false); setResetError(null); }}>Cancel</button><button className="button danger" disabled={resetting} onClick={() => void confirmDataReset()}>{resetting ? <span className="button-spinner" /> : <Trash2 size={16} />} {resetting ? "Resetting…" : isCloudAccount ? "Reset learning data" : "Reset everything"}</button></div></div> : <button className="button ghost danger-outline" onClick={() => setConfirmReset(true)}><Trash2 size={16} /> {isCloudAccount ? "Reset learning data" : "Reset private-alpha data"}</button>}</section></div></div>;
}

function formatStudyMinutes(totalMinutes: number) {
  if (totalMinutes <= 0) return "—";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function lessonStepsFor(plan: LearningPlan | null): LessonStep[] {
  if (!plan) return [{ type: "instruction", concept: null, label: "Set up", title: "No session selected", body: "Return Home and select a learning goal first.", question: null, correctAnswer: null, feedback: null }];

  const current = plan.sessions.find((session) => session.status === "ready") ?? plan.sessions.find((session) => session.status === "upcoming");

  if (plan.studyMode === "outside_yova") {
    return [
      lessonInstruction("Set up", "Prepare your outside study block", `Open the material you use for ${plan.topic}. Keep only that source and a place to work visible.`),
      lessonInstruction("Your task", current?.title ?? "Complete the planned work", `${current?.objective ?? "Work through the next planned objective."} Use ${current?.method.toLowerCase() ?? "the selected method"} for about ${current?.estimatedMinutes ?? 20} minutes.`),
      lessonQuestion("Method check", "What should happen before you check the source?", "The method works only if you make a real attempt before looking for the answer.", ["Attempt the task from memory", "Reread everything first", "Copy the source wording", "Switch topics"], "Attempt the task from memory", "Active retrieval requires a genuine attempt before looking at the source.", "Retrieval before review"),
      lessonFreeResponse("Recall check", "Write the main idea without reopening the source", "Explain the most important idea or step you just practiced. Use your own words and include one detail that makes the explanation specific.", "A strong response states the central idea or step accurately, explains it in the learner's own words, and includes one relevant supporting detail from the source.", "Compare the meaning, not the exact wording. If the central idea or supporting detail is missing, mark it as needing another pass.", plan.topic),
      lessonInstruction("Return to YOVA", "Record what needs another pass", "Note the one idea or step that felt least stable. YOVA will use that signal when the session result is saved."),
    ];
  }

  if (/biology|photosynthesis|cellular respiration/i.test(plan.topic)) {
    return [
      lessonInstruction("Set up", "Closed-note retrieval", "Try to produce each answer before looking. Review only what you miss, then retry the missed item later."),
      lessonQuestion("Question 1 of 2", "Which stage of cellular respiration happens first?", "Answer from memory. Familiarity is not the same as being able to retrieve it.", ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"], "Glycolysis", "Glycolysis is the first stage and begins breaking glucose down before the Krebs cycle and electron transport chain.", "Cellular respiration sequence"),
      lessonQuestion("Question 2 of 2", "Where does glycolysis occur?", "Choose the location without opening your notes.", ["Cytoplasm", "Mitochondrial matrix", "Nucleus", "Cell membrane"], "Cytoplasm", "Glycolysis occurs in the cytoplasm; later aerobic stages occur in the mitochondrion.", "Glycolysis location"),
      lessonFreeResponse("Explain from memory", "Why can glycolysis begin without oxygen?", "Answer without reopening the explanation. Focus on what glycolysis directly requires and where it happens.", "Glycolysis does not directly require oxygen and occurs in the cytoplasm, so it can begin before the oxygen-dependent stages of aerobic respiration.", "A strong answer mentions that glycolysis does not directly require oxygen. Mentioning that it occurs in the cytoplasm makes the explanation more complete.", "Glycolysis oxygen requirement"),
      lessonInstruction("Repair the gap", "Compare before moving on", "Glycolysis occurs in the cytoplasm. Most later stages occur in the mitochondrion. Keep that contrast available for the next mixed-practice session."),
    ];
  }

  if (/finance|investing|budget|credit|interest/i.test(plan.topic)) {
    return [
      lessonInstruction("Set up", "Build the decision framework", "Start with the practical purpose of each concept. The goal is to make a sound decision, not merely recognize vocabulary."),
      lessonQuestion("Question 1 of 2", "What is the main purpose of a budget?", "Choose the answer that describes an active decision tool.", ["Direct money toward priorities and constraints", "Predict every future expense perfectly", "Eliminate all optional spending", "Track only large purchases"], "Direct money toward priorities and constraints", "A budget is a decision tool for directing limited money toward priorities and known constraints.", "Purpose of a budget"),
      lessonQuestion("Question 2 of 2", "Which example shows compound growth?", "Look for growth that earns additional growth over time.", ["Interest earning interest", "A one-time discount", "A fixed monthly fee", "Cash kept at zero interest"], "Interest earning interest", "Compound growth happens when previous growth is included in the base that produces future growth.", "Compound growth"),
      lessonFreeResponse("Explain from memory", "How does compound growth build over time?", "Describe the mechanism in your own words rather than repeating a definition.", "Compound growth occurs when earlier gains become part of the base, allowing later gains to earn additional growth too.", "A strong answer explains that prior gains remain in the base and can themselves produce future gains.", "Compound growth"),
      lessonInstruction("Apply", "Connect the ideas to one real decision", "Choose one current spending, saving, debt, or investing decision and name the concept that should guide it."),
    ];
  }

  return [
    lessonInstruction("Set up", current?.method ?? "Focused learning", current?.methodReason ?? "Begin with one clearly bounded objective."),
    lessonQuestion("Retrieval check", "What makes this an active learning step?", "Choose the action that produces evidence of what you can do without support.", ["Explain or apply it before checking", "Read it repeatedly", "Highlight every sentence", "Keep all examples visible"], "Explain or apply it before checking", "Producing an answer before checking creates evidence of what you can retrieve or apply independently.", "Active retrieval"),
    lessonInstruction("Practice", current?.title ?? "Apply the next idea", current?.objective ?? `Use the plan to practice ${plan.topic}.`),
    lessonFreeResponse("Recall from memory", `Explain the core idea behind ${plan.topic}`, "Write what you can produce without looking. Include the main idea and one supporting detail, step, or example.", `A strong response accurately states the main idea behind ${plan.topic} and supports it with one relevant detail, step, or example.`, "Compare the substance of your response with the reference. Exact wording is not required, but the central idea and one specific support should be present.", plan.topic),
    lessonInstruction("Wrap up", "Name the least stable idea", "A specific gap is useful information. YOVA will use it to shape the next recommendation."),
  ];
}

function lessonInstruction(label: string, title: string, body: string): LessonStep {
  return { type: "instruction", concept: null, label, title, body, question: null, correctAnswer: null, feedback: null };
}

function lessonQuestion(label: string, title: string, body: string, choices: string[], correctAnswer: string, feedback: string, concept = title): LessonStep {
  return { type: "multiple_choice", concept: normalizeConceptName(concept), label, title, body, question: choices, correctAnswer, feedback };
}

function lessonFreeResponse(label: string, title: string, body: string, referenceAnswer: string, feedback: string, concept = title): LessonStep {
  return { type: "free_response", concept: normalizeConceptName(concept), label, title, body, question: null, correctAnswer: referenceAnswer, feedback };
}

function normalizeConceptName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120) || "Session concept";
}

function SessionLoading({ plan, onExit }: { plan: LearningPlan | null; onExit: () => void }) {
  return <main className="centered-shell session-loading"><BrandMark /><section><span className="button-spinner dark" /><span className="step-label">BUILDING YOUR SESSION</span><h1>Turning your plan into guided work.</h1><p>YOVA is selecting the right activity sequence, generating knowledge checks, and preparing feedback for {plan?.topic ?? "your goal"}.</p><button className="button ghost" onClick={onExit}>Cancel</button></section></main>;
}

function SessionGenerationError({ plan, issue, onExit, onRetry }: { plan: LearningPlan | null; issue: string | null; onExit: () => void; onRetry: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="plan-error-state" role="alert"><span><AlertCircle /></span><span className="step-label">SOURCE-SAFE STOP</span><h1>YOVA did not replace your material.</h1><p>{issue ?? "YOVA could not build this source-grounded session yet."}</p><p>Nothing was marked complete. You can retry, or return to {plan?.title ?? "the learning goal"} and check its source files.</p><div><button className="button ghost" onClick={onExit}><ArrowLeft size={17} /> Return to learning</button><button className="button primary" onClick={onRetry}>Try again <ArrowRight size={17} /></button></div></section></main>;
}

function GuidedSession({ plan, steps, step, selectedAnswer, outcome, answerRevealed, elapsedSeconds, rationale, issue, analyticsEnabled, onSelect, onEvaluate, onReveal, onExit, onNext }: { plan: LearningPlan | null; steps: LessonStep[]; step: number; selectedAnswer: string | null; outcome: boolean | undefined; answerRevealed: boolean; elapsedSeconds: number; rationale: string | null; issue: string | null; analyticsEnabled: boolean; onSelect: (answer: string) => void; onEvaluate: (correct: boolean) => void; onReveal: () => void; onExit: () => void; onNext: () => void }) {
  const [confirmingExit, setConfirmingExit] = useState(false);
  const content = steps[step];
  const currentSession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  const isQuestion = content.type === "multiple_choice" || content.type === "free_response";
  const isCorrect = outcome === true;
  const explanation = isCorrect
    ? content.feedback
    : content.correctAnswer
      ? `The correct answer is “${content.correctAnswer}.” ${content.feedback ?? "YOVA will bring this idea back for another attempt."}`
      : content.feedback;
  const canContinue = !isQuestion || outcome !== undefined;

  return <main className="session-shell"><header className="session-top"><BrandMark compact /><div><span>{plan?.title ?? "YOVA session"}</span><strong>{currentSession?.title ?? "Guided learning"}</strong></div><div className="session-progress"><span>{step + 1} of {steps.length} sections · {formatElapsedDuration(elapsedSeconds)} elapsed</span><div><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div></div><button className="button ghost" onClick={() => setConfirmingExit(true)}>Exit</button></header><section className="session-content">{step === 0 && rationale && <div className="session-rationale"><Sparkles size={17} /><div><strong>Why this session fits</strong><p>{rationale}</p></div></div>}{issue && step === 0 && <div className="session-issue"><AlertCircle size={17} /><span>{issue}</span></div>}<span className="step-label">{content.label}</span><h1>{content.title}</h1><p>{content.body}</p>{content.type === "multiple_choice" && content.question && <div className="answer-grid">{content.question.map((answer) => <button key={answer} className={selectedAnswer === answer ? "selected" : ""} disabled={selectedAnswer !== null} onClick={() => { onSelect(answer); onEvaluate(answer === content.correctAnswer); }}>{answer}{selectedAnswer === answer && <Check size={18} />}</button>)}</div>}{content.type === "multiple_choice" && outcome !== undefined && <div className={`feedback ${isCorrect ? "" : "incorrect"}`}>{isCorrect ? <Check size={20} /> : <AlertCircle size={20} />}<div><strong>{isCorrect ? "Correct." : "Useful miss."}</strong><p>{explanation}</p></div></div>}{content.type === "free_response" && <div className="recall-response"><label htmlFor={`recall-${step}`}><span>Your answer from memory</span><textarea id={`recall-${step}`} rows={6} value={selectedAnswer ?? ""} disabled={answerRevealed} placeholder="Write what you can remember before checking…" onChange={(event) => onSelect(event.target.value)} /></label>{!answerRevealed ? <button className="button secondary" disabled={!selectedAnswer?.trim()} onClick={onReveal}>Check my answer</button> : <div className="recall-review"><span className="step-label">REFERENCE ANSWER</span><p>{content.correctAnswer}</p>{content.feedback && <small>{content.feedback}</small>}<div className="recall-actions"><span>How did your answer compare?</span><button className={outcome === true ? "selected" : ""} onClick={() => onEvaluate(true)}><Check size={17} /> I got the key idea</button><button className={outcome === false ? "selected needs-work" : ""} onClick={() => onEvaluate(false)}><AlertCircle size={17} /> Needs another pass</button></div><small className="privacy-note">Your typed response stays in this session. YOVA saves only whether this concept felt secure or needs review.</small></div>}</div>}<button className="button primary large" onClick={onNext} disabled={!canContinue}>{step === steps.length - 1 ? "Complete session" : "Continue"} <ArrowRight size={18} /></button></section><SessionTutor plan={plan} activityTitle={content.title} analyticsEnabled={analyticsEnabled} />{confirmingExit && <div className="session-exit-backdrop"><section className="session-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="session-exit-title"><div className="session-exit-icon"><Clock3 size={21} /></div><span className="step-label">LEAVE THIS SESSION?</span><h2 id="session-exit-title">Your plan will stay open.</h2><p>YOVA will remember how long you studied and how far you reached. Unfinished answers will not be treated as knowledge evidence.</p><div className="session-exit-summary"><span>{formatElapsedDuration(elapsedSeconds)} studied</span><span>{step} of {steps.length} sections finished</span></div><div className="session-exit-actions"><button className="button ghost" onClick={() => setConfirmingExit(false)}>Keep studying</button><button className="button primary" onClick={onExit}>Save progress and leave</button></div></section></div>}</main>;
}

function SessionTutor({ plan, activityTitle, analyticsEnabled }: { plan: LearningPlan | null; activityTitle: string; analyticsEnabled: boolean }) {
  const [question, setQuestion] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestAnswer = [...messages].reverse().find((message) => message.role === "assistant")?.content ?? null;

  const ask = async () => {
    const nextQuestion = question.trim();
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
          sessionContext: { activityTitle },
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
      setError(requestError instanceof Error ? requestError.message : "YOVA could not answer during this session.");
    } finally {
      setPending(false);
    }
  };

  return <aside className={`session-tutor ${latestAnswer || error ? "open" : ""}`}>
    {(latestAnswer || error) && <div className="session-tutor-response">{latestAnswer && <><span><Sparkles size={15} /> YOVA · {activityTitle}</span><p>{latestAnswer}</p></>}{error && <div className="session-tutor-error"><AlertCircle size={15} /> {error}</div>}</div>}
    <form className="session-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
      <input aria-label="Ask YOVA about this session" placeholder="Ask YOVA about this session…" value={question} disabled={pending || !plan} onChange={(event) => setQuestion(event.target.value)} />
      <button aria-label="Send session question" type="submit" disabled={!question.trim() || pending || !plan}>{pending ? <span className="button-spinner" /> : <Send size={18} />}</button>
    </form>
  </aside>;
}

function SessionComplete({ stepCount, elapsedSeconds, actualMinutes, correctAnswers, totalAnswers, observedGap, nextSession, onFinish }: { stepCount: number; elapsedSeconds: number; actualMinutes: number; correctAnswers: number; totalAnswers: number; observedGap: string; nextSession: LearningPlanSession | null; onFinish: (feedback: SessionCompletion["feedback"]) => void }) {
  const [feedback, setFeedback] = useState<SessionCompletion["feedback"]>("about_right");
  const hasGap = totalAnswers > 0 && correctAnswers < totalAnswers;
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
  });
  const nextStatus = !nextSession
    ? { title: "This learning item is complete", explanation: "There is no remaining session to adjust. This result is still saved to your learning history." }
    : proposedAdaptation
      ? { title: "YOVA will adjust the next session", explanation: proposedAdaptation.explanation }
      : { title: "The next session is ready", explanation: "This result does not justify changing the planned method, so YOVA will continue without inventing an adjustment." };

  return <main className="centered-shell completion"><BrandMark /><section className="setup-card wide"><div className="completion-icon"><Check size={28} /></div><span className="step-label">SESSION COMPLETE</span><h1>You completed this session.</h1><p>{hasGap ? "One or more details need another pass. YOVA can now use the actual result when deciding what comes next." : "You completed the required check. YOVA can move forward without adding unnecessary review."}</p><div className="result-grid"><div><span>Session steps</span><strong>{stepCount} of {stepCount}</strong></div><div><span>Time studied</span><strong>{formatElapsedDuration(elapsedSeconds)}</strong></div><div><span>Knowledge checks</span><strong>{correctAnswers} of {totalAnswers}</strong></div><div><span>Next step</span><strong>{nextSession ? nextSession.title : "Goal complete"}</strong></div></div><p className="feedback-label">How did this session feel?</p><div className="feeling-row"><button className={feedback === "too_easy" ? "selected" : ""} onClick={() => setFeedback("too_easy")}>Too easy</button><button className={feedback === "about_right" ? "selected" : ""} onClick={() => setFeedback("about_right")}>About right</button><button className={feedback === "too_difficult" ? "selected" : ""} onClick={() => setFeedback("too_difficult")}>Too difficult</button></div><div className="adaptation"><Sparkles size={19} /><div><strong>{nextStatus.title}</strong><p>{nextStatus.explanation}</p></div></div><button className="button primary large full" onClick={() => onFinish(feedback)}>Save result and return Home</button></section></main>;
}

function formatElapsedDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function formatDay(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(isoDate)).toUpperCase();
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

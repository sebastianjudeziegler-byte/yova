"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Home,
  LibraryBig,
  LogOut,
  Mail,
  MessageCircleMore,
  Plus,
  Send,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PlanCreator } from "@/components/plan-creator";
import { getAuthenticatedAccount, getAuthMode, requestEmailAuthentication, signOutAuthenticatedAccount } from "@/lib/auth/client";
import { makeId, makeUuid, type LearningPlan, type PreviewAccount, type SessionCompletion } from "@/lib/domain";
import { clearPreviewSnapshot, loadPreviewSnapshot, savePreviewSnapshot } from "@/lib/persistence/preview-store";
import { buildPlanProfileSummary } from "@/lib/personalization/profile-summary";
import { onboardingQuestions } from "@/lib/sample-data";
import {
  completeAuthenticatedPlanSession,
  loadAuthenticatedLearningState,
  saveAuthenticatedLearnerProfile,
} from "@/lib/supabase/learning-state-repository";
import {
  TutorHistoryResponseSchema,
  TutorResponseSchema,
  type TutorMessage,
} from "@/lib/tutor/schema";

type Stage = "landing" | "account" | "onboarding-intro" | "onboarding" | "profile" | "paywall" | "app" | "plan-creator" | "session" | "complete";
type Tab = "Home" | "Learning" | "Agenda" | "Ask YOVA" | "You";
type AccountMode = "create" | "sign-in";
type LessonStep = { label: string; title: string; body: string; question: string[] | null };

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
  const [sessionStep, setSessionStep] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [sessionResponses, setSessionResponses] = useState<Record<number, string>>({});
  const [cloudSyncIssue, setCloudSyncIssue] = useState<string | null>(null);
  const [tutorQuestion, setTutorQuestion] = useState("");

  const activePlans = plans.filter((plan) => plan.status === "active");
  const activePlan = activePlans.find((plan) => plan.id === selectedPlanId) ?? activePlans[activePlans.length - 1] ?? null;
  const activeLessonSteps = lessonStepsFor(activePlan);
  const sessionCorrectAnswers = Object.entries(sessionResponses).filter(([step, answer]) => activeLessonSteps[Number(step)]?.question?.[0] === answer).length;
  const sessionTotalAnswers = activeLessonSteps.filter((step) => step.question).length;

  useEffect(() => {
    let cancelled = false;

    async function openYova() {
      const saved = loadPreviewSnapshot();
      if (saved) {
        setAccount(saved.account);
        setSignedIn(saved.signedIn);
        setAnswers(saved.onboardingAnswers);
        setOnboardingCompleted(saved.onboardingCompleted);
        setAlphaEntered(saved.alphaEntered);
        setPlans(saved.plans);
        setSelectedPlanId(saved.plans.filter((plan) => plan.status === "active").at(-1)?.id ?? null);
        setSessionCompletions(saved.sessionCompletions);
      }

      const cloudAccount = await getAuthenticatedAccount();
      if (cancelled) return;

      if (cloudAccount) {
        const localAccountMatches = saved?.account?.id === cloudAccount.id;

        try {
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
          setCloudSyncIssue(null);

          if (cloudPlans.some((plan) => plan.status === "active")) setStage("app");
          else if (cloudOnboardingCompleted && restoredAlphaEntered) setStage("plan-creator");
          else if (cloudOnboardingCompleted) setStage("paywall");
          else setStage("onboarding-intro");
        } catch (error) {
          setAccount(cloudAccount);
          setSignedIn(true);
          setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not load your cloud data.");

          if (localAccountMatches && saved) {
            if (saved.alphaEntered) setStage(saved.plans.length ? "app" : "plan-creator");
            else if (saved.onboardingCompleted) setStage("paywall");
            else setStage("onboarding-intro");
          } else {
            setAnswers([]);
            setOnboardingCompleted(false);
            setAlphaEntered(false);
            setPlans([]);
            setSelectedPlanId(null);
            setSessionCompletions([]);
            setStage("onboarding-intro");
          }
        }
      } else if (saved?.signedIn && saved.account && getAuthMode() === "preview") {
        if (saved.alphaEntered) setStage(saved.plans.length ? "app" : "plan-creator");
        else if (saved.onboardingCompleted) setStage("paywall");
        else setStage("onboarding-intro");
      }

      setReady(true);
    }

    void openYova();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !account) return;
    savePreviewSnapshot({
      version: 1,
      account,
      signedIn,
      onboardingAnswers: answers,
      onboardingCompleted,
      alphaEntered,
      plans,
      sessionCompletions,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, account, signedIn, answers, onboardingCompleted, alphaEntered, plans, sessionCompletions]);

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

  const startSession = (planId?: string) => {
    if (planId) setSelectedPlanId(planId);
    setSessionStep(0);
    setSelectedAnswer(null);
    setSessionResponses({});
    setStage("session");
  };

  const completeActiveSession = (correctAnswers: number, totalAnswers: number) => {
    if (!activePlan) return;
    const currentSession = activePlan.sessions.find((session) => session.status === "ready");
    if (!currentSession) return;

    const completion: SessionCompletion = {
      id: makeUuid(),
      planId: activePlan.id,
      planSessionId: currentSession.id,
      completedAt: new Date().toISOString(),
      correctAnswers,
      totalAnswers,
      feedback: "about_right",
      observedGap: correctAnswers < totalAnswers ? `One or more details in ${activePlan.topic}` : "No major gap detected in the required check",
    };

    setPlans((currentPlans) => currentPlans.map((plan) => {
      if (plan.id !== activePlan.id) return plan;
      const nextSequence = currentSession.sequence + 1;
      const updatedSessions = plan.sessions.map((session) => {
        if (session.id === currentSession.id) return { ...session, status: "complete" as const };
        if (session.sequence === nextSequence && session.status === "upcoming") return { ...session, status: "ready" as const };
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
      void completeAuthenticatedPlanSession(completion, currentSession.estimatedMinutes)
        .then(() => setCloudSyncIssue(null))
        .catch((error: unknown) => {
          setCloudSyncIssue(error instanceof Error ? error.message : "YOVA could not sync this session.");
        });
    }
  };

  const resetAlphaData = () => {
    clearPreviewSnapshot();
    setAccount(null);
    setSignedIn(false);
    setOnboardingCompleted(false);
    setAlphaEntered(false);
    setQuestionIndex(0);
    setAnswers([]);
    setPlans([]);
    setSelectedPlanId(null);
    setSessionCompletions([]);
    setSessionStep(0);
    setSelectedAnswer(null);
    setSessionResponses({});
    setActiveTab("Home");
    setAccountMode("create");
    setStage("landing");
  };

  if (!ready) return <LoadingAccount />;

  if (stage === "landing") return <Landing onCreate={() => { setAccountMode("create"); setStage("account"); }} onSignIn={() => { setAccountMode("sign-in"); setStage("account"); }} />;
  if (stage === "account") {
    return <AccountEntry mode={accountMode} existingAccount={account} onBack={() => setStage("landing")} onContinue={(nextAccount) => {
      if (accountMode === "create") {
        clearPreviewSnapshot();
        setAnswers([]);
        setOnboardingCompleted(false);
        setAlphaEntered(false);
        setPlans([]);
        setSessionCompletions([]);
        setQuestionIndex(0);
      }
      setAccount(nextAccount);
      setSignedIn(true);
      if (accountMode === "sign-in" && onboardingCompleted) setStage(alphaEntered ? (plans.length ? "app" : "plan-creator") : "paywall");
      else setStage("onboarding-intro");
    }} />;
  }
  if (stage === "onboarding-intro") return <OnboardingIntro onStart={() => setStage("onboarding")} />;
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
            setOnboardingCompleted(true);
            setStage("profile");
          }
          else setQuestionIndex((value) => value + 1);
        }}
      />
    );
  }
  if (stage === "profile") return <ProfileSummary onContinue={() => setStage("paywall")} />;
  if (stage === "paywall") return <PaywallPreview onContinue={() => { setAlphaEntered(true); setStage(plans.length ? "app" : "plan-creator"); }} />;
  if (stage === "plan-creator") return <PlanCreator profileSummary={buildPlanProfileSummary(answers)} onExit={() => setStage(plans.length ? "app" : "paywall")} onFinish={(plan) => { setPlans((current) => [...current, plan]); setSelectedPlanId(plan.id); setStage("app"); setActiveTab("Learning"); }} />;
  if (stage === "session") {
    return (
      <GuidedSession
        plan={activePlan}
        steps={activeLessonSteps}
        step={sessionStep}
        selectedAnswer={selectedAnswer}
        onSelect={(answer) => {
          setSelectedAnswer(answer);
          setSessionResponses((current) => ({ ...current, [sessionStep]: answer }));
        }}
        onExit={() => setStage("app")}
        onNext={() => {
          if (sessionStep === activeLessonSteps.length - 1) setStage("complete");
          else {
            setSessionStep((value) => value + 1);
            setSelectedAnswer(null);
          }
        }}
      />
    );
  }
  if (stage === "complete") return <SessionComplete correctAnswers={sessionCorrectAnswers} totalAnswers={sessionTotalAnswers} onFinish={() => { completeActiveSession(sessionCorrectAnswers, sessionTotalAnswers); setStage("app"); setActiveTab("Home"); }} />;

  return (
    <AppShell activeTab={activeTab} onTab={setActiveTab} account={account} cloudSyncIssue={cloudSyncIssue} onSignOut={() => {
      void signOutAuthenticatedAccount().finally(() => {
        setSignedIn(false);
        setStage("landing");
      });
    }}>
      {activeTab === "Home" && <HomeScreen account={account} plans={activePlans} plan={activePlan} tutorQuestion={tutorQuestion} onTutorQuestion={setTutorQuestion} onOpenTutor={() => setActiveTab("Ask YOVA")} onStart={() => startSession(activePlan?.id)} onSelectPlan={setSelectedPlanId} onCreatePlan={() => setStage("plan-creator")} />}
      {activeTab === "Learning" && <LearningScreen plans={activePlans} plan={activePlan} onSelectPlan={setSelectedPlanId} onStart={() => startSession(activePlan?.id)} onCreatePlan={() => setStage("plan-creator")} />}
      {activeTab === "Agenda" && <AgendaScreen plans={activePlans} onStart={startSession} />}
      {activeTab === "Ask YOVA" && <AskScreen key={activePlan?.id ?? "general"} plan={activePlan} question={tutorQuestion} onQuestion={setTutorQuestion} />}
      {activeTab === "You" && <YouScreen account={account} sessionCompletions={sessionCompletions} onReset={resetAlphaData} />}
    </AppShell>
  );
}

function LoadingAccount() {
  return <main className="centered-shell"><BrandMark /><p className="muted">Opening your YOVA…</p></main>;
}

function Landing({ onCreate, onSignIn }: { onCreate: () => void; onSignIn: () => void }) {
  return (
    <main className="entry-shell">
      <header className="entry-nav"><BrandMark /><button className="button ghost" onClick={onSignIn}>Sign in</button></header>
      <section className="hero-card">
        <span className="eyebrow"><Sparkles size={15} /> Personalized around how you actually study</span>
        <h1>Know exactly what<br />to study next.</h1>
        <p>Tell YOVA what you need to learn. It figures out where you are, builds the plan, and guides each session.</p>
        <div className="hero-actions"><button className="button primary large" onClick={onCreate}>Create account <ArrowRight size={18} /></button><button className="button secondary large">See how it works</button></div>
        <div className="product-proof">
          <div><strong>What</strong><span>Cellular respiration retrieval</span></div>
          <div><strong>Why now</strong><span>Your test is in four days.</span></div>
          <div><strong>How</strong><span>12 closed-note questions, then repair gaps.</span></div>
        </div>
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
    return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card email-sent"><div className="mail-check"><Mail size={24} /></div><span className="step-label">CHECK YOUR EMAIL</span><h1>Your secure sign-in link is on its way.</h1><p>Open the message sent to <strong>{email.trim().toLowerCase()}</strong>. The link will bring you back to YOVA and finish signing you in.</p><button className="button secondary large full" onClick={() => setEmailSent(false)}>Use a different email</button><div className="preview-notice"><strong>No password to remember</strong><span>The link is temporary and can only be used to finish this sign-in.</span></div></section></main>;
  }

  return <main className="account-shell"><header><BrandMark /><button className="button ghost" onClick={onBack}><ArrowLeft size={17} /> Back</button></header><section className="account-card"><span className="step-label">{isCreate ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span><h1>{isCreate ? "Start building your YOVA." : "Continue your learning."}</h1><p>{isCreate ? "Your account keeps your profile, plans, sessions, and progress together." : authMode === "supabase" ? "Enter your email and YOVA will send you a secure sign-in link." : "Use the email attached to this browser’s private-alpha account."}</p>{isCreate && <label><span>First name</span><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} autoComplete="given-name" disabled={pending} /></label>}<label><span>Email address</span><div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" disabled={pending} /></div></label>{error && <p className="form-error">{error}</p>}<button className="button primary large full" onClick={() => void submit()} disabled={pending}>{pending ? "Sending secure link…" : isCreate ? "Continue" : "Sign in"} {!pending && <ArrowRight size={18} />}</button><div className="preview-notice"><strong>{authMode === "supabase" ? "Secure cloud account" : "Private-alpha storage"}</strong><span>{authMode === "supabase" ? "YOVA uses a temporary email link instead of storing a password." : "For now, this browser remembers the prototype. Real email verification activates when the cloud project is connected."}</span></div></section></main>;
}

function OnboardingIntro({ onStart }: { onStart: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card"><span className="step-label">SET UP YOUR YOVA</span><h1>Make YOVA fit how you actually study.</h1><p>Ten short questions help YOVA build realistic plans, choose useful methods, and guide you at the right level. About two minutes.</p><div className="info-strip"><Sparkles size={20} /><span>This creates starting preferences—not a brain type. YOVA will update carefully based on what you actually do.</span></div><button className="button primary large full" onClick={onStart}>Personalize YOVA <ArrowRight size={18} /></button><button className="text-button">Skip for now</button></section></main>;
}

function OnboardingQuestion({ index, answer, onAnswer, onNext, onBack }: { index: number; answer?: string; onAnswer: (answer: string) => void; onNext: () => void; onBack: () => void }) {
  const question = onboardingQuestions[index];
  return <main className="onboarding-shell"><header><BrandMark /><span>{index + 1} of {onboardingQuestions.length}</span></header><div className="progress-track"><div style={{ width: `${((index + 1) / onboardingQuestions.length) * 100}%` }} /></div><section className="question-wrap"><span className="step-label">YOUR STARTING PROFILE</span><h2>{question.prompt}</h2>{question.optional && <p className="muted">Optional — you can skip this or change it later.</p>}<div className="option-list">{question.options.map((option) => <button key={option} className={`option ${answer === option ? "selected" : ""}`} onClick={() => onAnswer(option)}><span>{option}</span>{answer === option && <Check size={18} />}</button>)}</div><footer className="question-footer"><button className="button ghost" onClick={onBack} disabled={index === 0}><ArrowLeft size={17} /> Back</button><button className="button primary" onClick={onNext} disabled={!answer && !question.optional}>{index === onboardingQuestions.length - 1 ? "Build my setup" : "Continue"} <ArrowRight size={17} /></button></footer></section></main>;
}

function ProfileSummary({ onContinue }: { onContinue: () => void }) {
  return <main className="centered-shell"><BrandMark /><section className="setup-card wide"><span className="eyebrow"><Sparkles size={15} /> Your starting setup</span><h1>YOVA will begin like this.</h1><p>This is a transparent starting point. It will change as YOVA learns from your completed sessions.</p><div className="profile-grid"><ProfileItem title="Structure" value="Clear, ordered steps" note="Fewer decisions when you begin" /><ProfileItem title="Session size" value="20–30 minutes" note="Short required sets first" /><ProfileItem title="Explanations" value="Examples before practice" note="Then support gradually fades" /><ProfileItem title="Focus support" value="One topic at a time" note="Visible progress and clear stopping points" /></div><button className="button primary large full" onClick={onContinue}>Continue <ArrowRight size={18} /></button></section></main>;
}

function ProfileItem({ title, value, note }: { title: string; value: string; note: string }) { return <div className="profile-item"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>; }

function PaywallPreview({ onContinue }: { onContinue: () => void }) {
  return <main className="centered-shell dark"><BrandMark /><section className="setup-card paywall"><span className="step-label">YOVA LITE</span><h1>A study system built around you.</h1><p>Plans, method selection, guided sessions, progress memory, and adjustments based on what happens next.</p><ul className="check-list"><li><Check /> Determine what you already know</li><li><Check /> Choose methods that fit the task and your tendencies</li><li><Check /> Tell you exactly how to perform each method</li><li><Check /> Adjust the next session using your results</li></ul><button className="button primary large full" onClick={onContinue}>Continue to private alpha</button><small>Payments will be connected after the core experience is validated.</small></section></main>;
}

function AppShell({ activeTab, onTab, account, cloudSyncIssue, onSignOut, children }: { activeTab: Tab; onTab: (tab: Tab) => void; account: PreviewAccount | null; cloudSyncIssue: string | null; onSignOut: () => void; children: React.ReactNode }) {
  const initial = account?.displayName.trim().charAt(0).toUpperCase() || "Y";
  return <div className="app-shell"><aside className="sidebar"><BrandMark /> <nav>{navItems.map(({ label, icon: Icon }) => <button key={label} className={activeTab === label ? "active" : ""} onClick={() => onTab(label)}><Icon size={19} />{label}</button>)}</nav><div className="sidebar-bottom"><button onClick={onSignOut}><LogOut size={18} /> Sign out</button><div className="account-dot">{initial}</div><div><strong>{account?.displayName || "YOVA user"}</strong><span>{account?.identityMode === "supabase" ? "Cloud account" : "Private alpha"}</span></div></div></aside><main className="app-content">{cloudSyncIssue && <div className="cloud-sync-warning"><strong>Cloud sync needs attention.</strong><span>{cloudSyncIssue} Your latest work is still saved in this browser.</span></div>}{children}</main></div>;
}

function PageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) { return <header className="page-header">{eyebrow && <span className="step-label">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</header>; }

function HomeScreen({ account, plans, plan, tutorQuestion, onTutorQuestion, onOpenTutor, onStart, onSelectPlan, onCreatePlan }: { account: PreviewAccount | null; plans: LearningPlan[]; plan: LearningPlan | null; tutorQuestion: string; onTutorQuestion: (question: string) => void; onOpenTutor: () => void; onStart: () => void; onSelectPlan: (planId: string) => void; onCreatePlan: () => void }) {
  const readySession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  const completedCount = plan?.sessions.filter((session) => session.status === "complete").length ?? 0;
  const firstName = account?.displayName.split(" ")[0] || "there";

  return <div className="page"><PageHeader eyebrow="MONDAY, AUGUST 3" title={`Good afternoon, ${firstName}.`} description="Here is the most useful next step across your active learning." />{plan && readySession ? <section className="recommendation-card"><div className="rec-top"><span className="eyebrow light"><Sparkles size={15} /> Recommended next</span><span>{completedCount} of {plan.sessions.length} sessions complete</span></div><div className="rec-body"><div><span className="subject-label">{plan.title.toUpperCase()}</span><h2>{readySession.title}</h2><div className="meta-row"><span><Target size={16} /> {readySession.method}</span><span><Clock3 size={16} /> {readySession.amountLabel}</span></div></div><button className="button white large" onClick={onStart}>Start session <ArrowRight size={18} /></button></div><div className="reason-grid"><div><strong>Why now</strong><p>This is the first unfinished session in your selected plan and fits today’s availability.</p></div><div><strong>Why this method</strong><p>{readySession.methodReason}</p></div></div></section> : <section className="empty-home"><span className="eyebrow"><Sparkles size={15} /> Start here</span><h2>Build your first learning plan.</h2><p>Tell YOVA what you need to learn. Materials are optional.</p><button className="button primary large" onClick={onCreatePlan}>Create a plan <ArrowRight size={18} /></button></section>}<AskBar value={tutorQuestion} onChange={onTutorQuestion} onSubmit={onOpenTutor} /><section className="quick-actions"><button><Plus size={18} /><span><strong>Study something now</strong><small>Build one focused session</small></span></button><button onClick={onCreatePlan}><BookOpen size={18} /><span><strong>{plan ? "Create another plan" : "Create a plan"}</strong><small>Prepare for a larger goal</small></span></button></section>{plans.length > 0 && <section className="section-block"><div className="section-title"><h3>Active learning</h3><span>{plans.length} {plans.length === 1 ? "goal" : "goals"}</span></div><div className="compact-items">{plans.map((item) => { const next = item.sessions.find((session) => session.status === "ready"); return <button className={item.id === plan?.id ? "selected" : ""} key={item.id} onClick={() => onSelectPlan(item.id)}><span className="item-icon blue">{item.title.charAt(0)}</span><span><strong>{item.title}</strong><small>{next ? `${next.method} · Next` : "Plan complete"}</small></span><ChevronRight /></button>; })}</div></section>}</div>;
}

function AskBar({ value, onChange, onSubmit, pending = false }: { value: string; onChange: (value: string) => void; onSubmit: () => void; pending?: boolean }) {
  return <form className="ask-bar" onSubmit={(event) => { event.preventDefault(); if (value.trim() && !pending) onSubmit(); }}><Sparkles size={20} /><input aria-label="Ask YOVA" placeholder="Ask YOVA anything or describe what you need…" value={value} disabled={pending} onChange={(event) => onChange(event.target.value)} /><button aria-label="Send" type="submit" disabled={!value.trim() || pending}>{pending ? <span className="button-spinner" /> : <Send size={18} />}</button></form>;
}

function LearningScreen({ plans, plan, onSelectPlan, onStart, onCreatePlan }: { plans: LearningPlan[]; plan: LearningPlan | null; onSelectPlan: (planId: string) => void; onStart: () => void; onCreatePlan: () => void }) {
  if (!plan) return <div className="page"><PageHeader eyebrow="LEARNING" title="What you’re working toward" description="Each goal keeps its plan, materials, sessions, resources, and progress together." /><section className="empty-home"><h2>No active learning yet.</h2><p>Create a plan to begin.</p><button className="button primary" onClick={onCreatePlan}>Create a plan</button></section></div>;
  const completeCount = plan.sessions.filter((session) => session.status === "complete").length;
  const readySession = plan.sessions.find((session) => session.status === "ready");
  return <div className="page"><PageHeader eyebrow="LEARNING" title="What you’re working toward" description="Each goal keeps its plan, materials, sessions, resources, and progress together." /><div className="tabs"><button className="active">Active</button><button>Recent studies</button><button>Archive</button></div>{plans.length > 1 && <div className="plan-switcher">{plans.map((item) => { const done = item.sessions.filter((session) => session.status === "complete").length; return <button className={item.id === plan.id ? "selected" : ""} key={item.id} onClick={() => onSelectPlan(item.id)}><span>{item.kind}</span><strong>{item.title}</strong><small>{done} of {item.sessions.length} sessions</small></button>; })}</div>}<section className="learning-hero"><div><span className="subject-label">{plan.kind.toUpperCase()} · {formatPlanDeadline(plan.deadline)}</span><h2>{plan.title}</h2><p>{plan.topic}</p><div className="progress-line"><div style={{ width: `${(completeCount / plan.sessions.length) * 100}%` }} /></div><small>{completeCount} of {plan.sessions.length} sessions complete</small></div>{readySession && <button className="button primary" onClick={onStart}>Start next session</button>}</section><section className="section-block"><div className="section-title"><h3>Plan timeline</h3><button>Adjust plan</button></div><div className="timeline">{plan.sessions.map((session) => <div className={`timeline-row ${session.status}`} key={session.id}><span className="timeline-node">{session.status === "complete" ? <Check size={15} /> : null}</span><div><strong>{session.title}</strong><small>{session.method} · {formatSessionTime(session.scheduledFor)}</small></div><span>{session.estimatedMinutes} min</span></div>)}</div></section></div>;
}

function AgendaScreen({ plans, onStart }: { plans: LearningPlan[]; onStart: (planId?: string) => void }) {
  const availableSessions = plans.flatMap((plan) => plan.sessions.filter((session) => session.status !== "complete").map((session) => ({ plan, session }))).sort((a, b) => new Date(a.session.scheduledFor).getTime() - new Date(b.session.scheduledFor).getTime());
  return <div className="page"><PageHeader eyebrow="AGENDA" title="Today and this week" description="One unified view of sessions and deadlines across your learning." /><section className="section-block"><div className="section-title"><h3>Upcoming</h3><button>Adjust agenda</button></div><div className="agenda-list">{availableSessions.length ? availableSessions.slice(0, 6).map(({ plan, session }) => <article key={session.id} className={session.status === "ready" ? "primary-agenda" : ""}><span className="agenda-window">{formatWindow(session.scheduledFor)}</span><div><strong>{session.title}</strong><small>{plan.title} · {session.estimatedMinutes} min</small></div>{session.status === "ready" ? <button className="button primary" onClick={() => onStart(plan.id)}>Start</button> : <button className="button ghost">Move</button>}</article>) : <p className="muted">Your upcoming sessions will appear here.</p>}</div></section><section className="week-strip">{availableSessions.slice(0, 5).map(({ plan, session }) => <div key={session.id}><span>{formatDay(session.scheduledFor)}</span><strong>{new Date(session.scheduledFor).getDate()}</strong><small>{plan.title}: {session.title}</small></div>)}</section></div>;
}

function AskScreen({ plan, question, onQuestion }: { plan: LearningPlan | null; question: string; onQuestion: (question: string) => void }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [outgoingQuestion, setOutgoingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    onQuestion("");

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

  const suggestedPrompts = plan
    ? ["Explain the current topic simply", "Quiz me on my weakest area", "Why is this method next?", "How can I make today’s session shorter?"]
    : ["Help me understand a difficult topic", "Quiz me on something I am learning", "Which study method should I use?", "Help me start a 20-minute study session"];

  return <div className="page ask-page"><PageHeader eyebrow="ASK YOVA" title="Get help in context" description="Ask about a topic, plan, session, or study problem." />{plan ? <div className="context-pill"><BookOpen size={15} /> Context: {plan.title} <ChevronRight size={15} /></div> : <div className="context-pill"><Sparkles size={15} /> General learning conversation</div>}<div className="chat-space">{historyLoading ? <div className="chat-loading"><span className="button-spinner dark" /> Loading your conversation…</div> : <div className="chat-thread">{messages.length === 0 && <div className="yova-message"><BrandMark compact /><div><strong>YOVA</strong><p>What would you like help with? I can explain a concept, quiz you, or help you decide what to do next.</p></div></div>}{messages.map((message) => message.role === "assistant" ? <div className="yova-message" key={message.id}><BrandMark compact /><div><strong>YOVA</strong><p>{message.content}</p></div></div> : <div className="user-message" key={message.id}><strong>You</strong><p>{message.content}</p></div>)}{outgoingQuestion && <div className="user-message pending" aria-live="polite"><strong>You</strong><p>{outgoingQuestion}</p></div>}</div>}{messages.length === 0 && !outgoingQuestion && !historyLoading && <div className="prompt-grid">{suggestedPrompts.map((prompt) => <button key={prompt} disabled={sending} onClick={() => void sendQuestion(prompt)}>{prompt}</button>)}</div>}{error && <div className="chat-error"><AlertCircle size={16} /><span>{error}</span></div>}</div><AskBar value={question} onChange={onQuestion} onSubmit={() => void sendQuestion()} pending={sending || historyLoading} /></div>;
}

function YouScreen({ account, sessionCompletions, onReset }: { account: PreviewAccount | null; sessionCompletions: SessionCompletion[]; onReset: () => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const totalCorrect = sessionCompletions.reduce((sum, completion) => sum + completion.correctAnswers, 0);
  const totalAnswers = sessionCompletions.reduce((sum, completion) => sum + completion.totalAnswers, 0);
  const accuracy = totalAnswers ? `${Math.round((totalCorrect / totalAnswers) * 100)}%` : "—";
  return <div className="page"><PageHeader eyebrow="YOU" title="Your learning, in one place" description="What you have told YOVA, what it has cautiously noticed, and your overall progress." /><div className="you-grid"><section className="section-block"><div className="section-title"><h3>Your starting preferences</h3><button>Edit</button></div><ProfileItem title="Account" value={account?.email || "Not connected"} note="Private-alpha identity" /><ProfileItem title="Guidance" value="Clear, ordered steps" note="Show fewer choices during sessions" /><ProfileItem title="Session size" value="20–30 minutes" note="Use as a starting estimate" /><ProfileItem title="Explanation" value="Examples first" note="Fade support into independent practice" /></section><section className="section-block"><div className="section-title"><h3>What YOVA has noticed</h3><span className="data-badge">Early signal</span></div><div className="insight"><Sparkles size={18} /><p>{sessionCompletions.length ? "You completed the required retrieval session. YOVA will keep testing whether shorter, clearly bounded sessions remain useful." : "YOVA needs completed sessions before it can responsibly show observed patterns."}</p></div><div className="metric-row"><div><strong>{sessionCompletions.length}</strong><span>sessions completed</span></div><div><strong>{accuracy}</strong><span>recent quiz accuracy</span></div></div></section><section className="section-block alpha-data-card"><div><h3>Private-alpha data</h3><p>Reset the account, onboarding answers, plans, and session results stored in this browser.</p></div>{confirmReset ? <div className="reset-confirm"><strong>This cannot be undone.</strong><span>Only this browser’s private-alpha data will be removed.</span><div><button className="button ghost" onClick={() => setConfirmReset(false)}>Cancel</button><button className="button danger" onClick={onReset}><Trash2 size={16} /> Reset everything</button></div></div> : <button className="button ghost danger-outline" onClick={() => setConfirmReset(true)}><Trash2 size={16} /> Reset private-alpha data</button>}</section></div></div>;
}

function lessonStepsFor(plan: LearningPlan | null): LessonStep[] {
  if (!plan) return [{ label: "Set up", title: "No session selected", body: "Return Home and select a learning goal first.", question: null }];

  const current = plan.sessions.find((session) => session.status === "ready") ?? plan.sessions.find((session) => session.status === "upcoming");

  if (plan.studyMode === "outside_yova") {
    return [
      { label: "Set up", title: "Prepare your outside study block", body: `Open the material you use for ${plan.topic}. Keep only that source and a place to work visible.`, question: null },
      { label: "Your task", title: current?.title ?? "Complete the planned work", body: `${current?.objective ?? "Work through the next planned objective."} Use ${current?.method.toLowerCase() ?? "the selected method"} for about ${current?.estimatedMinutes ?? 20} minutes.`, question: null },
      { label: "Method check", title: "What should happen before you check the source?", body: "The method works only if you make a real attempt before looking for the answer.", question: ["Attempt the task from memory", "Reread everything first", "Copy the source wording", "Switch topics"] },
      { label: "Return to YOVA", title: "Record what needs another pass", body: "Note the one idea or step that felt least stable. YOVA will use that signal when the session result is saved.", question: null },
    ];
  }

  if (/biology|photosynthesis|cellular respiration/i.test(plan.topic)) {
    return [
      { label: "Set up", title: "Closed-note retrieval", body: "Try to produce each answer before looking. Review only what you miss, then retry the missed item later.", question: null },
      { label: "Question 1 of 2", title: "Which stage of cellular respiration happens first?", body: "Answer from memory. Familiarity is not the same as being able to retrieve it.", question: ["Glycolysis", "Krebs cycle", "Electron transport chain", "Fermentation"] },
      { label: "Question 2 of 2", title: "Where does glycolysis occur?", body: "Choose the location without opening your notes.", question: ["Cytoplasm", "Mitochondrial matrix", "Nucleus", "Cell membrane"] },
      { label: "Repair the gap", title: "Compare before moving on", body: "Glycolysis occurs in the cytoplasm. Most later stages occur in the mitochondrion. Keep that contrast available for the next mixed-practice session.", question: null },
    ];
  }

  if (/finance|investing|budget|credit|interest/i.test(plan.topic)) {
    return [
      { label: "Set up", title: "Build the decision framework", body: "Start with the practical purpose of each concept. The goal is to make a sound decision, not merely recognize vocabulary.", question: null },
      { label: "Question 1 of 2", title: "What is the main purpose of a budget?", body: "Choose the answer that describes an active decision tool.", question: ["Direct money toward priorities and constraints", "Predict every future expense perfectly", "Eliminate all optional spending", "Track only large purchases"] },
      { label: "Question 2 of 2", title: "Which example shows compound growth?", body: "Look for growth that earns additional growth over time.", question: ["Interest earning interest", "A one-time discount", "A fixed monthly fee", "Cash kept at zero interest"] },
      { label: "Apply", title: "Connect the ideas to one real decision", body: "Choose one current spending, saving, debt, or investing decision and name the concept that should guide it.", question: null },
    ];
  }

  return [
    { label: "Set up", title: current?.method ?? "Focused learning", body: current?.methodReason ?? "Begin with one clearly bounded objective.", question: null },
    { label: "Retrieval check", title: "What makes this an active learning step?", body: "Choose the action that produces evidence of what you can do without support.", question: ["Explain or apply it before checking", "Read it repeatedly", "Highlight every sentence", "Keep all examples visible"] },
    { label: "Practice", title: current?.title ?? "Apply the next idea", body: current?.objective ?? `Use the plan to practice ${plan.topic}.`, question: null },
    { label: "Wrap up", title: "Name the least stable idea", body: "A specific gap is useful information. YOVA will use it to shape the next recommendation.", question: null },
  ];
}

function GuidedSession({ plan, steps, step, selectedAnswer, onSelect, onExit, onNext }: { plan: LearningPlan | null; steps: LessonStep[]; step: number; selectedAnswer: string | null; onSelect: (answer: string) => void; onExit: () => void; onNext: () => void }) {
  const content = steps[step];
  const currentSession = plan?.sessions.find((session) => session.status === "ready") ?? null;
  return <main className="session-shell"><header className="session-top"><BrandMark compact /><div><span>{plan?.title ?? "YOVA session"}</span><strong>{currentSession?.title ?? "Guided learning"}</strong></div><div className="session-progress"><span>{step + 1} of {steps.length} sections</span><div><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div></div><button className="button ghost" onClick={onExit}>Exit</button></header><section className="session-content"><span className="step-label">{content.label}</span><h1>{content.title}</h1><p>{content.body}</p>{content.question && <div className="answer-grid">{content.question.map((answer) => <button key={answer} className={selectedAnswer === answer ? "selected" : ""} onClick={() => onSelect(answer)}>{answer}{selectedAnswer === answer && <Check size={18} />}</button>)}</div>}{selectedAnswer && <div className="feedback"><Check size={20} /><div><strong>{selectedAnswer === content.question?.[0] ? "Correct." : "Useful miss."}</strong><p>{selectedAnswer === content.question?.[0] ? "You selected the action or idea the method depends on." : "YOVA will record this as something to repair before the next step."}</p></div></div>}<button className="button primary large" onClick={onNext} disabled={Boolean(content.question) && !selectedAnswer}>{step === steps.length - 1 ? "Complete session" : "Continue"} <ArrowRight size={18} /></button></section><div className="session-ask"><input placeholder="Ask YOVA about this session…" /><button><Send size={18} /></button></div></main>;
}

function SessionComplete({ correctAnswers, totalAnswers, onFinish }: { correctAnswers: number; totalAnswers: number; onFinish: () => void }) {
  const hasGap = correctAnswers < totalAnswers;
  return <main className="centered-shell completion"><BrandMark /><section className="setup-card wide"><div className="completion-icon"><Check size={28} /></div><span className="step-label">SESSION COMPLETE</span><h1>You completed this session.</h1><p>{hasGap ? "One or more details need another pass. YOVA will bring those details back before moving to harder application." : "You completed the required check. YOVA can now move the plan forward without adding unnecessary review."}</p><div className="result-grid"><div><span>Session steps</span><strong>4 of 4</strong></div><div><span>Knowledge checks</span><strong>{correctAnswers} of {totalAnswers}</strong></div><div><span>Next review</span><strong>Tomorrow</strong></div></div><div className="adaptation"><Sparkles size={19} /><div><strong>{hasGap ? "Tomorrow’s session was adjusted" : "Tomorrow’s session is ready"}</strong><p>{hasGap ? "Missed details will return in a short repair step before new material." : "The plan will continue into its next method without adding unnecessary review."}</p></div></div><p className="feedback-label">How did this session feel?</p><div className="feeling-row"><button>Too easy</button><button className="selected">About right</button><button>Too difficult</button></div><button className="button primary large full" onClick={onFinish}>Return Home</button></section></main>;
}

function formatSessionTime(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(isoDate));
}

function formatWindow(isoDate: string) {
  const hour = new Date(isoDate).getHours();
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function formatDay(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(isoDate)).toUpperCase();
}

function formatPlanDeadline(deadline: string | null) {
  if (!deadline) return "FLEXIBLE";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(deadline)).toUpperCase();
}

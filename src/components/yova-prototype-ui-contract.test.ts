import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("YOVA prototype UI contracts", () => {
  it("keeps every session setup step label visible at small viewports", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const styles = [
      readSource("src/app/globals.css"),
      readSource("src/app/polish.css"),
    ].join("\n");

    expect(component).toContain('["Direction", "Starting point", "Today"]');
    expect(styles).not.toMatch(/\.session-setup-progress strong\s*\{[^}]*display:\s*none/);
    expect(styles).toMatch(/\.session-setup-progress strong\s*\{[^}]*display:\s*block/);
  });

  it("renders every dedicated method runtime without disabling its answer surface", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const guidedStart = component.indexOf("function GuidedSession(");
    const guidedEnd = component.indexOf("function SessionGuidePanel", guidedStart);
    const guidedSession = component.slice(guidedStart, guidedEnd);

    expect(guidedSession).toContain('content.methodRuntime?.kind === "retrieval_round"');
    expect(guidedSession).toContain('content.methodRuntime?.kind === "worked_example" && <WorkedExampleRuntimePanel');
    expect(guidedSession).toContain('content.methodRuntime?.kind === "error_repair" && <ErrorRepairRuntimePanel');
    expect(guidedSession).toContain('content.methodRuntime?.kind === "concept_map"');
    expect(guidedSession).toContain('<ConceptMapRuntimePanel');
    expect(guidedSession).toContain("conceptMapDraftComplete");
    expect(guidedSession).toContain('content.methodRuntime?.kind !== "retrieval_round" && content.type === "multiple_choice"');
    expect(guidedSession).toContain('content.methodRuntime?.kind !== "retrieval_round" && content.type === "free_response"');
    expect(guidedSession).not.toContain("!content.methodRuntime && content.type");
  });

  it("does not request or insert a repair for an ungraded pretest miss", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const advanceStart = component.indexOf("const advanceActiveSession = async");
    const advanceEnd = component.indexOf("const completeActiveSession", advanceStart);
    const advanceSession = component.slice(advanceStart, advanceEnd);

    expect(advanceSession).toContain('currentActivity.methodPhase !== "pretest"');
    expect(readSource("src/lib/learning/session-evidence.ts")).toContain(
      'current.methodPhase === "pretest"',
    );
  });

  it("keeps a committed route authoritative during checkpoint and outage recovery", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const recoveryStart = component.indexOf("function recoveryMethodContext");
    const recoveryEnd = component.indexOf("// The server may make one bounded repair attempt", recoveryStart);
    const recovery = component.slice(recoveryStart, recoveryEnd);

    expect(recovery).toContain("const briefing = committedRoute");
    expect(recovery).toContain("buildCommittedRouteFallbackMethodBriefing(committedRoute, deliveryPolicy)");
    expect(recovery).toContain(": buildFallbackMethodBriefing(plan, methodSession, deliveryPolicy)");

    const guidedStart = component.indexOf("function GuidedSession(");
    const guidedEnd = component.indexOf("function SessionGuidePanel", guidedStart);
    const guidedSession = component.slice(guidedStart, guidedEnd);

    expect(guidedSession).toContain('outsideMethodSession?.studyRoute?.identity.lifecycleStatus === "committed"');
    expect(guidedSession).toContain(
      "buildCommittedRouteFallbackMethodBriefing(committedOutsideRoute, deliveryPolicy ?? undefined)",
    );
    expect(guidedSession).toContain(": methodBriefing ?? (plan");
  });

  it("lets uncertain or failed semantic checks continue without scoring them", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const guidedStart = component.indexOf("function GuidedSession(");
    const guidedEnd = component.indexOf("function SessionGuidePanel", guidedStart);
    const guidedSession = component.slice(guidedStart, guidedEnd);

    expect(guidedSession).toContain(
      'evaluationEvidenceDisposition === "no_evidence"',
    );
    expect(guidedSession).toContain(
      "outcome !== undefined || semanticEvaluationHasNoEvidence",
    );
    expect(guidedSession).toContain(
      "YOVA did not record a correct or incorrect result from this check.",
    );
    expect(guidedSession).toContain(
      "this uncertain or unavailable check created no concept or method evidence.",
    );
  });

  it("exposes one canonical profile and no retired experiment questionnaire", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const youStart = component.indexOf("function YouScreen(");
    const youEnd = component.indexOf("function browserTimeZone", youStart);
    const youScreen = component.slice(youStart, youEnd);

    expect(youScreen).toContain("<CanonicalProfileCenter");
    expect(youScreen).toContain("canonicalLearnerProfileFromAnswers(answers)");
    expect(youScreen).toContain("writeCanonicalLearnerProfileToAnswers");
    expect(youScreen).not.toContain("<PersonalizationCenter");
    expect(youScreen).not.toContain("startPersonalizationExperiment");
    expect(youScreen).not.toContain("DEEP_PROFILE_QUESTIONS");
  });

  it("imports a public canonical profile into new-account setup without a second questionnaire", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const accountStart = component.indexOf('if (stage === "account")');
    const onboardingStart = component.indexOf('if (stage === "onboarding-intro")', accountStart);
    const accountFlow = component.slice(accountStart, onboardingStart);

    expect(accountFlow).toContain("readPublicCanonicalProfileDraft(window.localStorage)");
    expect(accountFlow).toContain("writeCanonicalLearnerProfileToAnswers([], publicCanonicalProfile)");
    expect(accountFlow).toContain('if (publicCanonicalProfile) setStage("profile")');
    expect(component).toContain("clearPublicCanonicalProfileDraft(window.localStorage)");
  });

  it("retires legacy experiments at the live profile and completion boundaries", () => {
    const component = readSource("src/components/yova-prototype.tsx");

    expect(component).toContain(
      "const personalizationState = consolidatePersonalizationStateForCanonicalV1(",
    );
    expect(component).toContain(
      "consolidatePersonalizationStateForCanonicalV1,",
    );
    expect(component).toContain(
      "if (!currentState.controls.experiments && !currentState.activeExperiment)",
    );
    expect(component).toContain("canonicalProfileWorkspaceSettings({");
    expect(component).not.toContain("evaluateActivePersonalizationExperiment");
    expect(component).not.toContain("recordPersonalizationExperimentCompletion");
    expect(component).not.toContain("finishPersonalizationExperiment");
  });

  it("sends structured profile agency only through the explicit development-preview boundary", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const previewBoundary = readSource(
      "src/lib/plan-generation/development-preview-preferences.ts",
    );

    expect(component).toContain("const effectivePreviewCanonicalProfile = personalizationState.controls.selfReport");
    expect(component).toContain("previewCanonicalProfile={effectivePreviewCanonicalProfile}");
    expect(previewBoundary).toContain("if (!browserPreviewMode) return {};");
    expect(previewBoundary).toContain("previewCanonicalProfile: CanonicalLearnerProfileSchema.parse");
  });

  it("locks scheduled-review setup to the backend verification contract", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const setupStart = component.indexOf("function SessionSetup");
    const setupEnd = component.indexOf("export function formatSessionPreparationTopic", setupStart);
    const setup = component.slice(setupStart, setupEnd);

    expect(setup).toContain("const scheduledReview = isScheduledRetrievalSession(session)");
    expect(setup).toContain("if (scheduledReview)");
    expect(setup).toContain("onStart(null)");
    expect(setup).toContain("Exactly 3 multiple-choice questions");
    expect(setup).toContain("This return check has a fixed starting point.");
    expect(setup).toContain("Open the goal instead");
    expect(setup).toContain("setupPage === 2 && !scheduledReview");
    expect(component).toContain('requestedPlan.creationIntent === "study_now"');
    expect(component).toContain('if (requestedPlan?.status === "archived") return "archive"');
    expect(component).toContain("if (!resumePoint && adjustment === undefined)");
    expect(component).not.toContain("adjustment === undefined && !isScheduledRetrievalSession(requestedSession)");
  });

  it("does not offer controls that silently mutate a committed StudyRoute", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const setupStart = component.indexOf("function SessionSetup");
    const setupEnd = component.indexOf("export function formatSessionPreparationTopic", setupStart);
    const setup = component.slice(setupStart, setupEnd);
    const sourcesStart = component.indexOf("function PlanSources");
    const sourcesEnd = component.indexOf("function materialAttachmentWasCommitted", sourcesStart);
    const sources = component.slice(sourcesStart, sourcesEnd);

    expect(setup).toContain('routeContract?.resolution.source === "stored"');
    expect(setup).toContain("Time in this recipe");
    expect(setup).toContain("Cancel and use Adjust on the goal to change it visibly before starting.");
    expect(setup).toContain("availableMinutes: committedStudyRoute ? null : availableMinutes");
    expect(sources).toContain("const sourceChangeLocked");
    expect(sources).toContain("Sources are locked for this active plan");
    expect(sources).toContain("canAddSource && <MaterialLinkImporter");
  });

  it("keeps ready-session method control bounded, visible, and server-authoritative", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const styles = readSource("src/app/globals.css");
    const setupStart = component.indexOf("function SessionSetup");
    const setupEnd = component.indexOf("export function formatSessionPreparationTopic", setupStart);
    const setup = component.slice(setupStart, setupEnd);

    expect(setup).toContain("onChangeMethod: (selection:");
    expect(setup).toContain('storedSession?.status === "ready"');
    expect(setup).toContain("committedStudyRoute.identity.planId === plan.id");
    expect(setup).toContain("committedStudyRoute.identity.sessionId === session.id");
    expect(setup).toContain("!storedSession.resource");
    expect(setup).toContain(").slice(0, 2)");
    expect(setup).toContain('routeAgencyMode === "ill_customize"');
    expect(setup).toContain("boundedOtherAgencyMethodOptions(methodChoiceRoute)");
    expect(setup).toContain("otherMethodOptions.map((option)");
    expect(setup).toContain('selectionScope: "other_eligible_method"');
    expect(setup).toContain("requestedMethod,");
    expect(setup).toContain("resolveBoundedOtherMethodRequest({");
    expect(setup).toContain('resolution.status === "mapped"');
    expect(setup).toContain("setOtherMethodPreview(null)");
    expect(setup).toContain("committedStudyRoute?.approach.visibleMethodName");
    expect(setup).toContain("committedStudyRoute?.explanation.shortReason");
    expect(setup).toContain("expectedRouteRevisionId: methodChoiceRoute.identity.routeRevisionId");
    expect(setup).toContain("aria-expanded={methodChoicesOpen}");
    expect(setup).toContain("Other methods that also fit for ${session.title}");
    expect(setup).toContain("Other eligible methods");
    expect(setup).toContain("Questionable or incompatible methods are explained and mapped before anything changes.");
    expect(setup).toContain("Use {otherMethodPreview.selectedMethodName} instead");
    expect(setup).toContain("This recipe&apos;s eligible-method decision is no longer current.");
    expect(setup).toContain("Only the method changes. The target,");
    expect(setup).toContain('role="status" aria-live="polite"');
    expect(setup).toContain('role="alert"');
    expect(styles).toContain(".session-method-choice-trigger:focus-visible");
    expect(styles).toContain(".session-method-options > button:focus-visible");
    expect(styles).toContain(".session-other-method-request input:focus-visible");
    expect(styles).toContain(".session-other-method-mapping button:focus-visible");
  });

  it("shows the route-owned agency mode and complete recipe before a session starts", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const setupStart = component.indexOf("function SessionSetup");
    const setupEnd = component.indexOf("export function formatSessionPreparationTopic", setupStart);
    const setup = component.slice(setupStart, setupEnd);
    const recipeCard = readSource("src/components/study-route-recipe-card.tsx");

    expect(setup).toContain("<StudyRouteRecipeCard route={committedStudyRoute}");
    expect(recipeCard).toContain('label: "YOVA Decides"');
    expect(recipeCard).toContain('label: "Help Me Choose"');
    expect(recipeCard).toContain('label: "I’ll Customize"');
    expect(recipeCard).toContain("See the complete recipe");
    expect(recipeCard).toContain("changedSincePrevious.summary");
  });

  it("uses one return label throughout the lesson review dialog", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const dialogStart = component.indexOf('{reviewingModel &&');
    const dialogEnd = component.indexOf('{changingDirection &&', dialogStart);
    const reviewDialog = component.slice(dialogStart, dialogEnd);

    expect(dialogStart).toBeGreaterThan(-1);
    expect(dialogEnd).toBeGreaterThan(dialogStart);
    expect(reviewDialog).not.toContain("Return to question");
    expect(reviewDialog.match(/Back to the question/g)).toHaveLength(2);
  });

  it("does not replace truthful deadline write errors with a not-saved message", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const preserveStart = component.indexOf("const preserveSeedDeadline");
    const preserveEnd = component.indexOf("const retryCloudSync", preserveStart);
    const preserveDeadline = component.slice(preserveStart, preserveEnd);

    expect(preserveStart).toBeGreaterThan(-1);
    expect(preserveEnd).toBeGreaterThan(preserveStart);
    const handledWriteFailures = [
      ...(preserveDeadline.match(/\.catch\(\(error\)/g) ?? []),
      ...(preserveDeadline.match(/catch \(error\)/g) ?? []),
    ];
    expect(handledWriteFailures).toHaveLength(2);
    expect(preserveDeadline.match(/error\.message/g)).toHaveLength(2);
  });

  it("keeps required verification sessions out of every ungraded recovery path", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const startRecovery = readSource("src/lib/learning/session-start-recovery.ts");
    const guidedStart = component.indexOf("function GuidedSession(");
    const guidedEnd = component.indexOf("function SessionGuidePanel", guidedStart);
    const guidedSession = component.slice(guidedStart, guidedEnd);

    expect(component).toContain("&& !isScheduledRetrievalSession(requestedSession)");
    expect(component).toContain("canScheduleUnguidedVerification(sessionRecoverySession, activePlan.sessions.length)");
    expect(component).toContain("allowUnguidedCompletion={canScheduleUnguidedVerification(outsideMethodSession, plan?.sessions.length ?? 0)}");
    expect(component).toContain("hasGuidedQuestionsBelow={false}");
    expect(component).toContain("startDecision.cachedResourceRestorable");
    expect(startRecovery).toContain("canLoadBuiltInFallbackWithCompletion({");
    expect(component).toContain("&& fallbackCanComplete");
    expect(guidedStart).toBeGreaterThan(-1);
    expect(guidedEnd).toBeGreaterThan(guidedStart);
    expect(guidedSession).toContain("const quickScheduledReview = isScheduledRetrievalSession(currentSession)");
    expect(guidedSession).toContain('plan?.studyMode === "outside_yova" && currentSession && !quickScheduledReview');
  });

  it("locks every factual help surface until scheduled-review evidence is captured", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const guidedStart = component.indexOf("function GuidedSession(");
    const guideStart = component.indexOf("function SessionGuidePanel", guidedStart);
    const tutorStart = component.indexOf("function SessionTutor", guideStart);
    const guidedSession = component.slice(guidedStart, guideStart);
    const guidePanel = component.slice(guideStart, tutorStart);

    expect(guidedSession).toContain("const scheduledReviewEvidenceCaptured = quickScheduledReview");
    expect(guidedSession).toContain("scheduledReviewLearningSupportLocked");
    expect(guidedSession).toContain('aria-label="Ask YOVA is locked during this scheduled review"');
    expect(guidedSession).toContain(": !isStreamedInstruction && <SessionTutor");
    expect(guidePanel).toContain("const factualReviewDetailsLocked = quickScheduledReview && !scheduledReviewEvidenceCaptured");
    expect(guidePanel).toContain('aria-label="Scheduled review learning support locked"');
    expect(guidePanel).toContain("Essential ideas, source excerpts, and explanations return after all three answers are recorded.");
    expect(guidePanel).toContain(": <details className=\"session-guide-details\"><summary>Content and sources</summary>");
  });

  it("keeps operational unfinished Study Now goals manageable from Recent", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const detailStart = component.indexOf("function LearningPlanDetail(");
    const detailEnd = component.indexOf("function PlanKnowledgeMapPanel", detailStart);
    const detail = component.slice(detailStart, detailEnd);

    expect(detail).toContain('const canManagePlan = operational && view !== "archive"');
    expect(detail).toContain("canManagePlan && hasAdjustableUnfinishedWork");
    expect(detail).toContain("canManagePlan && showAdjustments");
    expect(detail).toContain("canExtend={canManagePlan}");
    expect(detail).toContain("editable={canManagePlan}");
    expect(component).toContain("adjustableUnfinishedCount");
    expect(component).toContain("ordinary unfinished");
    expect(component).toContain('protectedReviewCount === 1 ? "review keeps" : "reviews keep"');
  });

  it("uses one fail-closed recovery decision for labels, allowance, and launch", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const calendar = readSource("src/components/calendar/calendar-screen.tsx");
    const startSessionStart = component.indexOf("const startSession = async");
    const startSessionEnd = component.indexOf("const requestSessionStart", startSessionStart);
    const startSession = component.slice(startSessionStart, startSessionEnd);
    const homeStart = component.indexOf("function HomeScreen");
    const homeEnd = component.indexOf("function formatHomeDate", homeStart);
    const home = component.slice(homeStart, homeEnd);

    expect(startSession).toContain("sessionStartRecoveryDecision({");
    expect(startSession).toContain("startDecision.canStartWithoutGeneration");
    expect(startSession).toContain("startDecision.advertiseContinue");
    expect(startSession).toContain("resumePoint && storedRequestedSession.resource");
    expect(startSession).toContain("resolveExecutedStudyRouteSessionContract(");
    expect(home).toContain("sessionStartRecoveryDecision({");
    expect(home).toContain("startDecision?.resumePoint");
    expect(home).toContain("resolveExecutedStudyRouteSessionContract(");
    expect(home).toContain("homeRoute?.approach.visibleMethodName");
    expect(calendar).toContain("sessionStartRecoveryDecision({");
    expect(component).not.toContain("chooseLatestSessionResumePoint");
  });

  it("does not navigate home when completion cannot preserve verification", () => {
    const component = readSource("src/components/yova-prototype.tsx");

    expect(component).toContain("if (!completeActiveSession(");
    expect(component).toContain("YOVA kept this session open because it could not preserve the required guided verification");
  });

  it("routes post-session adaptation through the persisted agency contract", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const completionStart = component.indexOf("const completeActiveSession = (");
    const interruptionStart = component.indexOf("const interruptActiveSession = () =>", completionStart);
    const completion = component.slice(completionStart, interruptionStart);
    const receiptStart = component.indexOf("function SessionComplete(");
    const receiptEnd = component.indexOf("function formatElapsedDuration", receiptStart);
    const receipt = component.slice(receiptStart, receiptEnd);
    const controller = readSource("src/lib/study-route/agency-mode-controller.ts");

    expect(completion).toContain('adaptationAgencyMode === "yova_decides"');
    expect(completion).toContain('changeKind: "system_recommendation"');
    expect(completion).toContain('proposedDecision?.status !== "confirmation_required"');
    expect(completion).toContain("...requiredConfirmation");
    expect(completion).toContain("confirmedAt: completion.completedAt");
    expect(completion).toContain('changeKind: "learner_request"');
    expect(completion).toContain('support: "not_required"');
    expect(completion).toContain("routeTransition.appliedAdaptation ?? null");
    expect(receipt).toContain("YOVA DECIDES · APPLIES ON FINISH");
    expect(receipt).toContain("HELP ME CHOOSE · CONFIRMATION NEEDED");
    expect(receipt).toContain("I'LL CUSTOMIZE · RECOMMENDATION ONLY");
    expect(receipt).toContain("Finish and apply the update");
    expect(controller).toContain('mode: "help_me_choose" as const');
    expect(controller).toContain("any route change requires explicit confirmation");
  });

  it("establishes Exit recovery and its outbox before any checkpoint cloud sync", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const interruptionStart = component.indexOf("const interruptActiveSession = () =>");
    const interruptionEnd = component.indexOf("const resetYovaData = async", interruptionStart);
    const interruption = component.slice(interruptionStart, interruptionEnd);
    const terminalCheckpointWrite = interruption.indexOf("const exitCheckpointSaved = Boolean(");
    const localOnlyOption = interruption.indexOf("{ syncToAccount: false }", terminalCheckpointWrite);
    const interruptionState = interruption.indexOf("setSessionInterruptions(", localOnlyOption);
    const interruptionOutbox = interruption.indexOf("queueSessionInterruption({", interruptionState);
    const interruptionFlush = interruption.indexOf(
      "flushQueuedSessionInterruptions(account.id)",
      interruptionOutbox,
    );
    const recoveryCheckpointSync = interruption.indexOf(
      "await syncCheckpointToAccount(latestRecoveryCheckpoint)",
      interruptionFlush,
    );

    expect(interruptionStart).toBeGreaterThan(-1);
    expect(interruptionEnd).toBeGreaterThan(interruptionStart);
    expect(terminalCheckpointWrite).toBeGreaterThan(-1);
    expect(localOnlyOption).toBeGreaterThan(terminalCheckpointWrite);
    expect(interruptionState).toBeGreaterThan(localOnlyOption);
    expect(interruptionOutbox).toBeGreaterThan(interruptionState);
    expect(interruptionFlush).toBeGreaterThan(interruptionOutbox);
    expect(recoveryCheckpointSync).toBeGreaterThan(interruptionFlush);
    expect(interruption.slice(terminalCheckpointWrite, interruptionFlush)).not.toContain(
      "syncCheckpointToAccount(",
    );
    expect(interruption.slice(interruptionFlush, recoveryCheckpointSync)).toContain(
      "entry.interruption.id === interruption.id",
    );
  });

  it("keeps a just-flushed Exit authoritative during startup checkpoint merge", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const startup = component.slice(
      component.indexOf("async function openYova()"),
      component.indexOf("} else if (saved?.signedIn", component.indexOf("async function openYova()")),
    );
    const completionCapture = startup.indexOf("const startupCompletedSessionTombstones = new Set(");
    const capture = startup.indexOf("const startupInterruptionRunTombstones = new Set(");
    const flush = startup.indexOf("await flushQueuedSessionTerminals(cloudAccount.id)", capture);
    const mergedTombstones = startup.indexOf("const interruptedRunTombstones = new Set([", flush);
    const merge = startup.indexOf("mergeActiveSessionCheckpoints(localCheckpoints, cloudCheckpoints)", mergedTombstones);

    expect(completionCapture).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(completionCapture);
    expect(flush).toBeGreaterThan(capture);
    expect(mergedTombstones).toBeGreaterThan(flush);
    expect(merge).toBeGreaterThan(mergedTombstones);
    expect(startup.slice(flush, merge)).toContain(
      "...startupCompletedSessionTombstones",
    );
    expect(startup.slice(mergedTombstones, merge)).toContain(
      "...startupInterruptionRunTombstones",
    );
  });

  it("reconciles confirmed cloud terminals before reporting startup sync work", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const startup = component.slice(
      component.indexOf("async function openYova()"),
      component.indexOf("} else if (saved?.signedIn", component.indexOf("async function openYova()")),
    );
    const cloudLoad = startup.indexOf("await loadAuthenticatedLearningStateWithRetry()");
    const completionReconciliation = startup.indexOf("reconcileQueuedSessionCompletions(", cloudLoad);
    const interruptionReconciliation = startup.indexOf("reconcileQueuedSessionInterruptions(", completionReconciliation);
    const merge = startup.indexOf("mergeActiveSessionCheckpoints(localCheckpoints, cloudCheckpoints)", interruptionReconciliation);
    const pendingEvents = startup.indexOf("const pendingEvents = completionReconciliation.remaining", merge);

    expect(cloudLoad).toBeGreaterThan(-1);
    expect(completionReconciliation).toBeGreaterThan(cloudLoad);
    expect(interruptionReconciliation).toBeGreaterThan(completionReconciliation);
    expect(merge).toBeGreaterThan(interruptionReconciliation);
    expect(pendingEvents).toBeGreaterThan(merge);
    expect(startup.slice(completionReconciliation, merge)).toContain(
      "...authoritativeCompletedSessionIds",
    );
    expect(startup.slice(interruptionReconciliation, merge)).toContain(
      "...cloudState.sessionInterruptions.map((interruption) => interruption.id)",
    );
    expect(startup.slice(pendingEvents, pendingEvents + 180)).toContain(
      "+ interruptionReconciliation.remaining",
    );
  });

  it("does not treat an authoritative cloud profile hydration as a learner edit", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const startup = component.slice(
      component.indexOf("async function openYova()"),
      component.indexOf("} else if (saved?.signedIn", component.indexOf("async function openYova()")),
    );
    const capture = startup.indexOf(
      "authoritativeLearnerProfileSyncRef.current = captureAuthoritativeLearnerProfileSyncSnapshot(",
    );
    const hydrateAnswers = startup.indexOf("setAnswers(cloudState.onboardingAnswers)", capture);
    const autosaveStart = component.indexOf(
      'if (!ready || !onboardingCompleted || account?.identityMode !== "supabase") return;',
      component.indexOf("const retryQueuedWork = () =>"),
    );
    const autosaveEnd = component.indexOf("useEffect(() =>", autosaveStart + 1);
    const autosave = component.slice(autosaveStart, autosaveEnd);
    const pendingSync = readSource("src/lib/sync/pending-cloud-work.ts");
    const terminalFlush = pendingSync.indexOf("await flushQueuedSessionTerminals(accountId)");
    const liveProfileRead = pendingSync.indexOf("const current = readCurrentProfile()", terminalFlush);

    expect(capture).toBeGreaterThan(-1);
    expect(hydrateAnswers).toBeGreaterThan(capture);
    expect(autosave).toContain("learnerProfileNeedsSync(");
    expect(autosave.indexOf("learnerProfileNeedsSync(")).toBeLessThan(
      autosave.indexOf("saveAuthenticatedLearnerProfile({"),
    );
    expect(terminalFlush).toBeGreaterThan(-1);
    expect(liveProfileRead).toBeGreaterThan(terminalFlush);
    expect(pendingSync).toContain("learnerProfileNeedsSync(current.profileState");
  });

  it("keeps ordinary active-session checkpoint writes cloud-enabled by default", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const writerStart = component.indexOf("writeActiveSessionCheckpointRef.current = (");
    const writerEnd = component.indexOf("useEffect(() =>", writerStart);
    const writer = component.slice(writerStart, writerEnd);
    const ordinaryLifecycleWrite = component.indexOf(
      "void writeActiveSessionCheckpointRef.current();",
      writerEnd,
    );

    expect(writerStart).toBeGreaterThan(-1);
    expect(writerEnd).toBeGreaterThan(writerStart);
    expect(writer).toContain("options,");
    expect(writer).toContain('account.identityMode === "supabase" && options?.syncToAccount !== false');
    expect(writer).toContain("void syncCheckpointToAccount(checkpoint)");
    expect(ordinaryLifecycleWrite).toBeGreaterThan(writerEnd);
  });

  it("remembers the device-safe checkpoint returned by the cloud boundary", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const repository = readSource("src/lib/supabase/learning-state-repository.ts");
    const syncStart = component.indexOf("const syncCheckpointToAccount = useCallback");
    const syncEnd = component.indexOf("const refreshGuidedSessionAllowance", syncStart);
    const sync = component.slice(syncStart, syncEnd);
    const save = sync.indexOf("saveAuthenticatedActiveSessionCheckpoint(checkpoint)");
    const remember = sync.indexOf("rememberAuthoritativeCloudCheckpoint(authoritative)", save);

    expect(syncStart).toBeGreaterThan(-1);
    expect(syncEnd).toBeGreaterThan(syncStart);
    expect(save).toBeGreaterThan(-1);
    expect(remember).toBeGreaterThan(save);
    expect(repository).toContain(
      "...(checkpoint.activityProgress ? { activityProgress: checkpoint.activityProgress } : {})",
    );
  });

  it("classifies topic-agnostic outside built-in work as unguided practice", () => {
    const component = readSource("src/components/yova-prototype.tsx");

    expect(component).toContain('fallbackSelection?.kind === "generic_inside" || fallbackSelection?.kind === "outside_source"');
    expect(component).toContain('requestedPlan.studyMode === "outside_yova" && requestedSession.resource.origin === "built_in"');
  });

  it("reuses one guided-session operation id after an ambiguous browser timeout", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const operation = component.indexOf("reusableSessionGenerationOperation(");
    const header = component.indexOf('"X-Yova-Request-Id": clientRequestId', operation);
    const terminal = component.indexOf(
      "generationOperationReachedTerminalResponse = !isSessionGenerationOperationInProgress(body)",
      header,
    );
    const clear = component.indexOf("pendingSessionGenerationOperationRef.current = null", terminal);

    expect(operation).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(operation);
    expect(terminal).toBeGreaterThan(header);
    expect(clear).toBeGreaterThan(terminal);
  });

  it("keeps a paused canonical profile stored but out of workspace decisions", () => {
    const component = readSource("src/components/yova-prototype.tsx");

    expect(component).toContain("profile: personalizationState.controls.selfReport");
    expect(component).toContain(": createCanonicalLearnerProfile([])");
    expect(component).toContain("enabled={canonicalState.controls.selfReport}");
    expect(component).toContain('"selfReport",');
    expect(component).toContain("setPersonalizationControl(");
  });

  it("clears local Calendar data only after permanent account deletion", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const signOutStart = component.indexOf("const signOut = async");
    const signOutEnd = component.indexOf("const beginRecoveryMethodPractice", signOutStart);
    const signOut = component.slice(signOutStart, signOutEnd);

    expect(signOut).toContain("clearConfirmedSignOutStorage(signingOutAccountId, {");
    expect(signOut).toContain("clearDeletedAccountCalendar: accountAlreadyDeleted");
  });
});

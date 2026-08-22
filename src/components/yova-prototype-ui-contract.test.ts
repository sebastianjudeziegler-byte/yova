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
    expect(preserveDeadline.match(/\.catch\(\(error\)/g)).toHaveLength(2);
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
    const startSessionStart = component.indexOf("const startSession = async");
    const startSessionEnd = component.indexOf("const requestSessionStart", startSessionStart);
    const startSession = component.slice(startSessionStart, startSessionEnd);
    const homeStart = component.indexOf("function HomeScreen");
    const homeEnd = component.indexOf("function SubjectIcon", homeStart);
    const home = component.slice(homeStart, homeEnd);
    const agendaStart = component.indexOf("function AgendaScreen");
    const agenda = component.slice(agendaStart);

    expect(startSession).toContain("sessionStartRecoveryDecision({");
    expect(startSession).toContain("startDecision.canStartWithoutGeneration");
    expect(startSession).toContain("startDecision.advertiseContinue");
    expect(home).toContain("sessionStartRecoveryDecision({");
    expect(home).toContain("startDecision?.resumePoint");
    expect(agenda).toContain("sessionStartRecoveryDecision({");
    expect(component).not.toContain("chooseLatestSessionResumePoint");
  });

  it("does not navigate home when completion cannot preserve verification", () => {
    const component = readSource("src/components/yova-prototype.tsx");

    expect(component).toContain("if (!completeActiveSession(");
    expect(component).toContain("YOVA kept this session open because it could not preserve the required guided verification");
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
});

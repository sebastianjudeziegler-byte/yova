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

    expect(component).toContain("&& !isScheduledRetrievalSession(requestedSession)");
    expect(component).toContain("canScheduleUnguidedVerification(sessionRecoverySession, activePlan.sessions.length)");
    expect(component).toContain("allowUnguidedCompletion={canScheduleUnguidedVerification(outsideMethodSession, plan?.sessions.length ?? 0)}");
    expect(component).toContain("&& restoredFallbackCanComplete");
    expect(component).toContain("&& fallbackCanComplete");
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
});

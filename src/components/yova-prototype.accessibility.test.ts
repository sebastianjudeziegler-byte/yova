import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell, LoadingAccount, OnboardingQuestion } from "@/components/yova-prototype";
import { CANONICAL_PROFILE_QUESTIONS } from "@/lib/personalization/canonical-profile-questionnaire";

vi.mock("@/components/brand-mark", () => ({ BrandMark: () => null }));

const polishStyles = readFileSync(resolve(process.cwd(), "src/app/polish.css"), "utf8");
const prototypeSource = readFileSync(resolve(process.cwd(), "src/components/yova-prototype.tsx"), "utf8");
const modalSource = readFileSync(resolve(process.cwd(), "src/components/accessible-modal-dialog.tsx"), "utf8");

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ruleDeclarations(selector: string) {
  return [...polishStyles.matchAll(new RegExp(`${escapePattern(selector)}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1] ?? "");
}

function pixelValues(selector: string, property: string) {
  const propertyPattern = new RegExp(`${escapePattern(property)}:\\s*(\\d+)px`, "g");
  return ruleDeclarations(selector).flatMap((declarations) => (
    [...declarations.matchAll(propertyPattern)].map((match) => Number(match[1]))
  ));
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * (channels[0] ?? 0))
    + (0.7152 * (channels[1] ?? 0))
    + (0.0722 * (channels[2] ?? 0));
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

describe("learner-facing accessibility contracts", () => {
  it("keeps every responsive sidebar destination named when its visible label is hidden", () => {
    const html = renderToStaticMarkup(createElement(
      AppShell,
      {
        activeTab: "Home",
        onTab: vi.fn(),
        account: null,
        cloudSyncIssue: null,
        signOutIssue: null,
        signingOut: false,
        onRetryCloudSync: vi.fn().mockResolvedValue(undefined),
        onAdd: vi.fn(),
        onSignOut: vi.fn().mockResolvedValue(undefined),
        workspaceClassName: "",
      },
      createElement("p", null, "Home content"),
    ));

    for (const label of ["Home", "Learning", "Calendar", "Ask YOVA", "You"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-label="Home" aria-current="page"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("server-renders useful public content while account restoration runs", () => {
    const html = renderToStaticMarkup(createElement(LoadingAccount, { inviteOnly: true }));

    expect(html).toContain("Know what to study next.");
    expect(html).toContain('href="/study-profile"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("YOVA private alpha");
    expect(html).not.toContain("Opening your YOVA…");
  });

  it("uses one native modal boundary for every app overlay", () => {
    expect(prototypeSource.match(/<AccessibleModalDialog/g)).toHaveLength(5);
    expect(prototypeSource).not.toContain('className="tutor-history-panel" role="dialog"');
    expect(prototypeSource).not.toContain('className="session-exit-dialog" role="dialog"');
    expect(modalSource).toContain("dialog.showModal()");
    expect(modalSource).toContain("onCancel={(event)");
    expect(modalSource).toContain('event.key === "Escape"');
    expect(modalSource).toContain("restoreTarget?.isConnected");
    expect(modalSource).toContain("event.target === event.currentTarget");
  });

  it("keeps meaningful faint text at WCAG AA contrast on app surfaces", () => {
    const faint = polishStyles.match(/--faint:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(faint).toBeDefined();
    expect(contrastRatio(faint ?? "#ffffff", "#f7f8fc")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(faint ?? "#ffffff", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("gives every previously implicit writing surface an accessible name", () => {
    expect(readFileSync(resolve(process.cwd(), "src/components/add-to-yova.tsx"), "utf8"))
      .toContain('aria-label="Describe what you need to learn or complete"');
    expect(readFileSync(resolve(process.cwd(), "src/components/study-now-creator.tsx"), "utf8"))
      .toContain('aria-label="Study Now topic or result"');
    const planCreator = readFileSync(resolve(process.cwd(), "src/components/plan-creator.tsx"), "utf8");
    expect(planCreator).toContain('aria-label="Learning goal or deadline"');
    expect(planCreator).toContain('aria-label="Requested topic map change"');
    expect(prototypeSource).toContain('aria-label="Question about this lesson"');
  });

  it("groups onboarding choices and exposes the selected button state", () => {
    const question = CANONICAL_PROFILE_QUESTIONS[0];
    const selected = question.options[1];
    const html = renderToStaticMarkup(createElement(OnboardingQuestion, {
      index: 0,
      answer: selected.id,
      onAnswer: vi.fn(),
      onBack: vi.fn(),
      onNext: vi.fn(),
    }));

    expect(html).toContain(`<h2 id="onboarding-question-0">${question.prompt}</h2>`);
    expect(html).toContain('class="option-list" role="group" aria-labelledby="onboarding-question-0"');
    expect(html.match(/<button type="button" aria-pressed=/g)).toHaveLength(question.options.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(question.options.length - 1);
    expect(html).toMatch(/<button type="button" aria-pressed="true" class="option selected"/);
  });

  it("keeps home controls and mobile navigation at least 44 pixels tall", () => {
    const homeControlRule = ruleDeclarations(".home-page :is(button, input, summary)").join(" ");
    expect(homeControlRule).toMatch(/min-width:\s*44px/);
    expect(homeControlRule).toMatch(/min-height:\s*44px/);

    for (const selector of [
      ".sidebar-create",
      '.sidebar > nav[aria-label="Main navigation"] button',
      ".home-personalization-recommendation > button",
    ]) {
      const heights = pixelValues(selector, "min-height");
      expect(heights.length).toBeGreaterThan(0);
      expect(heights.every((height) => height >= 44)).toBe(true);
    }
  });

  it("gives compact home controls a 44 by 44 pixel target", () => {
    expect(ruleDeclarations(".home-personalization-proof button").join(" ")).toMatch(/min-width:\s*44px/);
    expect(ruleDeclarations(".home-personalization-proof button").join(" ")).toMatch(/min-height:\s*44px/);
    expect(ruleDeclarations(".rec-carousel-controls button").join(" ")).toMatch(/width:\s*44px/);
    expect(ruleDeclarations(".rec-carousel-controls button").join(" ")).toMatch(/height:\s*44px/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/width:\s*44px/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/height:\s*44px/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/padding:\s*0/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/display:\s*grid/);
    expect(ruleDeclarations(".ask-bar button, .session-ask button").join(" ")).toMatch(/place-items:\s*center/);
  });
});

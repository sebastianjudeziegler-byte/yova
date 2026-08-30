import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/sessions/generate/route.ts"),
  "utf8",
);

describe("guided-session optional personalization history contract", () => {
  it("routes history through the bounded owner-aware reader", () => {
    expect(routeSource).toContain(
      'import { readOptionalSessionPersonalizationHistory } from "@/lib/server/session-personalization-history"',
    );
    expect(routeSource).toContain("readOptionalSessionPersonalizationHistory(supabase, {");
    expect(routeSource).toContain("userId: user.id");
    expect(routeSource).not.toContain('.order("completed_at", { ascending: true })');
    expect(routeSource).not.toContain('.order("occurred_at", { ascending: true })');
  });

  it("keeps required resource failures fatal while treating history degradation as optional", () => {
    const historyRead = routeSource.indexOf("readOptionalSessionPersonalizationHistory(supabase, {");
    const requiredFailureGate = routeSource.indexOf("if (itemError || materialsError)", historyRead);
    const degradedNotice = routeSource.indexOf(
      "if (personalizationHistory.degradedSources.length > 0)",
      requiredFailureGate,
    );
    const providerCall = routeSource.indexOf("generateProductionSessionWithOpenAI(", degradedNotice);

    expect(historyRead).toBeGreaterThan(-1);
    expect(requiredFailureGate).toBeGreaterThan(historyRead);
    expect(degradedNotice).toBeGreaterThan(requiredFailureGate);
    expect(providerCall).toBeGreaterThan(degradedNotice);
    expect(routeSource.slice(requiredFailureGate, degradedNotice)).not.toContain(
      "personalizationHistory.degradedSources",
    );
  });
});

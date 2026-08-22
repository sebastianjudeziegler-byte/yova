import { describe, expect, it } from "vitest";
import { generatedSessionDefersStoredPlanTargets } from "@/lib/session-generation/deferred-cache-contract";

describe("deferred generated-session persistence", () => {
  it("requires durable persistence only when deferred labels belong to stored plan scope", () => {
    const storedTargets = ["Glycolysis inputs and outputs", "Electron transport chain mechanism"];

    expect(generatedSessionDefersStoredPlanTargets({
      coverage: { deferredContent: ["  electron   transport chain mechanism "] },
    } as never, storedTargets)).toBe(true);
    expect(generatedSessionDefersStoredPlanTargets({
      coverage: { deferredContent: ["Optional neighboring enrichment"] },
    } as never, storedTargets)).toBe(false);
    expect(generatedSessionDefersStoredPlanTargets({
      coverage: { deferredContent: [] },
    } as never, storedTargets)).toBe(false);
  });
});

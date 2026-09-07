import { describe, expect, it } from "vitest";
import { generatedSessionDefersStoredPlanTargets, generatedSessionDefersAllStoredPlanTargets } from "@/lib/session-generation/deferred-cache-contract";

describe("deferred generated-session persistence", () => {
  it("detects the audited all-deferred parent target without rejecting a genuine partial continuation", () => {
    const session = { coverage: { deferredContent: [" Choose a clear persuasive claim ", "Avoid broad topics"] } };
    expect(generatedSessionDefersAllStoredPlanTargets(session, ["Choose a clear persuasive claim"])).toBe(true);
    expect(generatedSessionDefersAllStoredPlanTargets(session, ["Choose a clear persuasive claim", "Build supporting evidence"])).toBe(false);
    expect(generatedSessionDefersAllStoredPlanTargets(session, [])).toBe(false);
  });
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

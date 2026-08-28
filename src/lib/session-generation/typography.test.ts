import { describe, expect, it } from "vitest";
import {
  polishActivityLabel,
  polishGeneratedSessionTypography,
  polishLearnerText,
} from "@/lib/session-generation/typography";
import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

describe("session typography", () => {
  it("removes generated dash and bullet punctuation from learner text", () => {
    expect(polishLearnerText("Resources now\u2014such as staff • product development")).toBe(
      "Resources now, such as staff; product development",
    );
  });

  it("removes numbering from activity labels because the interface owns step order", () => {
    expect(polishActivityLabel("1. READ:")).toBe("READ");
  });

  it("preserves the exact versioned method name while polishing generated prose", () => {
    const draft = {
      rationale: "Trace—then test",
      coverage: {
        focus: "Trace—then test",
        essentialIdeas: [],
        completionEvidence: [],
        evidenceMap: [],
        deferredContent: [],
      },
      methodBriefing: {
        name: "Trace–Code–Test",
        what: "Trace—then code",
        why: "Trace—then test",
        how: [],
        completion: "Trace—then test",
        personalization: [],
      },
      activities: [],
    } as unknown as GeneratedSessionDraft;

    const polished = polishGeneratedSessionTypography(draft);
    expect(polished.methodBriefing.name).toBe("Trace–Code–Test");
    expect(polished.methodBriefing.what).toBe("Trace, then code");
  });
});

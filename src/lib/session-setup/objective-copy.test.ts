import { describe, expect, it } from "vitest";
import { sessionSetupObjective } from "@/lib/session-setup/objective-copy";

const legacyWorldWarOneSession = {
  title: "Learn Long-term causes of tension in Europe and 2 connected topics",
  objective: "Use your chosen source to make progress toward I want to review the causes of World War I using... by learning Long-term causes of tension in Europe, Alliance systems and escalation, The Balkan crisis and the assassination of Archduke Franz Ferdinand, close the source, then...",
  contentTargets: [
    "Long-term causes of tension in Europe",
    "Alliance systems and escalation",
    "The Balkan crisis and the assassination of Archduke Franz Ferdinand",
  ],
};

describe("sessionSetupObjective", () => {
  it("repairs a persisted truncated outside-YOVA objective into a complete source, action, and return direction", () => {
    const objective = sessionSetupObjective("outside_yova", legacyWorldWarOneSession);

    expect(objective).toBe(
      "Open your chosen source and work through Long-term causes of tension in Europe and 2 connected topics. Close the source, then return to YOVA and explain or apply what you understood.",
    );
    expect(objective).not.toMatch(/\.{3}|…|,\s*(?:then)?\s*$/u);
  });

  it("leaves complete current objectives and inside-YOVA objectives unchanged", () => {
    const complete = "Open your chosen source and work through the causes of World War I. Close the source, then return to YOVA and explain how the causes connect.";

    expect(sessionSetupObjective("outside_yova", {
      ...legacyWorldWarOneSession,
      objective: complete,
    })).toBe(complete);
    expect(sessionSetupObjective("inside_yova", legacyWorldWarOneSession))
      .toBe(legacyWorldWarOneSession.objective);
  });
});

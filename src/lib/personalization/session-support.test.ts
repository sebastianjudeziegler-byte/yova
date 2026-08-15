import { describe, expect, it } from "vitest";
import {
  familiarityForSessionSupport,
  sessionSupportExplanation,
} from "@/lib/personalization/session-support";

describe("session support dial", () => {
  it("maps more help to teaching first for this request", () => {
    expect(familiarityForSessionSupport({
      level: "more_help",
      selectedFamiliarity: "as_planned",
    })).toBe("need_teaching");
  });

  it("maps more challenge to an independent application request", () => {
    expect(familiarityForSessionSupport({
      level: "more_challenge",
      selectedFamiliarity: "already_know",
    })).toBe("challenge_me");
  });

  it("keeps the learner's selected starting point at usual support", () => {
    expect(familiarityForSessionSupport({
      level: "usual",
      selectedFamiliarity: "already_know",
    })).toBe("already_know");
    expect(sessionSupportExplanation("usual")).toContain("usual support");
  });
});

import { describe, expect, it } from "vitest";
import { polishActivityLabel, polishLearnerText } from "@/lib/session-generation/typography";

describe("session typography", () => {
  it("removes generated dash and bullet punctuation from learner text", () => {
    expect(polishLearnerText("Resources now—such as staff • product development")).toBe(
      "Resources now, such as staff; product development",
    );
  });

  it("removes numbering from activity labels because the interface owns step order", () => {
    expect(polishActivityLabel("1. READ:")).toBe("READ");
  });
});

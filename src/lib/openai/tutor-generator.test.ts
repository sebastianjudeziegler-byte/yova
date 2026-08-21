import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/openai/client", () => ({
  getOpenAIClient: () => ({ responses: { create: mocks.create } }),
}));
vi.mock("@/lib/openai/config", () => ({
  getOpenAITutorConfig: () => ({ model: "tutor-model" }),
}));

import {
  generateTutorAnswer,
  guardProtectedUpcomingCheckAnswer,
} from "@/lib/openai/tutor-generator";

describe("protected upcoming-check tutor guard", () => {
  const multipleChoiceCheck = {
    title: "Transport against a gradient",
    prompt: "Which process moves ions against their concentration gradient by using cellular energy?",
    choices: ["Simple diffusion", "Osmosis", "Active transport", "Facilitated diffusion"],
    correctAnswer: "Active transport",
  };

  it("replaces a leaked multiple-choice answer with a content-free boundary", () => {
    const guarded = guardProtectedUpcomingCheckAnswer(
      "The exact answer is **Active transport**.",
      [multipleChoiceCheck],
    );

    expect(guarded).not.toMatch(/active transport/i);
    expect(guarded).toMatch(/upcoming check/i);
    expect(guarded).toMatch(/attempt first/i);
  });

  it("allows an unrelated tutor answer", () => {
    const answer = "Ocean tides are driven mainly by the Moon's gravity.";
    expect(guardProtectedUpcomingCheckAnswer(answer, [multipleChoiceCheck])).toBe(answer);
  });

  it("blocks a distinctive excerpt from a longer free-response reference", () => {
    const guarded = guardProtectedUpcomingCheckAnswer(
      "The key is that water moves across a selectively permeable membrane toward the side with greater solute concentration.",
      [{
        title: "Explain osmosis",
        prompt: "Explain the direction of water movement.",
        choices: [],
        correctAnswer: "During osmosis, water moves across a selectively permeable membrane toward the side with greater solute concentration until water potential is balanced.",
      }],
    );

    expect(guarded).not.toMatch(/greater solute concentration/i);
    expect(guarded).toMatch(/will not reveal/i);
  });
});

describe("tutor provider boundary", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({
      status: "completed",
      output_text: "A bounded and useful explanation.",
      model: "tutor-model",
      id: "response-1",
    });
  });

  it("disables SDK retries and finishes before the route deadline", async () => {
    await expect(generateTutorAnswer({
      question: "Explain this concept",
      persistenceMode: "ephemeral",
      history: [],
    }, {
      title: null,
      topic: null,
      planRationale: null,
      materials: [],
      currentSession: null,
      learnerProfile: null,
    })).resolves.toMatchObject({ answer: "A bounded and useful explanation." });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.anything(),
      { maxRetries: 0, timeout: 40_000 },
    );
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { userFacingErrorMessage } from "@/lib/errors/user-facing-message";

const FALLBACK = "YOVA could not build this plan yet.";

describe("userFacingErrorMessage", () => {
  it("hides a ZodError issue dump behind the caller's fallback", () => {
    const schema = z.object({ question: z.string().max(240) });
    const failure = schema.safeParse({ question: "x".repeat(241) });
    expect(failure.success).toBe(false);
    if (failure.success) return;

    const message = userFacingErrorMessage(failure.error, FALLBACK);

    expect(message).toBe(FALLBACK);
    expect(message).not.toContain("too_big");
    expect(message).not.toContain("question");
  });

  it("keeps a message that was written for the learner", () => {
    const message = userFacingErrorMessage(
      new Error("Choose how YOVA should build this plan."),
      FALLBACK,
    );

    expect(message).toBe("Choose how YOVA should build this plan.");
  });

  it("falls back for a thrown value that is not an error", () => {
    expect(userFacingErrorMessage("boom", FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for an error whose message is a serialized payload", () => {
    expect(userFacingErrorMessage(new Error('[{"code":"too_big"}]'), FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(new Error('{"error":"nope"}'), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for an error with an empty message", () => {
    expect(userFacingErrorMessage(new Error("   "), FALLBACK)).toBe(FALLBACK);
  });
});

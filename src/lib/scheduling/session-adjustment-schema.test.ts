import { describe, expect, it } from "vitest";
import { SessionDurationAdjustmentRequestSchema } from "@/lib/scheduling/session-adjustment-schema";

describe("session duration adjustment schema", () => {
  const planSessionId = "10000000-1000-4000-8000-100000000001";

  it("uses the same ten-minute runnable floor as recovery splitting", () => {
    expect(SessionDurationAdjustmentRequestSchema.safeParse({
      planSessionId,
      estimatedMinutes: 10,
    }).success).toBe(true);
    expect(SessionDurationAdjustmentRequestSchema.safeParse({
      planSessionId,
      estimatedMinutes: 5,
    }).success).toBe(false);
  });
});

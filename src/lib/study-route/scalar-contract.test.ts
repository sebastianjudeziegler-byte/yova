import { describe, expect, it } from "vitest";
import {
  canonicalStudyRouteSessionScalars,
  STUDY_ROUTE_METHOD_MAX_LENGTH,
  STUDY_ROUTE_OUTCOME_MAX_LENGTH,
  STUDY_ROUTE_REASON_MAX_LENGTH,
} from "@/lib/study-route/scalar-contract";

describe("canonical StudyRoute session scalars", () => {
  it("preserves unrelated session fields while enforcing the shared route bounds", () => {
    const result = canonicalStudyRouteSessionScalars({
      id: "session-1",
      method: `  ${"m".repeat(140)}  `,
      methodReason: `  ${"r".repeat(360)}  `,
      objective: `  ${"o".repeat(560)}  `,
    });

    expect(result.id).toBe("session-1");
    expect(result.method).toHaveLength(STUDY_ROUTE_METHOD_MAX_LENGTH);
    expect(result.methodReason).toHaveLength(STUDY_ROUTE_REASON_MAX_LENGTH);
    expect(result.objective).toHaveLength(STUDY_ROUTE_OUTCOME_MAX_LENGTH);
    expect(result.method).not.toMatch(/^\s|\s$/);
    expect(result.methodReason).not.toMatch(/^\s|\s$/);
    expect(result.objective).not.toMatch(/^\s|\s$/);
  });
});

import { describe, expect, it } from "vitest";
import { composeStudyRouteProfileVersion } from "@/lib/study-route/provenance-version";

describe("StudyRoute profile provenance composition", () => {
  it("drops only legacy unknown and preserves each deterministic context", () => {
    expect(composeStudyRouteProfileVersion(
      "legacy_unknown",
      "duration_context_v1+profile_revision:7",
      "method_context_v1+profile_revision:7",
    )).toBe(
      "duration_context_v1+profile_revision:7+method_context_v1",
    );
  });

  it("deduplicates repeated components without changing their first-seen order", () => {
    expect(composeStudyRouteProfileVersion(
      "duration_context_v1+profile_revision:7",
      "duration_context_v1+method_context_v1",
    )).toBe(
      "duration_context_v1+profile_revision:7+method_context_v1",
    );
  });

  it("rejects a route that still has only legacy profile provenance", () => {
    expect(() => composeStudyRouteProfileVersion("legacy_unknown", "legacy_unknown"))
      .toThrow(/non-legacy profile provenance/i);
  });

  it("keeps one shared learner-context snapshot bounded across independent decisions", () => {
    const snapshot = [
      "authorized_profile_context_v1",
      "profile_revision_mt5p3vk0",
      "learner_profile_schema_v1",
      "additional_context_v3",
      "personalization_state_v1",
      "profile_model_v1",
    ].join("+");

    const combined = composeStudyRouteProfileVersion(snapshot, snapshot);

    expect(combined).toBe(snapshot);
    expect(combined.length).toBeLessThanOrEqual(200);
  });
});

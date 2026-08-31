import { describe, expect, it } from "vitest";
import {
  STUDY_PROFILE_METHOD_CATALOG,
  STUDY_PROFILE_METHOD_CATALOG_IDS,
  STUDY_PROFILE_NAMED_PATTERN_IDS,
  buildStudyProfileMethodCatalog,
  selectStudyProfileTopMethods,
} from "@/lib/study-profile";

describe("Study Profile method catalog", () => {
  it("contains exactly 15 unique, implementation-ready methods", () => {
    expect(STUDY_PROFILE_METHOD_CATALOG).toHaveLength(15);
    expect(STUDY_PROFILE_METHOD_CATALOG.map(({ id }) => id))
      .toEqual(STUDY_PROFILE_METHOD_CATALOG_IDS);
    expect(new Set(STUDY_PROFILE_METHOD_CATALOG.map(({ id }) => id)).size).toBe(15);

    for (const method of STUDY_PROFILE_METHOD_CATALOG) {
      expect(method.steps.length).toBeGreaterThanOrEqual(4);
      expect(method.timeCost.length).toBeGreaterThan(2);
      expect(method.tonightVersion.length).toBeGreaterThan(20);
      expect(Object.keys(method.fitByPattern)).toEqual(STUDY_PROFILE_NAMED_PATTERN_IDS);
    }
  });

  it.each(STUDY_PROFILE_NAMED_PATTERN_IDS)(
    "selects three strong-fit methods for %s",
    (patternId) => {
      const selected = selectStudyProfileTopMethods(patternId);

      expect(selected).toHaveLength(3);
      expect(new Set(selected.map(({ id }) => id)).size).toBe(3);
      expect(selected.every(({ fit }) => fit === "strong_fit")).toBe(true);
      expect(selected.every(({ fitLabel }) => fitLabel.startsWith("Strong fit for")))
        .toBe(true);
    },
  );

  it("keeps all methods visible with a fit label for the current pattern", () => {
    const catalog = buildStudyProfileMethodCatalog("stalled_starter");

    expect(catalog).toHaveLength(15);
    expect(catalog.find(({ id }) => id === "five_minute_start")?.fit)
      .toBe("strong_fit");
    expect(catalog.find(({ id }) => id === "exam_condition_practice")?.fit)
      .toBe("skip_for_now");
    expect(catalog.find(({ id }) => id === "active_recall")?.fit)
      .toBe("situational");
  });
});

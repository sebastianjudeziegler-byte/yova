import { describe, expect, it } from "vitest";
import {
  buildMethodPhaseRoadmap,
  getMethodPhasePresentation,
  methodPhasePosition,
} from "@/lib/learning/method-phase-presentation";

describe("method phase presentation", () => {
  it("turns worked-example fading into a visible support progression", () => {
    const roadmap = buildMethodPhaseRoadmap([
      "model",
      "guided_practice",
      "independent_practice",
    ]);

    expect(roadmap.map((phase) => [phase.label, phase.supportLabel])).toEqual([
      ["See a complete model", "Full support"],
      ["Practice with less help", "Support reduced"],
      ["Perform independently", "Support hidden"],
    ]);
  });

  it("collapses consecutive questions that perform the same phase", () => {
    expect(buildMethodPhaseRoadmap([
      "retrieve",
      "retrieve",
      "repair",
      "transfer",
    ]).map((phase) => phase.phase)).toEqual([
      "retrieve",
      "repair",
      "transfer",
    ]);
  });

  it("reports the current visible phase position", () => {
    expect(methodPhasePosition([
      "retrieve",
      "retrieve",
      "repair",
      "transfer",
    ], 2)).toEqual({ current: 2, total: 3 });
  });

  it("explains the learner action rather than exposing internal terminology", () => {
    expect(getMethodPhasePresentation("discriminate")).toMatchObject({
      label: "Choose the approach",
      supportLabel: "Method not named",
    });
  });
});

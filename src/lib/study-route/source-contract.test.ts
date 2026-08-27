import { describe, expect, it } from "vitest";
import type { StudyRoute } from "@/lib/study-route/schema";
import { studyRouteSourceBindingIssue } from "@/lib/study-route/source-contract";

function route(sourceType: StudyRoute["target"]["sourceRequirements"]["sourceType"]): StudyRoute {
  return {
    target: {
      sourceRequirements: {
        sourceType,
        requiredSourceIds: sourceType === "yova_generated" ? [] : ["material-a", "material-b"],
      },
    },
  } as unknown as StudyRoute;
}

describe("StudyRoute source binding", () => {
  it("requires the exact ready material set and only chunks from that set", () => {
    expect(studyRouteSourceBindingIssue(route("user_materials"), {
      readyMaterialIds: ["material-b", "material-a"],
      selectedChunkMaterialIds: ["material-a"],
    })).toBeNull();
    expect(studyRouteSourceBindingIssue(route("user_materials"), {
      readyMaterialIds: ["material-a"],
      selectedChunkMaterialIds: ["material-a"],
    })).toContain("ready material set");
    expect(studyRouteSourceBindingIssue(route("user_materials"), {
      readyMaterialIds: ["material-a", "material-b"],
      selectedChunkMaterialIds: [],
    })).toContain("no selected source section");
  });

  it("prevents generated or external routes from silently adopting uploaded chunks", () => {
    expect(studyRouteSourceBindingIssue(route("yova_generated"), {
      readyMaterialIds: [],
      selectedChunkMaterialIds: [],
    })).toBeNull();
    expect(studyRouteSourceBindingIssue(route("yova_generated"), {
      readyMaterialIds: ["material-a"],
      selectedChunkMaterialIds: ["material-a"],
    })).toContain("cannot silently switch");
    expect(studyRouteSourceBindingIssue(route("trusted_external_source"), {
      readyMaterialIds: [],
      selectedChunkMaterialIds: ["material-a"],
    })).toContain("trusted external-source");
  });
});

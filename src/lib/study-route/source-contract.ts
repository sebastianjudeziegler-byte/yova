import type { StudyRoute } from "@/lib/study-route/schema";

export type StudyRouteSourceRuntime = {
  readyMaterialIds: readonly string[];
  selectedChunkMaterialIds: readonly string[];
};

/**
 * Checks that the factual source available at generation is the source set
 * committed in the immutable route. It compares identifiers, never prose.
 */
export function studyRouteSourceBindingIssue(
  route: StudyRoute | null | undefined,
  runtime: StudyRouteSourceRuntime,
): string | null {
  if (!route) return null;
  const source = route.target.sourceRequirements;
  const readyMaterialIds = uniqueSorted(runtime.readyMaterialIds);
  const selectedChunkMaterialIds = uniqueSorted(runtime.selectedChunkMaterialIds);

  if (source.sourceType === "user_materials") {
    const requiredSourceIds = uniqueSorted(source.requiredSourceIds);
    if (!sameStrings(requiredSourceIds, readyMaterialIds)) {
      return "The ready material set no longer matches the source set committed in this StudyRoute.";
    }
    if (selectedChunkMaterialIds.length === 0) {
      return "This material-grounded StudyRoute has no selected source section for its active targets.";
    }
    if (selectedChunkMaterialIds.some((materialId) => !requiredSourceIds.includes(materialId))) {
      return "A selected source section belongs to material outside this StudyRoute.";
    }
    return null;
  }

  if (selectedChunkMaterialIds.length > 0) {
    return source.sourceType === "trusted_external_source"
      ? "A trusted external-source route cannot silently switch to uploaded material."
      : "A YOVA-generated route cannot silently switch to uploaded material.";
  }
  return null;
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

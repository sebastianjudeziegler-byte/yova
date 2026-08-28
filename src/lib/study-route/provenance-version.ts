import { StudyRouteProvenanceSchema } from "@/lib/study-route/schema";

/**
 * One route can use independently versioned method, duration, and delivery
 * contexts. Preserve every non-legacy component so integrating a later
 * deterministic decision never erases the provenance of an earlier one.
 */
export function composeStudyRouteProfileVersion(...values: readonly string[]) {
  const components = [...new Set(values.flatMap((value) => (
    value.split("+").map((component) => component.trim())
  )).filter((component) => component && component !== "legacy_unknown"))];
  if (components.length === 0) {
    throw new Error("A canonical StudyRoute decision needs non-legacy profile provenance.");
  }
  return StudyRouteProvenanceSchema.shape.profileVersion.parse(components.join("+"));
}

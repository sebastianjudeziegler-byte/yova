import { CANONICAL_METHOD_SELECTION_POLICY_VERSION, type CanonicalMethodSelectionResult } from "@/lib/learning/canonical-method-selection";
import { CORE_METHOD_CATALOG, type CoreMethodId } from "@/lib/learning/method-catalog";
import type { GenerationPersonalizationContext } from "@/lib/personalization/personalization-generation";

type Profile = NonNullable<GenerationPersonalizationContext["canonicalProfile"]>;

/** Initial drafts only: rank task-valid recipes from authorized saved signals. */
export function initialPlanProfileMethod(selection: CanonicalMethodSelectionResult, profile: { signals: readonly Readonly<Profile["signals"][number]>[] } | undefined, hasExplicitPreference: boolean): CanonicalMethodSelectionResult {
  if (!profile || hasExplicitPreference || !["task_baseline", "authorized_declaration"].includes(selection.authority)) return selection;
  const signals = new Map(profile.signals.map(signal => [signal.signalId, signal]));
  const entry = signals.get("unfamiliar_entry");
  const repair = signals.get("first_repair");
  const pacing = signals.get("focus_pacing");
  const successful = signals.get("successful_approach");
  const signal = entry?.value === "concrete_example" ? entry
    : successful?.value === "explain_from_memory" ? successful
      : repair?.value === "hint_first" ? repair
        : pacing && ["shorter_blocks", "short_blocks_with_changes"].includes(pacing.value) ? pacing : null;
  if (!signal) return selection;
  let candidates: readonly CoreMethodId[];
  if (selection.taskType === "problem_solving") candidates = selection.learningMode === "learn" ? ["worked_example_fading"] : ["practice_problems", "interleaved_practice"];
  else if (selection.taskType === "writing_argumentation") candidates = ["retrieval_based_outlining"];
  else if (selection.taskType === "reading_to_quiz") candidates = selection.learningMode === "learn" ? ["read_recall_review"] : ["retrieval_practice", "concept_mapping"];
  else if (signal.signalId === "focus_pacing") candidates = ["read_recall_review", "retrieval_practice", "spaced_retrieval"];
  else if (signal.value === "explain_from_memory") candidates = ["self_explanation", "concept_mapping", "spaced_retrieval"];
  else candidates = ["concept_mapping", "worked_example_fading", "retrieval_practice"];
  const methodId = candidates.find(id => selection.eligibleMethodIds.includes(id));
  if (!methodId) return selection;
  const evidenceRefs = [`canonical-profile:${signal.signalId}:${signal.sourceQuestionId}`];
  const reason = `Your saved ${signal.signalId.replaceAll("_", " ")} preference selects ${CORE_METHOD_CATALOG[methodId].name} within the methods suited to this task.`;
  return {
    ...selection, selectedMethodId: methodId, selectedMethodName: CORE_METHOD_CATALOG[methodId].name,
    authority: "authorized_declaration", changedFromBaseline: methodId !== selection.baselineMethodId,
    orderedMethodIds: [methodId, ...selection.eligibleMethodIds.filter(id => id !== methodId)],
    evidenceRefs, learnerFacingReason: reason,
    ruleTrace: selection.ruleTrace.map(trace => trace.ruleId === CANONICAL_METHOD_SELECTION_POLICY_VERSION ? { ...trace, result: `authorized_declaration:${methodId}`, reason, evidenceRefs } : trace),
  };
}

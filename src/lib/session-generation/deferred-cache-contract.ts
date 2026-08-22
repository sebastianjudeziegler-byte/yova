import type { GeneratedSessionDraft } from "@/lib/session-generation/schema";

/**
 * Browser-only persistence is never sufficient when a generated lesson has
 * split the stored curriculum. Completion needs the database copy of the exact
 * deferred labels so the continuation RPC can authenticate what remains.
 */
export function generatedSessionDefersStoredPlanTargets(
  session: Pick<GeneratedSessionDraft, "coverage">,
  storedTargets: string[],
) {
  const stored = new Set(storedTargets.map(normalizeTarget));
  return session.coverage.deferredContent.some((target) => stored.has(normalizeTarget(target)));
}

function normalizeTarget(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

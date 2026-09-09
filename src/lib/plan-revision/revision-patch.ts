import type { LearningPlan, LearningPlanSession } from "@/lib/domain";
import type { PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

export class RevisionConflict extends Error {
  constructor(readonly code: "stale_plan" | "stale_session" | "saved_work" | "stale_map", message: string) {
    super(message);
    this.name = "RevisionConflict";
  }
}

export type SessionRevisionPatch = Readonly<{
  id: string;
  before: LearningPlanSession | null;
  after: LearningPlanSession | null;
}>;

const pendingProjection = (session: LearningPlanSession | null) => session && ["ready", "upcoming"].includes(session.status) ? { ...session, status: "unstarted" } : session;
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}

export function sessionRevisionPatches(before: LearningPlan, after: LearningPlan): SessionRevisionPatch[] {
  const previous = new Map(before.sessions.map(session => [session.id, session]));
  const next = new Map(after.sessions.map(session => [session.id, session]));
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(id => {
    const left = previous.get(id) ?? null;
    const right = next.get(id) ?? null;
    return same(left, right) ? [] : [{ id, before: left, after: right }];
  });
}

/** Apply a signed server proposal to the current browser projection. The SQL
 * writer independently checks the same preimages under the user data lock.
 * Unchanged sessions are copied from CURRENT, preserving later saved work. */
export function applySessionRevisionPatches({ current, patches, protectedSessionIds }: {
  current: readonly LearningPlanSession[];
  patches: readonly SessionRevisionPatch[];
  protectedSessionIds: ReadonlySet<string>;
}): LearningPlanSession[] {
  const byId = new Map(current.map(session => [session.id, session]));
  const patchIds = new Set<string>();
  for (const patch of patches) {
    if (patchIds.has(patch.id)) throw new RevisionConflict("stale_session", "The preview contains a repeated session. Reload it before applying.");
    patchIds.add(patch.id);
    const existing = byId.get(patch.id) ?? null;
    if (existing && (protectedSessionIds.has(patch.id) || existing.status === "complete" || existing.resource)) {
      throw new RevisionConflict("saved_work", "A changed session now has saved work. Review a new preview; that work has been kept.");
    }
    if (!same(pendingProjection(existing), pendingProjection(patch.before))) {
      throw new RevisionConflict("stale_session", "A changed session no longer matches this preview. Review its latest version.");
    }
  }
  for (const patch of patches) {
    if (patch.after) {
      const existing = byId.get(patch.id);
      byId.set(patch.id, { ...structuredClone(patch.after), ...(existing && ["ready", "upcoming"].includes(existing.status) && ["ready", "upcoming"].includes(patch.after.status) ? { status: existing.status } : {}) });
    }
    else byId.delete(patch.id);
  }
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Only fields that the authorized proposal actually changes are restored.
 * A later unrelated completion's measured topic status is never rolled back. */
export function mergeRevisionMapChanges({ before, after, current, undoAddedTopics = false }: {
  before: PlanKnowledgeMap;
  after: PlanKnowledgeMap;
  current: PlanKnowledgeMap;
  undoAddedTopics?: boolean;
}): PlanKnowledgeMap {
  const result = structuredClone(current);
  const oldTopics = new Map(before.topics.map(topic => [topic.id, topic]));
  const currentTopics = new Map(result.topics.map(topic => [topic.id, topic]));
  const nextIds = new Set(after.topics.map(topic => topic.id));
  if (!undoAddedTopics && before.topics.some(topic => !nextIds.has(topic.id))) {
    throw new RevisionConflict("stale_map", "A revision must keep removed topics as history, not erase them.");
  }
  for (const removed of before.topics.filter(topic => !nextIds.has(topic.id))) {
    if (!same(removed, currentTopics.get(removed.id))) throw new RevisionConflict("stale_map", "The added topic now has newer information. Undo has kept it.");
  }
  for (const next of after.topics) {
    const old = oldTopics.get(next.id);
    const existing = currentTopics.get(next.id);
    if (!old) {
      if (existing) throw new RevisionConflict("stale_map", "The new topic is already present. Reload the latest map.");
      currentTopics.set(next.id, structuredClone(next));
      continue;
    }
    if (!existing) throw new RevisionConflict("stale_map", "A topic in the preview is no longer present. Reload the latest map.");
    const oldFields = old as unknown as Record<string, unknown>;
    const nextFields = next as unknown as Record<string, unknown>;
    const fields = existing as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(oldFields), ...Object.keys(nextFields)])) {
      if (same(oldFields[key], nextFields[key])) continue;
      if (!same(fields[key], oldFields[key])) throw new RevisionConflict("stale_map", "This topic changed after the preview. Its newer information has been kept.");
      if (nextFields[key] === undefined) delete fields[key];
      else fields[key] = structuredClone(nextFields[key]);
    }
  }
  if (!same(before.topics.map(topic => topic.id), current.topics.map(topic => topic.id))) {
    throw new RevisionConflict("stale_map", "The topic order changed after the preview. Reload the current map.");
  }
  result.topics = after.topics.map(topic => currentTopics.get(topic.id)!);
  for (const key of ["scopeJudgment", "placementCheck", "curriculum"] as const) {
    const oldFields = before as unknown as Record<string, unknown>;
    const nextFields = after as unknown as Record<string, unknown>;
    const fields = result as unknown as Record<string, unknown>;
    if (same(oldFields[key], nextFields[key])) continue;
    if (!same(fields[key], oldFields[key])) throw new RevisionConflict("stale_map", "The plan map changed after the preview. Review the latest version.");
    if (nextFields[key] === undefined) delete fields[key];
    else fields[key] = structuredClone(nextFields[key]);
  }
  return result;
}

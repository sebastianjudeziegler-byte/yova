import type { KeyPoint } from "@/lib/practice/compose-practice";
import type { ProduceStep, SessionRoute } from "@/lib/routing/session-route";
import type { SessionTip, TipStep } from "@/lib/session-shapes/session-tips";
import type { ShapeAState } from "@/lib/session-shapes/shape-a";
import type { ShapeCState } from "@/lib/session-shapes/shape-c";
import type { DirectionResponse, LearnBlockResponse } from "@/lib/session-shapes/slots-schema";

/**
 * Where a baseline session is, so a learner who leaves mid-session comes
 * straight back to the same step with no setup (Brief 1.5 item 8). Kept in
 * this browser's storage per account; a finished session clears it. Filled
 * slots are kept too, so returning never pays for the same generation twice.
 */
export type StudyLocation = "inside" | "outside";

export type BaselineCheckpoint = {
  version: 1;
  planId: string;
  planSessionId: string;
  produceStep: ProduceStep | null;
  studyLocation: StudyLocation;
  /** The route's shape and step plan when saved; a changed route discards the checkpoint. */
  routeFingerprint: string;
  savedAt: string;
  elapsedSeconds: number;
  started: boolean;
  aState: ShapeAState;
  cState: ShapeCState;
  direction: DirectionResponse | null;
  learnBlock: LearnBlockResponse | null;
  practiceKeyPoints: KeyPoint[];
  tips: Partial<Record<TipStep, SessionTip>>;
};

export type CheckpointStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const keyFor = (accountId: string) => `yova.baseline-sessions.v1:${accountId}`;

export function routeFingerprint(route: SessionRoute) {
  return JSON.stringify([route.shape, route.learnPath, route.produceStep, route.produceBeforeStudy, route.workedStructureBeforeProduce, route.briefStudyStep, route.entry]);
}

function readAll(storage: CheckpointStorage, accountId: string): Record<string, BaselineCheckpoint> {
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(accountId)) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, BaselineCheckpoint> : {};
  } catch {
    return {};
  }
}

function writeAll(storage: CheckpointStorage, accountId: string, all: Record<string, BaselineCheckpoint>) {
  try {
    if (Object.keys(all).length) storage.setItem(keyFor(accountId), JSON.stringify(all));
    else storage.removeItem(keyFor(accountId));
  } catch {
    // Storage can be full or blocked; the session still runs, it just cannot resume.
  }
}

export function saveBaselineCheckpoint(storage: CheckpointStorage, accountId: string, checkpoint: BaselineCheckpoint) {
  writeAll(storage, accountId, { ...readAll(storage, accountId), [checkpoint.planSessionId]: checkpoint });
}

export function loadBaselineCheckpoint(storage: CheckpointStorage, accountId: string, planSessionId: string, fingerprint?: string): BaselineCheckpoint | null {
  const checkpoint = readAll(storage, accountId)[planSessionId];
  if (!checkpoint || checkpoint.version !== 1 || checkpoint.planSessionId !== planSessionId || !checkpoint.aState || !checkpoint.cState) return null;
  if (fingerprint !== undefined && checkpoint.routeFingerprint !== fingerprint) return null;
  return checkpoint;
}

export function clearBaselineCheckpoint(storage: CheckpointStorage, accountId: string, planSessionId: string) {
  const all = readAll(storage, accountId);
  if (!(planSessionId in all)) return;
  delete all[planSessionId];
  writeAll(storage, accountId, all);
}

/** window.localStorage, or null where it is unavailable. */
export function browserCheckpointStorage(): CheckpointStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

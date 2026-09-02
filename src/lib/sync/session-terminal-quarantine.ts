"use client";

export type SessionTerminalKind = "completion" | "interruption";

export type SessionTerminalQuarantineReason =
  | "authoritative_completion"
  | "target_absent"
  | "target_complete"
  | "target_skipped"
  | "authoritative_route_mismatch"
  | "legacy_invalid_progress"
  | "permanent_server_rejection";

export type NonRetryableSessionTarget = Readonly<{
  planSessionId: string;
  reason: Extract<
    SessionTerminalQuarantineReason,
    | "target_absent"
    | "target_complete"
    | "target_skipped"
    | "authoritative_route_mismatch"
  >;
  eventId?: string;
}>;

type QuarantinedSessionTerminal = Readonly<{
  version: 1;
  kind: SessionTerminalKind;
  eventId: string;
  planId: string;
  planSessionId: string;
  reason: SessionTerminalQuarantineReason;
  quarantinedAt: string;
  payload: unknown;
}>;

const STORAGE_KEY_PREFIX = "yova.session-terminal-quarantine.v1";

function storageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

/**
 * Preserves a terminal payload that can no longer be applied to authoritative
 * cloud state. Saving the recovery copy always happens before callers remove
 * the active retry marker, so a storage failure cannot discard learner work.
 */
export function quarantineSessionTerminal({
  userId,
  kind,
  eventId,
  planId,
  planSessionId,
  reason,
  payload,
}: {
  userId: string;
  kind: SessionTerminalKind;
  eventId: string;
  planId: string;
  planSessionId: string;
  reason: SessionTerminalQuarantineReason;
  payload: unknown;
}) {
  const current = loadQuarantinedSessionTerminals(userId);
  const existing = current.find((entry) => (
    entry.kind === kind && entry.eventId === eventId
  ));
  if (existing) return true;

  return saveQuarantinedSessionTerminals(userId, [
    ...current,
    {
      version: 1,
      kind,
      eventId,
      planId,
      planSessionId,
      reason,
      quarantinedAt: new Date().toISOString(),
      payload,
    },
  ]);
}

export function readQuarantinedSessionTerminalPayloads(
  userId: string,
  kind: SessionTerminalKind,
) {
  return loadQuarantinedSessionTerminals(userId)
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.payload);
}

export function clearQuarantinedSessionTerminals(
  userId: string,
  kind: SessionTerminalKind,
) {
  return saveQuarantinedSessionTerminals(
    userId,
    loadQuarantinedSessionTerminals(userId).filter((entry) => entry.kind !== kind),
  );
}

export function removeQuarantinedSessionTerminalsForPlan(
  userId: string,
  kind: SessionTerminalKind,
  planId: string,
) {
  return saveQuarantinedSessionTerminals(
    userId,
    loadQuarantinedSessionTerminals(userId).filter((entry) => !(
      entry.kind === kind && entry.planId === planId
    )),
  );
}

function loadQuarantinedSessionTerminals(userId: string): QuarantinedSessionTerminal[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => isQuarantinedSessionTerminal(entry) ? [entry] : []);
  } catch {
    return [];
  }
}

function saveQuarantinedSessionTerminals(
  userId: string,
  entries: readonly QuarantinedSessionTerminal[],
) {
  if (typeof window === "undefined") return false;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(storageKey(userId));
      return true;
    }
    window.localStorage.setItem(storageKey(userId), JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

function isQuarantinedSessionTerminal(value: unknown): value is QuarantinedSessionTerminal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<QuarantinedSessionTerminal>;
  return candidate.version === 1
    && (candidate.kind === "completion" || candidate.kind === "interruption")
    && typeof candidate.eventId === "string"
    && typeof candidate.planId === "string"
    && typeof candidate.planSessionId === "string"
    && (
      candidate.reason === "authoritative_completion"
      || candidate.reason === "target_absent"
      || candidate.reason === "target_complete"
      || candidate.reason === "target_skipped"
      || candidate.reason === "authoritative_route_mismatch"
      || candidate.reason === "legacy_invalid_progress"
      || candidate.reason === "permanent_server_rejection"
    )
    && typeof candidate.quarantinedAt === "string"
    && Object.hasOwn(candidate, "payload");
}

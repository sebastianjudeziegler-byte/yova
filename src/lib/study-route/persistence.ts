import { StudyRouteSchema, type StudyRoute } from "@/lib/study-route/schema";

export type PersistedStudyRouteRow = {
  route_revision_id: string;
  route_lineage_id: string;
  revision_number: number;
  schema_version: number;
  lifecycle: string;
  plan_id: string;
  plan_session_id: string;
  predecessor_revision_id: string | null;
  route_payload: unknown;
  created_at: string;
  committed_at: string | null;
};

/**
 * Rebuilds the canonical envelope stored across the immutable route columns
 * and semantic JSON payload. Invalid rows never become a runtime authority.
 */
export function studyRouteFromPersistenceRow(
  row: PersistedStudyRouteRow,
): StudyRoute | null {
  if (!row.route_payload || typeof row.route_payload !== "object" || Array.isArray(row.route_payload)) {
    return null;
  }

  const parsed = StudyRouteSchema.safeParse({
    ...(row.route_payload as Record<string, unknown>),
    identity: {
      routeLineageId: row.route_lineage_id,
      routeRevisionId: row.route_revision_id,
      revisionNumber: row.revision_number,
      schemaVersion: row.schema_version,
      lifecycleStatus: row.lifecycle,
      planId: row.plan_id,
      sessionId: row.plan_session_id,
      createdAt: normalizeDatabaseTimestamp(row.created_at),
      ...(row.committed_at
        ? { committedAt: normalizeDatabaseTimestamp(row.committed_at) }
        : {}),
      ...(row.predecessor_revision_id
        ? { supersedesRevisionId: row.predecessor_revision_id }
        : {}),
    },
  });

  return parsed.success ? parsed.data : null;
}

function normalizeDatabaseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

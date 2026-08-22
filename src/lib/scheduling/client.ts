import {
  ReschedulePlanSessionsResponseSchema,
  type ReschedulePlanSessionsResponse,
  type ScheduleOperationKind,
  type ScheduleSessionUpdate,
} from "@/lib/scheduling/schema";

type PersistPlanScheduleOptions = {
  operationKind?: ScheduleOperationKind;
  request?: typeof fetch;
};

export async function persistPlanSchedule(
  planId: string,
  updates: ScheduleSessionUpdate[],
  options: PersistPlanScheduleOptions = {},
): Promise<ReschedulePlanSessionsResponse> {
  const operationKind = options.operationKind ?? "manual";
  const request = options.request ?? fetch;
  const normalizedPlanId = planId.toLowerCase();
  const normalizedUpdates = updates.map((update) => ({
    ...update,
    planSessionId: update.planSessionId.toLowerCase(),
  }));
  const response = await request("/api/sessions/schedule", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: normalizedPlanId,
      operationKind,
      updates: normalizedUpdates,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readApiError(body) ?? "YOVA could not move that learning schedule.");
  }

  const parsed = ReschedulePlanSessionsResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.planId !== normalizedPlanId) {
    throw new Error("YOVA changed the agenda but could not safely confirm it. Reload before making another change.");
  }
  const authoritativeIds = new Set(parsed.data.sessions.map((session) => session.planSessionId));
  if (normalizedUpdates.some((update) => !authoritativeIds.has(update.planSessionId))) {
    throw new Error("YOVA changed the agenda but could not safely confirm every session. Reload before making another change.");
  }
  return parsed.data;
}

function readApiError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

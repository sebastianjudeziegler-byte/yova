"use client";

import {
  PLAN_DELETION_CONFIRMATION,
  PLAN_DELETION_HEADER,
  PLAN_DELETION_HEADER_VALUE,
  PlanDeletionErrorResponseSchema,
} from "@/lib/learning/status-schema";

export async function deleteArchivedPlan(
  planId: string,
  options: { signal?: AbortSignal } = {},
) {
  const response = await fetch("/api/plans/status", {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      [PLAN_DELETION_HEADER]: PLAN_DELETION_HEADER_VALUE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      planId,
      confirmation: PLAN_DELETION_CONFIRMATION,
    }),
    signal: options.signal,
  });
  if (response.status === 204) return;

  const body: unknown = await response.json().catch(() => null);
  const parsed = PlanDeletionErrorResponseSchema.safeParse(body);
  throw new Error(parsed.success
    ? parsed.data.error
    : "YOVA could not permanently delete that archived goal. Nothing was changed. Try again.");
}

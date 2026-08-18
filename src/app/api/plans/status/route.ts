import { NextResponse } from "next/server";
import {
  PLAN_DELETION_HEADER,
  PLAN_DELETION_HEADER_VALUE,
  PlanArchiveRequestSchema,
  PlanArchiveResponseSchema,
  PlanDeletionRequestSchema,
  PlanDeletionRpcResultSchema,
} from "@/lib/learning/status-schema";
import { cleanupDeletedAccountStorage } from "@/lib/account-deletion/cleanup";
import { isAccountExportCleanupConfigured } from "@/lib/account-export/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
const MAXIMUM_BODY_BYTES = 1_024;

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before changing a learning goal." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The learning-goal change was not valid JSON." }, { status: 400 });
  }

  const parsed = PlanArchiveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid learning goal and action." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("set_learning_plan_archive_state", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not update that learning goal." }, { status: 409 });
  }

  const response = PlanArchiveResponseSchema.safeParse({
    planId: readTextProperty(data, "planId"),
    status: readTextProperty(data, "status"),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "YOVA updated the goal but could not confirm its new state." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const requestIssue = validateDeletionRequest(request);
  if (requestIssue) return requestIssue;
  if (!isAccountExportCleanupConfigured()) {
    return deletionError("Permanent plan deletion is not configured on this YOVA environment.", 503);
  }

  const body = await readBoundedJson(request, MAXIMUM_BODY_BYTES);
  const parsed = PlanDeletionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return deletionError("Confirm permanent deletion from the archived goal inside YOVA.", 422);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return deletionError("Sign in before permanently deleting an archived goal.", 401);
  }

  const { data, error } = await supabase.rpc("delete_archived_learning_plan", {
    payload: { planId: parsed.data.planId },
  });
  if (error) {
    if (error.code === "54000" || error.message?.includes("plan_deletion_cleanup_limit_exceeded")) {
      return deletionError(
        "This goal has more private files than YOVA can safely remove here. Nothing was changed. Contact YOVA Support.",
        409,
      );
    }
    return deletionError(
      "YOVA could not permanently delete that archived goal. Nothing was changed. Restore it or try again.",
      409,
    );
  }

  // The database deletion is already committed. Storage cleanup is deliberately
  // best effort here because the durable receipt lets the scheduled worker retry.
  const deletion = PlanDeletionRpcResultSchema.safeParse(data);
  if (deletion.success && deletion.data.deletedPlanId === parsed.data.planId) {
    try {
      await cleanupDeletedAccountStorage(createSupabaseAdminClient(), { limit: 100 });
    } catch {
      // The durable receipt remains eligible for the scheduled cleanup worker.
    }
  }
  return new NextResponse(null, { status: 204, headers: privateHeaders() });
}

function readTextProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : "";
}

function validateDeletionRequest(request: Request) {
  if (request.headers.get(PLAN_DELETION_HEADER.toLowerCase()) !== PLAN_DELETION_HEADER_VALUE) {
    return deletionError("Start permanent deletion from the archived goal inside YOVA.", 400);
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return deletionError("YOVA blocked a cross-site plan-deletion request.", 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") {
    return deletionError("YOVA blocked a cross-site plan-deletion request.", 403);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return deletionError("The plan-deletion request must use JSON.", 415);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = /^\d+$/.test(contentLength) ? Number(contentLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAXIMUM_BODY_BYTES) {
      return deletionError("The plan-deletion request body is too large.", 413);
    }
  }
  return null;
}

async function readBoundedJson(request: Request, maximumBytes: number) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function deletionError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

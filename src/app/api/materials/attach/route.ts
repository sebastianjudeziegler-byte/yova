import { NextResponse } from "next/server";
import {
  MaterialUnderstandingSchema,
  PlanKnowledgeMapSchema,
  type MaterialUnderstanding,
  type PlanKnowledgeMap,
} from "@/lib/knowledge-map/schema";
import {
  MaterialAttachmentRequestSchema,
  MaterialAttachmentResponseSchema,
} from "@/lib/materials/attachment-schema";
import {
  MaterialPlanRebuildRequiredError,
  reconcileMappedMaterialsIntoActivePlan,
} from "@/lib/materials/active-plan-attachment";
import {
  MATERIAL_MAPPING_ROUTE_BUDGET_MS,
  mapAndPersistMaterial,
} from "@/lib/materials/material-understanding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

type MaterialRow = {
  id: string;
  learning_item_id?: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  processing_status: string;
  extracted_text: string | null;
  metadata: unknown;
};

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const mappingDeadlineAt = Date.now() + MATERIAL_MAPPING_ROUTE_BUDGET_MS;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before attaching learning materials." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The material attachment was not valid JSON." }, { status: 400 });
  }

  const parsed = MaterialAttachmentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose between one and five valid materials." }, { status: 422 });
  }

  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("id,learning_item_id,status,knowledge_map")
    .eq("id", parsed.data.planId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError) return attachmentError("YOVA could not load that plan.", requestId, 500);
  if (!plan || plan.status !== "active") {
    return attachmentError("Materials can only be added to an active plan.", requestId, 409);
  }

  const knowledgeMap = PlanKnowledgeMapSchema.safeParse(plan.knowledge_map);
  if (!knowledgeMap.success) {
    return attachmentError("This plan needs its topic map rebuilt before a source can be attached.", requestId, 409, "material_plan_rebuild_required");
  }

  const { data: sessionRows, error: sessionError } = await supabase
    .from("plan_sessions")
    .select("id,status,step_data")
    .eq("plan_id", plan.id)
    .eq("user_id", user.id);
  if (sessionError) return attachmentError("YOVA could not load the plan's remaining sessions.", requestId, 500);
  const unfinished = (sessionRows ?? []).filter((session) => session.status === "ready" || session.status === "upcoming");
  if (unfinished.some((session) => hasSavedSessionWork(session.step_data))) {
    return attachmentError(
      "This plan has a prepared or saved lesson. Finish that work before changing its source.",
      requestId,
      409,
      "material_attachment_saved_work_protected",
    );
  }
  const unfinishedTopicIds = [...new Set(unfinished.flatMap((session) => readTopicIds(session.step_data)))];
  if (unfinishedTopicIds.length === 0) {
    return attachmentError("This plan has no unfinished topic scope to attach the source to.", requestId, 409, "material_plan_rebuild_required");
  }

  let selectedRows = await loadSelectedMaterialRows(supabase, parsed.data.materialIds, plan.learning_item_id);
  if (!selectedRows.ok) return attachmentError(selectedRows.error, requestId, selectedRows.status, selectedRows.code);

  try {
    for (const selected of selectedRows.rows) {
      if (readUnderstanding(selected.row.metadata)) continue;
      if (selected.row.processing_status !== "ready" || !selected.row.extracted_text?.trim()) {
        return attachmentError(
          "YOVA is still mapping one of these materials. Wait for it to be Ready before attaching it.",
          requestId,
          409,
          "material_mapping_incomplete",
        );
      }
      await mapAndPersistMaterial({
        supabase,
        materialId: selected.row.id,
        filename: selected.row.filename,
        text: selected.row.extracted_text,
        table: selected.table,
        deadlineAt: mappingDeadlineAt,
      });
    }
  } catch {
    return attachmentError(
      "YOVA could not finish mapping this source, so nothing was attached. Try processing the material again.",
      requestId,
      503,
      "material_mapping_incomplete",
    );
  }

  // Reload after a synchronous mapping repair. The map/chunks transaction is
  // authoritative; stale pre-repair metadata must never be used for attach.
  selectedRows = await loadSelectedMaterialRows(supabase, parsed.data.materialIds, plan.learning_item_id);
  if (!selectedRows.ok) return attachmentError(selectedRows.error, requestId, selectedRows.status, selectedRows.code);
  const understandings = selectedRows.rows.flatMap<MaterialUnderstanding>((selected) => {
    const understanding = readUnderstanding(selected.row.metadata);
    return understanding ? [understanding] : [];
  });
  if (understandings.length !== parsed.data.materialIds.length) {
    return attachmentError(
      "One of these materials is not durably mapped yet, so nothing was attached.",
      requestId,
      409,
      "material_mapping_incomplete",
    );
  }

  let reconciledMap: PlanKnowledgeMap;
  try {
    reconciledMap = reconcileMappedMaterialsIntoActivePlan({
      knowledgeMap: knowledgeMap.data,
      understandings,
      unfinishedTopicIds,
    });
  } catch (error) {
    if (error instanceof MaterialPlanRebuildRequiredError) {
      return attachmentError(error.message, requestId, 409, "material_plan_rebuild_required");
    }
    return attachmentError("YOVA could not safely reconcile this source with the plan.", requestId, 500);
  }

  const expectedReceipt = await buildExpectedReceipt({
    supabase,
    learningItemId: plan.learning_item_id,
    selectedRows: selectedRows.rows.map((selected) => selected.row),
    planId: plan.id,
    knowledgeMap: reconciledMap,
  });
  if (!expectedReceipt.ok) {
    return attachmentError(expectedReceipt.error, requestId, expectedReceipt.status);
  }

  let data: unknown = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase.rpc("attach_materials_to_plan", {
      payload: {
        ...parsed.data,
        knowledgeMap: reconciledMap,
      },
    }));
  } catch {
    const confirmed = await readCommittedAttachment({
      supabase,
      planId: plan.id,
      learningItemId: plan.learning_item_id,
      materialIds: parsed.data.materialIds,
      knowledgeMap: reconciledMap,
    });
    if (confirmed) return jsonReceipt(confirmed, requestId);

    // A transport exception has no commit semantics. Conservatively keep the
    // staged source and tell the browser not to clean it up or invite a second
    // upload; the idempotent route can be retried after reloading the goal.
    return NextResponse.json({
      error: `YOVA could not confirm whether the materials attached. Do not add them again yet. Reload this goal, then contact YOVA Support with reference ${requestId} if they are still missing.`,
      code: "material_attachment_outcome_unconfirmed",
      committed: true,
      requestId,
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }
  if (error) {
    const confirmed = await readCommittedAttachment({
      supabase,
      planId: plan.id,
      learningItemId: plan.learning_item_id,
      materialIds: parsed.data.materialIds,
      knowledgeMap: reconciledMap,
    });
    if (confirmed) return jsonReceipt(confirmed, requestId);
    const issue = attachmentRpcIssue(readErrorMessage(error));
    return attachmentError(issue.message, requestId, issue.status, issue.code);
  }

  const rpcReceipt = MaterialAttachmentResponseSchema.safeParse({
    ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
    persistence: "supabase",
  });
  if (rpcReceipt.success && sameMap(rpcReceipt.data.knowledgeMap, reconciledMap)) {
    return jsonReceipt(rpcReceipt.data, requestId);
  }

  // The transaction may have committed even if its wire response was lost or
  // malformed. Read the authoritative rows before reporting an error; a retry
  // must never duplicate an attachment or tell the learner it was not saved.
  const confirmed = await readCommittedAttachment({
    supabase,
    planId: plan.id,
    learningItemId: plan.learning_item_id,
    materialIds: parsed.data.materialIds,
    knowledgeMap: reconciledMap,
  });
  if (confirmed) return jsonReceipt(confirmed, requestId);

  if (!rpcReceipt.success || !sameMap(rpcReceipt.data.knowledgeMap, reconciledMap)) {
    return NextResponse.json({
      error: `The materials were attached, but YOVA could not confirm the reconciled topic map. Do not add them again. Contact YOVA Support with reference ${requestId}.`,
      code: "material_attachment_committed_response_invalid",
      committed: true,
      requestId,
    }, {
      status: 500,
      headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
    });
  }

  return jsonReceipt(rpcReceipt.data, requestId);
}

async function loadSelectedMaterialRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  materialIds: string[],
  learningItemId: string,
): Promise<
  | { ok: true; rows: Array<{ table: "material_uploads" | "materials"; row: MaterialRow }> }
  | { ok: false; error: string; status: number; code?: string }
> {
  const [{ data: staged, error: stagedError }, { data: attached, error: attachedError }] = await Promise.all([
    supabase
      .from("material_uploads")
      .select("id,filename,mime_type,byte_size,processing_status,extracted_text,metadata")
      .in("id", materialIds),
    supabase
      .from("materials")
      .select("id,learning_item_id,filename,mime_type,byte_size,processing_status,extracted_text,metadata")
      .in("id", materialIds),
  ]);
  if (stagedError || attachedError) {
    return { ok: false, error: "YOVA could not verify these mapped materials.", status: 500 };
  }
  const stagedById = new Map(((staged ?? []) as MaterialRow[]).map((row) => [row.id, row]));
  const attachedById = new Map(((attached ?? []) as MaterialRow[]).map((row) => [row.id, row]));
  const rows: Array<{ table: "material_uploads" | "materials"; row: MaterialRow }> = [];
  for (const id of materialIds) {
    const durable = attachedById.get(id);
    if (durable?.learning_item_id === learningItemId) {
      rows.push({ table: "materials", row: durable });
      continue;
    }
    const pending = stagedById.get(id);
    if (pending) rows.push({ table: "material_uploads", row: pending });
  }
  if (rows.length !== materialIds.length) {
    return {
      ok: false,
      error: "A requested material is missing, belongs to another goal, or is not ready.",
      status: 409,
      code: "material_attachment_source_missing",
    };
  }
  return { ok: true, rows };
}

async function buildExpectedReceipt({
  supabase,
  learningItemId,
  selectedRows,
  planId,
  knowledgeMap,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  learningItemId: string;
  selectedRows: MaterialRow[];
  planId: string;
  knowledgeMap: PlanKnowledgeMap;
}) {
  const { data: existing, error } = await supabase
    .from("materials")
    .select("id,filename,mime_type,byte_size,processing_status")
    .eq("learning_item_id", learningItemId)
    .eq("processing_status", "ready")
    .order("created_at", { ascending: true });
  if (error) {
    return {
      ok: false as const,
      error: "YOVA could not verify the sources already attached to this goal.",
      status: 500,
    };
  }
  const materialById = new Map<string, MaterialRow>();
  for (const row of (existing ?? []) as MaterialRow[]) materialById.set(row.id, row);
  for (const row of selectedRows) materialById.set(row.id, row);
  if (materialById.size < 1 || materialById.size > 5) {
    return {
      ok: false as const,
      error: "Attaching these sources would exceed the five-material limit.",
      status: 409,
    };
  }
  const receipt = MaterialAttachmentResponseSchema.safeParse({
    planId,
    sourceMode: "user_materials",
    materials: [...materialById.values()].map((row) => ({
      id: row.id,
      name: row.filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.byte_size),
      textContent: null,
      processingStatus: "ready",
    })),
    knowledgeMap,
    persistence: "supabase",
  });
  if (!receipt.success) {
    return {
      ok: false as const,
      error: "YOVA could not safely prepare the attachment response, so nothing was changed.",
      status: 500,
    };
  }
  return { ok: true as const, receipt: receipt.data };
}

async function readCommittedAttachment({
  supabase,
  planId,
  learningItemId,
  materialIds,
  knowledgeMap,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  planId: string;
  learningItemId: string;
  materialIds: string[];
  knowledgeMap: PlanKnowledgeMap;
}) {
  const [
    { data: plan, error: planError },
    { data: learningItem, error: learningItemError },
    { data: materials, error: materialsError },
  ] = await Promise.all([
    supabase.from("plans").select("knowledge_map").eq("id", planId).maybeSingle(),
    supabase.from("learning_items").select("source_mode").eq("id", learningItemId).maybeSingle(),
    supabase
      .from("materials")
      .select("id,filename,mime_type,byte_size,processing_status")
      .eq("learning_item_id", learningItemId)
      .eq("processing_status", "ready")
      .order("created_at", { ascending: true }),
  ]);
  if (planError || learningItemError || materialsError) return null;
  const storedMap = PlanKnowledgeMapSchema.safeParse(plan?.knowledge_map);
  const storedIds = new Set((materials ?? []).map((material) => material.id));
  if (!storedMap.success
    || learningItem?.source_mode !== "user_materials"
    || !sameMap(storedMap.data, knowledgeMap)
    || !materialIds.every((id) => storedIds.has(id))) return null;
  const receipt = MaterialAttachmentResponseSchema.safeParse({
    planId,
    sourceMode: "user_materials",
    materials: (materials ?? []).map((row) => ({
      id: row.id,
      name: row.filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.byte_size),
      textContent: null,
      processingStatus: "ready",
    })),
    knowledgeMap: storedMap.data,
    persistence: "supabase",
  });
  return receipt.success ? receipt.data : null;
}

function readUnderstanding(metadata: unknown) {
  const candidate = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).materialUnderstanding
    : null;
  const parsed = MaterialUnderstandingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function readTopicIds(stepData: unknown) {
  const value = readProperty(stepData, "topicIds");
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasSavedSessionWork(stepData: unknown) {
  return Boolean(readProperty(stepData, "generatedSession") || readProperty(stepData, "activeSessionCheckpoint"));
}

function readProperty(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function readErrorMessage(value: unknown) {
  const message = readProperty(value, "message");
  return typeof message === "string" ? message : "";
}

function attachmentRpcIssue(message: string): { message: string; status: number; code?: string } {
  if (message.includes("material_attachment_saved_work_protected")) return {
    message: "This plan gained prepared or saved lesson work before the source could attach. Finish that work first.",
    status: 409,
    code: "material_attachment_saved_work_protected",
  };
  if (message.includes("material_plan_rebuild_required")) return {
    message: "This source changes the plan's topic scope. Create a new plan from it so YOVA can rebuild the remaining sessions safely.",
    status: 409,
    code: "material_plan_rebuild_required",
  };
  if (message.includes("material_mapping_incomplete")) return {
    message: "One of these sources is not durably mapped yet, so nothing was attached.",
    status: 409,
    code: "material_mapping_incomplete",
  };
  if (message.includes("material_attachment_source_missing")) return {
    message: "A requested source is no longer available to attach.",
    status: 409,
    code: "material_attachment_source_missing",
  };
  return {
    message: "YOVA could not attach those materials to the plan. Nothing was changed.",
    status: 409,
  };
}

function sameMap(left: PlanKnowledgeMap, right: PlanKnowledgeMap) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonReceipt(receipt: unknown, requestId: string) {
  return NextResponse.json(receipt, {
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

function attachmentError(message: string, requestId: string, status: number, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}), requestId }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Yova-Request-Id": requestId },
  });
}

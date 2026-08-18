import { NextResponse } from "next/server";
import {
  accountExportFinalPath,
  accountExportTempPath,
} from "@/lib/account-export/server";
import {
  ACCOUNT_EXPORT_BUCKET,
  ResetAccountExportsResultSchema,
} from "@/lib/account-export/schema";
import {
  createSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  if (request.headers.get("x-yova-confirm") !== "reset-learning-data") {
    return NextResponse.json({ error: "Confirm the learning-data reset inside YOVA." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Sign in before resetting cloud learning data." }, { status: 401 });
  }
  const [materialsResult, stagedMaterialsResult] = await Promise.all([
    supabase.from("materials").select("storage_path"),
    supabase.from("material_uploads").select("storage_path"),
  ]);
  if (materialsResult.error || stagedMaterialsResult.error) {
    return NextResponse.json({ error: "YOVA could not safely identify all stored learning materials." }, { status: 500 });
  }

  const storagePaths = [...new Set([
    ...(materialsResult.data ?? []).map((material) => material.storage_path),
    ...(stagedMaterialsResult.data ?? []).map((material) => material.storage_path),
  ].filter((path): path is string => typeof path === "string" && path.startsWith(`${user.id}/`)))];

  for (let index = 0; index < storagePaths.length; index += 100) {
    const { error: storageError } = await supabase.storage.from("learning-materials").remove(storagePaths.slice(index, index + 100));
    if (storageError) {
      return NextResponse.json({ error: "YOVA stopped because it could not remove every private uploaded file." }, { status: 500 });
    }
  }

  const { data: resetData, error: resetError } = await supabase.rpc("reset_yova_learning_data");
  if (resetError) {
    return NextResponse.json({ error: "The files were removed, but YOVA could not finish resetting the learning records. Try again." }, { status: 500 });
  }

  try {
    const resetResult = ResetAccountExportsResultSchema.safeParse(resetData);
    if (!resetResult.success || !resetResult.data.accountExportPaths.every((path) => (
      validAccountExportResetPath(user.id, path)
    ))) {
      // The database reset is already committed. Returning success is essential:
      // the client must clear its local snapshot/outboxes instead of re-syncing
      // deleted learning data. Cancelled export rows retain exact cleanup paths.
      return resetComplete();
    }

    const accountExportPaths = [...new Set(resetResult.data.accountExportPaths)];
    if (accountExportPaths.length > 0 && !isSupabaseAdminConfigured()) {
      return resetComplete();
    }
    const exportStorage = accountExportPaths.length > 0
      ? createSupabaseAdminClient().storage.from(ACCOUNT_EXPORT_BUCKET)
      : null;
    for (let index = 0; index < accountExportPaths.length; index += 1_000) {
      const { error: exportStorageError } = await exportStorage!.remove(
        accountExportPaths.slice(index, index + 1_000),
      );
      if (exportStorageError) return resetComplete();
    }
  } catch {
    // A cancelled row stays eligible for the leased cleanup worker. Never turn
    // a post-commit cleanup exception into a reset failure in the browser.
    return resetComplete();
  }

  return resetComplete();
}

function resetComplete() {
  return new NextResponse(null, { status: 204 });
}

function validAccountExportResetPath(userId: string, path: string) {
  const match = path.match(new RegExp(`^${userId}/([0-9a-f-]{36})/(device-state\\.json|yova-data\\.json)$`, "i"));
  if (!match || !isUuid(match[1])) return false;
  return path === accountExportTempPath(userId, match[1])
    || path === accountExportFinalPath(userId, match[1]);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

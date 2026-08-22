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
  const { data: resetData, error: resetError } = await supabase.rpc("reset_yova_learning_data");
  if (resetError) {
    return NextResponse.json({ error: "YOVA could not reset the learning records. Nothing was changed. Try again." }, { status: 500 });
  }

  try {
    const resetResult = ResetAccountExportsResultSchema.safeParse(resetData);
    if (!resetResult.success) {
      // The database reset is already committed. Returning success is essential:
      // the client must clear its local snapshot/outboxes instead of re-syncing
      // deleted learning data. Durable cleanup receipts retain the exact paths.
      return resetComplete();
    }

    // Historical Storage policies admitted unusual but owner-prefixed keys.
    // The durable worker can remove those database-inventoried opaque keys;
    // the request only performs immediate best-effort removal for strict keys.
    const learningMaterialPaths = [...new Set(
      resetResult.data.learningMaterialPaths.filter((path) => (
        validLearningMaterialResetPath(user.id, path)
      )),
    )];
    const accountExportPaths = [...new Set(
      resetResult.data.accountExportPaths.filter((path) => (
        validAccountExportResetPath(user.id, path)
      )),
    )];
    if (learningMaterialPaths.length + accountExportPaths.length > 0 && !isSupabaseAdminConfigured()) {
      return resetComplete();
    }
    const admin = learningMaterialPaths.length + accountExportPaths.length > 0
      ? createSupabaseAdminClient()
      : null;
    await removeExactPaths(admin, "learning-materials", learningMaterialPaths);
    await removeExactPaths(admin, ACCOUNT_EXPORT_BUCKET, accountExportPaths);
  } catch {
    // The transactional receipt remains eligible for the leased worker. Never
    // turn a post-commit cleanup exception into a reset failure in the browser.
    return resetComplete();
  }

  return resetComplete();
}

async function removeExactPaths(
  admin: ReturnType<typeof createSupabaseAdminClient> | null,
  bucket: string,
  paths: string[],
) {
  if (!admin || paths.length === 0) return;
  const storage = admin.storage.from(bucket);
  for (let index = 0; index < paths.length; index += 1_000) {
    const { error } = await storage.remove(paths.slice(index, index + 1_000));
    if (error) return;
  }
}

function validLearningMaterialResetPath(userId: string, path: string) {
  const prefix = `${userId}/`;
  return path.length > prefix.length
    && path.length <= 1_024
    && path.startsWith(prefix)
    && !path.includes("//")
    && !path.includes("/../")
    && !path.includes("/./")
    && !/[\u0000-\u001f\u007f]/.test(path);
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

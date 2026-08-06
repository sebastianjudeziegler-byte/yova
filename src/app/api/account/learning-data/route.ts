import { NextResponse } from "next/server";
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

  const { error: resetError } = await supabase.rpc("reset_yova_learning_data");
  if (resetError) {
    return NextResponse.json({ error: "The files were removed, but YOVA could not finish resetting the learning records. Try again." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

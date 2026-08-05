import { NextResponse } from "next/server";
import {
  MaterialAttachmentRequestSchema,
  MaterialAttachmentResponseSchema,
} from "@/lib/materials/attachment-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const { data, error } = await supabase.rpc("attach_materials_to_plan", {
    payload: parsed.data,
  });
  if (error || !data) {
    return NextResponse.json({ error: "YOVA could not attach those materials to the plan." }, { status: 409 });
  }

  const response = MaterialAttachmentResponseSchema.safeParse({
    ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
    persistence: "supabase",
  });
  if (!response.success) {
    return NextResponse.json({ error: "The materials were attached but YOVA could not confirm them." }, { status: 500 });
  }

  return NextResponse.json(response.data, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import {
  CreateMilestoneRequestSchema,
  DeadlineMilestoneSchema,
  UpdateMilestoneRequestSchema,
} from "@/lib/milestones/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before saving a deadline." }, { status: 401 });
  const parsed = CreateMilestoneRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a valid title and due date." }, { status: 422 });

  const { data, error } = await supabase.from("deadline_milestones").insert({
    user_id: user.id,
    title: parsed.data.title,
    description: parsed.data.description,
    due_at: parsed.data.dueAt,
    linked_learning_item_id: parsed.data.linkedLearningItemId,
  }).select("id,title,description,due_at,status,linked_learning_item_id,created_at").single();
  if (error || !data) return NextResponse.json({ error: "YOVA could not save this deadline yet." }, { status: 500 });
  return NextResponse.json({ milestone: DeadlineMilestoneSchema.parse(fromRow(data)) });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before changing a deadline." }, { status: 401 });
  const parsed = UpdateMilestoneRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That deadline update was not valid." }, { status: 422 });
  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.dueAt !== undefined) updates.due_at = parsed.data.dueAt;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.linkedLearningItemId !== undefined) updates.linked_learning_item_id = parsed.data.linkedLearningItemId;
  const { data, error } = await supabase.from("deadline_milestones").update(updates).eq("id", parsed.data.id).select("id,title,description,due_at,status,linked_learning_item_id,created_at").single();
  if (error || !data) return NextResponse.json({ error: "YOVA could not update this deadline." }, { status: 500 });
  return NextResponse.json({ milestone: DeadlineMilestoneSchema.parse(fromRow(data)) });
}

export async function DELETE(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Sign in before deleting a deadline." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id : null;
  if (!id) return NextResponse.json({ error: "YOVA could not identify that deadline." }, { status: 422 });
  const { error } = await supabase.from("deadline_milestones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "YOVA could not delete that deadline." }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

function fromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    status: row.status,
    linkedLearningItemId: row.linked_learning_item_id,
    createdAt: row.created_at,
  };
}

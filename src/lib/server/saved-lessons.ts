import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SavedLessonSchema = z.object({
  content: z.string().trim().min(1).max(12_000),
  delivery_mode: z.enum(["generated", "bounded_fallback"]),
  model: z.string().trim().min(1).max(80),
});
export type SavedLesson = z.infer<typeof SavedLessonSchema>;
export type SavedLessonIdentity = {
  userId: string;
  planId: string;
  planSessionId: string;
  activityIndex: number;
  resourceFingerprint: string;
};

// Read from the owned, server-saved resource. Never hash client lesson prose.
export function savedLessonResourceFingerprint(resource: unknown) {
  return createHash("sha256").update(JSON.stringify(resource)).digest("hex");
}

export async function readSavedLesson(client: SupabaseClient, identity: SavedLessonIdentity): Promise<SavedLesson | null> {
  const { data, error } = await client.from("session_lesson_deliveries")
    .select("content,delivery_mode,model")
    .eq("user_id", identity.userId).eq("plan_id", identity.planId)
    .eq("plan_session_id", identity.planSessionId)
    .eq("activity_index", identity.activityIndex)
    .eq("resource_fingerprint", identity.resourceFingerprint).maybeSingle();
  if (error) throw new Error("Saved lesson unavailable");
  return data === null ? null : SavedLessonSchema.parse(data);
}

export async function saveDeliveredLesson(identity: SavedLessonIdentity, lesson: SavedLesson): Promise<SavedLesson> {
  const parsed = SavedLessonSchema.parse(lesson);
  const admin = createSupabaseAdminClient();
  // First complete delivery wins. Concurrent requests both return that saved
  // delivery, so the finished screen and future review contain the same text.
  const { error } = await admin.from("session_lesson_deliveries").upsert({
    user_id: identity.userId,
    plan_id: identity.planId,
    plan_session_id: identity.planSessionId,
    activity_index: identity.activityIndex,
    resource_fingerprint: identity.resourceFingerprint,
    ...parsed,
  }, { onConflict: "plan_session_id,resource_fingerprint,activity_index", ignoreDuplicates: true });
  if (error) throw new Error("Lesson could not be saved");
  const saved = await readSavedLesson(admin, identity);
  if (!saved) throw new Error("Saved lesson was not found after saving");
  return saved;
}

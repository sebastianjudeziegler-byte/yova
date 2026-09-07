import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const previewReceipts = new Map<string,{answersHash:string;expiresAt:number}>();

export async function claimDiagnosticAnswers(input:{token:string;answers:string[];userId:string;expiresAt:number;preview?:boolean}) {
  const challengeHash = createHash("sha256").update(input.token).digest("hex");
  const answersHash = createHash("sha256").update(JSON.stringify(input.answers)).digest("hex");
  if (input.preview) {
    if (process.env.NODE_ENV !== "development") throw new Error("Placement preview is unavailable.");
    for (const [key,receipt] of previewReceipts) if (receipt.expiresAt < Date.now()) previewReceipts.delete(key);
    const stored = previewReceipts.get(challengeHash);
    if (stored) return stored.answersHash === answersHash;
    previewReceipts.set(challengeHash,{answersHash,expiresAt:input.expiresAt});
    return true;
  }
  const result = await createSupabaseAdminClient().rpc("claim_placement_scoring_v1",{
    requested_user_id:input.userId,requested_challenge_hash:challengeHash,
    requested_answers_hash:answersHash,requested_expires_at:new Date(input.expiresAt).toISOString(),
  });
  if (result.error || typeof result.data !== "boolean") throw new Error("Placement scoring is unavailable.");
  return result.data;
}

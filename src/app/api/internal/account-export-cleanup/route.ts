import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupExpiredAccountExports } from "@/lib/account-export/cleanup";
import { isAccountExportCleanupConfigured } from "@/lib/account-export/config";
import {
  createSupabaseAdminClient,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!isAccountExportCleanupConfigured()) {
    return json({ error: "Account-export cleanup is not configured." }, 503);
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return json({ error: "Cleanup authorization is required." }, 401);
  }

  const result = await cleanupExpiredAccountExports(createSupabaseAdminClient());
  if (!result.ok) return json({ error: "Account-export cleanup could not finish." }, 503);
  return json({
    claimedJobs: result.claimedJobs,
    removedJobs: result.removedJobs,
    retryJobs: result.retryJobs,
  }, 200);
}

function authorized(header: string | null, secret: string) {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const received = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

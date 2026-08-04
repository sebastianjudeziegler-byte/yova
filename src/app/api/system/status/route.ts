import { NextResponse } from "next/server";
import { isOpenAIPlanConfigured } from "@/lib/openai/config";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    planGeneration: isOpenAIPlanConfigured() ? "openai" : "preview",
    persistence: isSupabaseConfigured() ? "supabase" : "browser",
    authentication: isSupabaseConfigured() ? "supabase-email" : "browser-preview",
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

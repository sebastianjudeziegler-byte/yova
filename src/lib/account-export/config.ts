import "server-only";

import { isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export function isAccountExportCleanupConfigured() {
  const cronSecret = process.env.CRON_SECRET ?? "";
  return isSupabaseAdminConfigured()
    && cronSecret.length >= 32
    && cronSecret === cronSecret.trim();
}

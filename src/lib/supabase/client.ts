import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig, isSupabaseConfigured } from "@/lib/supabase/config";

export { isSupabaseConfigured };

export function createSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error("Supabase is not configured. Add the public project URL and publishable key.");
  }

  return createBrowserClient(config.url, config.publishableKey);
}

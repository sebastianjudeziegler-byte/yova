import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

let adminClient: SupabaseClient | null = null;

export function isSupabaseAdminConfigured() {
  return Boolean(getSupabasePublicConfig() && process.env.SUPABASE_SECRET_KEY?.trim());
}

export function createSupabaseAdminClient() {
  if (adminClient) return adminClient;

  const config = getSupabasePublicConfig();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secretKey) {
    throw new Error("Supabase admin access is not configured on the YOVA server.");
  }

  adminClient = createClient(config.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}

/**
 * A fresh, non-persisting public Auth client for sending a normal sign-in email
 * to an already-created tester. It carries no founder or service credentials.
 */
export function createSupabaseNoSessionAuthClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured on the YOVA server.");

  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // This server never owns the tester browser's PKCE verifier. The Magic
      // Link template instead sends TokenHash to YOVA's explicit confirmation
      // POST, so keep the email request independent of founder browser state.
      flowType: "implicit",
    },
  });
}
